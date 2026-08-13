/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { createSerializedCatalogExecutor } from './persistence';
import {
  CatalogFederationError,
  type CatalogActionLedger,
  type CatalogActionLedgerEntry,
  type CatalogActionRecoveryReport,
  type CatalogFederationErrorCode,
  type CatalogProvider,
} from './types';

const MIN_ACTION_AGE_MS = 60_000;
const MAX_ACTION_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export type CatalogActionRecoveryOptions = {
  ledger: CatalogActionLedger;
  providers: readonly CatalogProvider[];
  now?: () => Date;
  randomId?: () => string;
  maxActionAgeMs?: number;
};

const isRecoverable = (entry: CatalogActionLedgerEntry): boolean =>
  entry.state === 'authorized' || entry.state === 'invoking';

const actionError = (code: CatalogFederationErrorCode, message: string, cause?: unknown): CatalogFederationError =>
  new CatalogFederationError(code, message, cause === undefined ? undefined : { cause });

const isStale = (entry: CatalogActionLedgerEntry, timestamp: Date, maxActionAgeMs: number): boolean => {
  const startedAt = Date.parse(entry.startedAt);
  const ageMs = timestamp.getTime() - startedAt;
  return !Number.isFinite(startedAt) || ageMs > maxActionAgeMs || ageMs < -MAX_FUTURE_CLOCK_SKEW_MS;
};

export const createCatalogActionRecovery = ({
  ledger,
  providers,
  now = () => new Date(),
  randomId = randomUUID,
  maxActionAgeMs = 15 * 60 * 1_000,
}: CatalogActionRecoveryOptions): { recover: () => Promise<CatalogActionRecoveryReport> } => {
  if (
    !Number.isSafeInteger(maxActionAgeMs) ||
    maxActionAgeMs < MIN_ACTION_AGE_MS ||
    maxActionAgeMs > MAX_ACTION_AGE_MS
  ) {
    throw new Error('Catalog action recovery age must be between one minute and one day.');
  }
  const providersBySource = new Map<string, CatalogProvider>();
  for (const provider of providers) {
    if (providersBySource.has(provider.source)) {
      throw new CatalogFederationError('CATALOG_SOURCE_DUPLICATE', `Duplicate catalog source: ${provider.source}.`);
    }
    providersBySource.set(provider.source, provider);
  }
  const serialize = createSerializedCatalogExecutor();

  const recover = (): Promise<CatalogActionRecoveryReport> =>
    serialize(async () => {
      const report: CatalogActionRecoveryReport = { recovered: [], failed: [], quarantined: [] };
      const timestamp = now();
      const entries = await ledger.list();
      for (const entry of entries) {
        if (!isRecoverable(entry)) continue;
        if (!entry.idempotencyKey || isStale(entry, timestamp, maxActionAgeMs)) {
          await ledger.quarantine(
            entry.id,
            actionError(
              'CATALOG_ACTION_RECOVERY_STALE',
              'Catalog action recovery record is stale or lacks an idempotency key.'
            )
          );
          report.quarantined.push(entry.id);
          continue;
        }
        const provider = providersBySource.get(entry.authorization.source);
        if (!provider?.reconcile) {
          await ledger.fail(
            entry.id,
            actionError(
              'CATALOG_ACTION_RECOVERY_UNRESOLVED',
              'Catalog provider cannot safely reconcile this interrupted action.'
            )
          );
          report.failed.push(entry.id);
          continue;
        }
        let reconciliation;
        try {
          reconciliation = await provider.reconcile({
            authorization: entry.authorization,
            ...(entry.region ? { region: entry.region } : {}),
            idempotencyKey: entry.idempotencyKey,
          });
        } catch (error) {
          await ledger.fail(
            entry.id,
            actionError('CATALOG_ACTION_RECOVERY_UNRESOLVED', 'Catalog provider recovery query failed.', error)
          );
          report.failed.push(entry.id);
          continue;
        }
        if (
          reconciliation.state !== 'satisfied' ||
          reconciliation.result.status !== 'completed' ||
          reconciliation.result.verification !== 'verified'
        ) {
          await ledger.fail(
            entry.id,
            actionError(
              'CATALOG_ACTION_RECOVERY_UNRESOLVED',
              'Catalog provider could not prove a terminal safe result for this interrupted action.'
            )
          );
          report.failed.push(entry.id);
          continue;
        }
        const receipt = {
          operationId: `recovery:${randomId()}`,
          action: entry.authorization.action,
          source: entry.authorization.source,
          sourceItemId: entry.authorization.sourceItemId,
          provider: reconciliation.result.provider,
          startedAt: entry.startedAt,
          completedAt: timestamp.toISOString(),
          status: reconciliation.result.status,
          verification: reconciliation.result.verification,
          ...(reconciliation.result.installedVersion
            ? { installedVersion: reconciliation.result.installedVersion }
            : {}),
        } as const;
        await ledger.complete(entry.id, receipt);
        report.recovered.push(receipt);
      }
      return report;
    });

  return { recover };
};
