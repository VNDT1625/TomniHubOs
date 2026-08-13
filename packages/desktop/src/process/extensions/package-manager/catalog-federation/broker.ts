/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type {
  CatalogActionAuthorization,
  CatalogActionReceipt,
  CatalogActionRequest,
  CatalogSource,
  FederatedCatalogItem,
  FederatedCatalogSearchRequest,
  FederatedCatalogSearchResult,
  LinkedMicrosoftAppRecord,
} from '../../../../common/packages';
import { createCatalogActionRecovery } from './actionRecovery';
import {
  CatalogFederationError,
  type CatalogActionLedgerEntry,
  type CatalogFederationBroker,
  type CatalogFederationBrokerDeps,
  type CatalogProvider,
  type CatalogProviderItem,
} from './types';
import {
  assertLinkedAppMayRun,
  normalizeProductId,
  parseLimit,
  parseLinkedMicrosoftAppRecord,
  parseRegion,
  parseSearchQuery,
} from './validation';

const SOURCE_ORDER: readonly CatalogSource[] = ['tomni-store', 'microsoft-store'];
const MAX_CONSENT_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const cloneProviderItems = (items: readonly CatalogProviderItem[]): CatalogProviderItem[] =>
  structuredClone([...items]);

const isDurableAction = (action: CatalogActionAuthorization['action']): boolean => action !== 'open-store-page';

const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });

const parseIdempotencyKey = (value: string): string => {
  if (!value.trim() || value.length > 200 || hasControlCharacters(value)) {
    throw new CatalogFederationError('CATALOG_REQUEST_INVALID', 'Catalog action idempotency key is invalid.');
  }
  return value;
};

const authorizationMatches = (left: CatalogActionAuthorization, right: CatalogActionAuthorization): boolean =>
  left.action === right.action && left.source === right.source && left.sourceItemId === right.sourceItemId;

export const createCatalogFederationBroker = ({
  providers,
  linkedApps = [],
  cache: durableCache,
  consent: consentResolver,
  linkedAppPolicy,
  ledger,
  authorize,
  now = () => new Date(),
  randomId = randomUUID,
}: CatalogFederationBrokerDeps): CatalogFederationBroker => {
  const providerMap = new Map<CatalogSource, CatalogProvider>();
  for (const provider of providers) {
    if (providerMap.has(provider.source)) {
      throw new CatalogFederationError('CATALOG_SOURCE_DUPLICATE', `Duplicate catalog source: ${provider.source}.`);
    }
    providerMap.set(provider.source, provider);
  }

  const actionRecovery = ledger ? createCatalogActionRecovery({ ledger, providers, now, randomId }) : undefined;
  const recoverPendingActions = (): Promise<{
    recovered: CatalogActionReceipt[];
    failed: string[];
    quarantined: string[];
  }> => actionRecovery?.recover() ?? Promise.resolve({ recovered: [], failed: [], quarantined: [] });
  let initialActionRecovery: Promise<void> | undefined;
  const ensureActionRecovery = async (): Promise<void> => {
    initialActionRecovery ??= recoverPendingActions().then((): undefined => undefined);
    await initialActionRecovery;
  };

  const findExistingAction = async (
    idempotencyKey: string,
    authorization: CatalogActionAuthorization
  ): Promise<CatalogActionReceipt | undefined> => {
    if (!ledger) return undefined;
    let existing;
    try {
      existing = await ledger.findByIdempotencyKey(idempotencyKey);
    } catch (error) {
      if (error instanceof CatalogFederationError) throw error;
      throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Catalog action audit could not be read.', {
        cause: error,
      });
    }
    if (!existing) return undefined;
    if (!authorizationMatches(existing.authorization, authorization)) {
      throw new CatalogFederationError(
        'CATALOG_ACTION_IDEMPOTENCY_CONFLICT',
        'Catalog action idempotency key is already bound to a different action.'
      );
    }
    if (existing.state === 'completed') {
      if (!existing.receipt) {
        throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Completed catalog action has no receipt.');
      }
      return structuredClone(existing.receipt);
    }
    if (existing.state === 'authorized' || existing.state === 'invoking') {
      throw new CatalogFederationError('CATALOG_ACTION_IN_PROGRESS', 'Catalog action is already in progress.');
    }
    if (existing.state === 'quarantined') {
      throw new CatalogFederationError('CATALOG_ACTION_QUARANTINED', 'Catalog action requires manual review.');
    }
    throw new CatalogFederationError(
      'CATALOG_ACTION_IDEMPOTENCY_CONFLICT',
      'Catalog action idempotency key is already bound to a terminal failure.'
    );
  };

  const canonicalBySourceItem = new Map<string, string>();
  const verifiedLinkedApps: LinkedMicrosoftAppRecord[] = [];
  for (const rawRecord of linkedApps) {
    const record = parseLinkedMicrosoftAppRecord(rawRecord);
    verifiedLinkedApps.push(record);
    const canonicalKey = `linked:${record.id}`;
    const microsoftKey = `microsoft-store:${record.microsoft.productId}`;
    if (canonicalBySourceItem.has(microsoftKey)) {
      throw new CatalogFederationError('LINKED_APP_INVALID', 'Microsoft product is linked more than once.');
    }
    canonicalBySourceItem.set(microsoftKey, canonicalKey);
    if (record.tomniPackageId) {
      const tomniKey = `tomni-store:${record.tomniPackageId}`;
      if (canonicalBySourceItem.has(tomniKey)) {
        throw new CatalogFederationError('LINKED_APP_INVALID', 'Tomni package is linked more than once.');
      }
      canonicalBySourceItem.set(tomniKey, canonicalKey);
    }
  }

  const memoryCache = new Map<string, CatalogProviderItem[]>();
  const sourceKey = (source: CatalogSource, sourceItemId: string): string =>
    `${source}:${source === 'microsoft-store' ? normalizeProductId(sourceItemId) : sourceItemId}`;
  const canonicalFor = (item: CatalogProviderItem): string => {
    const key = sourceKey(item.offer.source, item.offer.sourceItemId);
    return canonicalBySourceItem.get(key) ?? key;
  };

  const resolveConsent = async (
    authorization: CatalogActionAuthorization,
    region: string | undefined,
    request: Pick<CatalogActionRequest, 'idempotencyKey'> & { consentId?: string; ownerId?: string }
  ) => {
    if (!consentResolver) {
      if (authorization.action === 'open-store-page') return undefined;
      throw new CatalogFederationError(
        'CATALOG_CONSENT_INVALID',
        'A current user consent record is required for this catalog action.'
      );
    }
    let decision;
    try {
      decision = await consentResolver.authorize({
        ...authorization,
        ...(region ? { region } : {}),
        ...(request.consentId ? { consentId: request.consentId } : {}),
        ...(request.ownerId ? { ownerId: request.ownerId } : {}),
        ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      });
    } catch (error) {
      throw new CatalogFederationError('CATALOG_CONSENT_INVALID', 'Catalog action consent could not be verified.', {
        cause: error,
      });
    }
    if (!decision.allowed) {
      throw new CatalogFederationError('CATALOG_ACTION_DENIED', 'Catalog action consent was denied.');
    }
    const consent = decision.consent;
    const checkedAt = now().getTime();
    const grantedAt = consent ? Date.parse(consent.grantedAt) : Number.NaN;
    const expiresAt = consent ? Date.parse(consent.expiresAt) : Number.NaN;
    if (
      !consent ||
      consent.schemaVersion !== 1 ||
      !consent.consentId.trim() ||
      consent.consentId.length > 200 ||
      hasControlCharacters(consent.consentId) ||
      consent.action !== authorization.action ||
      consent.source !== authorization.source ||
      consent.sourceItemId !== authorization.sourceItemId ||
      consent.region !== region ||
      !Number.isFinite(grantedAt) ||
      !Number.isFinite(expiresAt) ||
      grantedAt > checkedAt + MAX_CONSENT_CLOCK_SKEW_MS ||
      expiresAt <= checkedAt ||
      expiresAt <= grantedAt
    ) {
      throw new CatalogFederationError('CATALOG_CONSENT_INVALID', 'Catalog action consent is invalid or expired.');
    }
    return structuredClone(consent);
  };

  const resolveLinkedAppPolicy = async (authorization: CatalogActionAuthorization, region: string | undefined) => {
    if (authorization.source !== 'microsoft-store' || authorization.action === 'open-store-page') return undefined;
    const productId = normalizeProductId(authorization.sourceItemId);
    const staticRecord = verifiedLinkedApps.find((record) => record.microsoft.productId === productId);
    if (!staticRecord) {
      throw new CatalogFederationError(
        'LINKED_APP_NOT_REVIEWED',
        'Microsoft package actions require an explicitly reviewed Linked App record.'
      );
    }
    if (!linkedAppPolicy) {
      throw new CatalogFederationError(
        'CATALOG_POLICY_UNAVAILABLE',
        'Linked App policy refresh is required before this action.'
      );
    }
    let refreshed: LinkedMicrosoftAppRecord[];
    try {
      refreshed = (await linkedAppPolicy.refresh()).map(parseLinkedMicrosoftAppRecord);
    } catch (error) {
      throw new CatalogFederationError(
        'CATALOG_POLICY_UNAVAILABLE',
        'Linked App policy could not be refreshed before this action.',
        { cause: error }
      );
    }
    const matches = refreshed.filter((candidate) => candidate.microsoft.productId === productId);
    if (matches.length !== 1) {
      throw new CatalogFederationError(
        'CATALOG_POLICY_UNAVAILABLE',
        'Linked App policy no longer contains one unambiguous reviewed record.'
      );
    }
    const record = matches[0]!;
    assertLinkedAppMayRun(record, region ?? 'ZZ');
    return {
      linkedAppId: record.id,
      reviewRevision: record.review.revision,
      reviewedAt: record.review.reviewedAt,
      health: record.review.health,
      killSwitch: record.review.killSwitch,
    };
  };

  const search = async (rawRequest: FederatedCatalogSearchRequest): Promise<FederatedCatalogSearchResult> => {
    const request = {
      query: parseSearchQuery(rawRequest.query),
      region: parseRegion(rawRequest.region),
      limit: parseLimit(rawRequest.limit),
    };
    const checkedAt = now().toISOString();
    const results = await Promise.all(
      SOURCE_ORDER.map(async (source) => {
        const provider = providerMap.get(source);
        const normalizedQuery = request.query.toLocaleLowerCase();
        const cacheKey = `${source}\n${request.region}\n${normalizedQuery}\n${request.limit}`;
        const durableKey = { source, query: normalizedQuery, region: request.region, limit: request.limit };
        if (!provider) {
          return {
            items: [] as CatalogProviderItem[],
            state: { source, status: 'failed', checkedAt, errorCode: 'CATALOG_SOURCE_UNAVAILABLE' } as const,
          };
        }
        try {
          const items = await provider.search(request);
          if (items.some((item) => item.offer.source !== source)) {
            throw new CatalogFederationError(
              'CATALOG_REQUEST_INVALID',
              'Catalog provider returned a mismatched source.'
            );
          }
          memoryCache.set(cacheKey, cloneProviderItems(items));
          await durableCache?.store(durableKey, items).catch((): undefined => undefined);
          return { items, state: { source, status: 'ready', checkedAt } as const };
        } catch {
          let cached = memoryCache.get(cacheKey);
          if (!cached && durableCache) {
            const durable = await durableCache.load(durableKey).catch((): undefined => undefined);
            cached = durable?.items;
            if (cached) memoryCache.set(cacheKey, cloneProviderItems(cached));
          }
          if (cached) {
            const staleItems = cloneProviderItems(cached);
            for (const item of staleItems) item.offer.availability = 'unknown';
            return {
              items: staleItems,
              state: {
                source,
                status: 'stale',
                checkedAt,
                errorCode: 'CATALOG_SOURCE_UNAVAILABLE',
              } as const,
            };
          }
          return {
            items: [] as CatalogProviderItem[],
            state: {
              source,
              status: 'failed',
              checkedAt,
              errorCode: 'CATALOG_SOURCE_UNAVAILABLE',
            } as const,
          };
        }
      })
    );

    const merged = new Map<string, FederatedCatalogItem>();
    for (const result of results) {
      for (const item of result.items) {
        const canonicalKey = canonicalFor(item);
        const existing = merged.get(canonicalKey);
        if (!existing) {
          merged.set(canonicalKey, {
            canonicalKey,
            display: structuredClone(item.display),
            offers: [structuredClone(item.offer)],
          });
          continue;
        }
        if (item.offer.source === 'tomni-store') existing.display = structuredClone(item.display);
        if (
          !existing.offers.some(
            (offer) => offer.source === item.offer.source && offer.sourceItemId === item.offer.sourceItemId
          )
        ) {
          existing.offers.push(structuredClone(item.offer));
        }
      }
    }
    const items = [...merged.values()];
    for (const item of items) {
      item.offers = item.offers.toSorted(
        (left, right) => SOURCE_ORDER.indexOf(left.source) - SOURCE_ORDER.indexOf(right.source)
      );
    }
    const sortedItems = items.toSorted((left, right) => left.display.name.localeCompare(right.display.name));
    return { items: sortedItems, sources: results.map((result) => result.state) };
  };

  const runAction = async (
    action: CatalogActionAuthorization['action'],
    request: CatalogActionRequest,
    region: string | undefined
  ): Promise<CatalogActionReceipt> => {
    const provider = providerMap.get(request.source);
    if (!provider) throw new CatalogFederationError('CATALOG_SOURCE_UNAVAILABLE', 'Catalog source is unavailable.');
    const durable = isDurableAction(action);
    if (durable && !ledger) {
      throw new CatalogFederationError(
        'CATALOG_LEDGER_UNAVAILABLE',
        'A durable action ledger is required before a package state can change.'
      );
    }
    if (durable && !region) {
      throw new CatalogFederationError('CATALOG_REQUEST_INVALID', 'Catalog package actions require a region.');
    }
    if (durable && request.idempotencyKey === undefined) {
      throw new CatalogFederationError(
        'CATALOG_REQUEST_INVALID',
        'Catalog package actions require a stable idempotency key.'
      );
    }
    const normalizedRegion = region ? parseRegion(region) : undefined;
    const idempotencyKey = parseIdempotencyKey(request.idempotencyKey ?? randomId());
    const authorization = { action, source: request.source, sourceItemId: request.sourceItemId };
    if (!(await authorize(authorization))) {
      throw new CatalogFederationError('CATALOG_ACTION_DENIED', 'Catalog action was not authorized.');
    }
    if (durable) {
      await ensureActionRecovery();
      const existing = await findExistingAction(idempotencyKey, authorization);
      if (existing) return existing;
    }
    const consent = await resolveConsent(authorization, normalizedRegion, request);
    const policy = await resolveLinkedAppPolicy(authorization, normalizedRegion);
    const supportsAction =
      action === 'install'
        ? provider.install !== undefined
        : action === 'uninstall'
          ? provider.uninstall !== undefined
          : action === 'enable'
            ? provider.enable !== undefined
            : action === 'disable'
              ? provider.disable !== undefined
              : action === 'rollback'
                ? provider.rollback !== undefined
                : action === 'launch'
                  ? provider.launch !== undefined
                  : provider.openStorePage !== undefined;
    if (!supportsAction) {
      throw new CatalogFederationError('CATALOG_ACTION_UNSUPPORTED', 'Catalog source does not support this action.');
    }
    const startedAt = now().toISOString();
    let ledgerEntry: CatalogActionLedgerEntry | undefined;
    if (durable) {
      try {
        ledgerEntry = await ledger!.begin({
          authorization,
          idempotencyKey,
          ...(normalizedRegion ? { region: normalizedRegion } : {}),
          ...(consent ? { consent } : {}),
          ...(policy ? { policy } : {}),
          startedAt,
        });
        ledgerEntry = await ledger!.markInvoking(ledgerEntry.id);
      } catch (error) {
        if (error instanceof CatalogFederationError && error.code === 'CATALOG_ACTION_IDEMPOTENCY_CONFLICT') {
          const existing = await findExistingAction(idempotencyKey, authorization);
          if (existing) return existing;
        }
        if (error instanceof CatalogFederationError) throw error;
        throw new CatalogFederationError('CATALOG_LEDGER_UNAVAILABLE', 'Catalog action audit could not be started.', {
          cause: error,
        });
      }
    }
    const invoke = async () => {
      const context = { idempotencyKey };
      switch (action) {
        case 'install':
          if (!provider.install) {
            throw new CatalogFederationError('CATALOG_ACTION_UNSUPPORTED', 'Catalog source does not support install.');
          }
          return provider.install(request.sourceItemId, normalizedRegion ?? 'ZZ', context);
        case 'uninstall':
          if (!provider.uninstall) {
            throw new CatalogFederationError(
              'CATALOG_ACTION_UNSUPPORTED',
              'Catalog source does not support uninstall.'
            );
          }
          return provider.uninstall(request.sourceItemId, normalizedRegion ?? 'ZZ', context);
        case 'enable':
          if (!provider.enable) {
            throw new CatalogFederationError('CATALOG_ACTION_UNSUPPORTED', 'Catalog source does not support enable.');
          }
          return provider.enable(request.sourceItemId, normalizedRegion ?? 'ZZ', context);
        case 'disable':
          if (!provider.disable) {
            throw new CatalogFederationError('CATALOG_ACTION_UNSUPPORTED', 'Catalog source does not support disable.');
          }
          return provider.disable(request.sourceItemId, normalizedRegion ?? 'ZZ', context);
        case 'rollback':
          if (!provider.rollback) {
            throw new CatalogFederationError('CATALOG_ACTION_UNSUPPORTED', 'Catalog source does not support rollback.');
          }
          return provider.rollback(request.sourceItemId, normalizedRegion ?? 'ZZ', context);
        case 'launch':
          if (!provider.launch) {
            throw new CatalogFederationError('CATALOG_ACTION_UNSUPPORTED', 'Catalog source does not support launch.');
          }
          return provider.launch(request.sourceItemId, normalizedRegion ?? 'ZZ', context);
        case 'open-store-page':
          if (!provider.openStorePage) {
            throw new CatalogFederationError(
              'CATALOG_ACTION_UNSUPPORTED',
              'Catalog source does not support store pages.'
            );
          }
          return provider.openStorePage(request.sourceItemId, context);
      }
    };
    try {
      const result = await invoke();
      const receipt: CatalogActionReceipt = {
        operationId: randomId(),
        action,
        source: request.source,
        sourceItemId: request.sourceItemId,
        provider: result.provider,
        startedAt,
        completedAt: now().toISOString(),
        status: result.status,
        verification: result.verification,
        ...(result.installedVersion ? { installedVersion: result.installedVersion } : {}),
      };
      if (ledgerEntry) await ledger!.complete(ledgerEntry.id, receipt);
      return receipt;
    } catch (error) {
      if (ledgerEntry) await recoverPendingActions().catch((): undefined => undefined);
      throw error;
    }
  };

  return {
    search,
    recoverPendingActions,
    install: (request) => runAction('install', request, request.region),
    uninstall: (request) => runAction('uninstall', request, request.region),
    enable: (request) => runAction('enable', request, request.region),
    disable: (request) => runAction('disable', request, request.region),
    rollback: (request) => runAction('rollback', request, request.region),
    launch: (request) => runAction('launch', request, request.region),
    openStorePage: (request) => runAction('open-store-page', request, undefined),
  };
};
