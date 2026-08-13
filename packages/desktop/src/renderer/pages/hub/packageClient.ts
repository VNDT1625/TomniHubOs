/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  FederatedCatalogSearchRequest,
  FederatedCatalogSearchResult,
  PackageAsset,
  PackageCapabilityLease,
  PackageCapabilityLeaseRequest,
  PackageCapabilityResult,
  PackageCapabilitySyscall,
  PackageContributionChangedEvent,
  PackageContributionState,
  PackageListFilter,
  PackageListing,
  PackageMutationAction,
  PackageMutationConsentGrant,
  PackageSearchRequest,
  PackageUpdatePermissionConsentGrant,
  PackageUpdatePermissionConsentPreparation,
} from '@/common/packages';
import type {
  MicrosoftStoreNativeAction,
  MicrosoftStoreNativeConsentGrant,
  MicrosoftStoreNativeExecutionReceipt,
  MicrosoftStoreNativeOpenPageReceipt,
  MicrosoftStoreNativeResult,
} from '@/common/types/platform/electron';
import { isElectronDesktop } from '@renderer/utils/platform';

type ApiEnvelope<T> = {
  data?: T;
  message?: string;
  error?: string;
  timedOut?: boolean;
};

export type PackageContributionUpdateMode = 'push' | 'long-poll';

export type PackageContributionWaitResult = {
  state: PackageContributionState;
  timedOut: boolean;
};

const requestEnvelope = async <T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> => {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  const rawBody = await response.text();
  let body: ApiEnvelope<T>;
  try {
    body = rawBody ? (JSON.parse(rawBody) as ApiEnvelope<T>) : {};
  } catch {
    body = {};
  }
  if (!response.ok || body.data === undefined) {
    throw new Error(body.message ?? body.error ?? `Package request failed with status ${response.status}.`);
  }
  return body;
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const body = await requestEnvelope<T>(path, init);
  return body.data as T;
};

const queryString = (filter: PackageListFilter & { query?: string }): string => {
  const params = new URLSearchParams();
  if (filter.type) params.set('type', filter.type);
  if (filter.installedOnly) params.set('installedOnly', 'true');
  if (filter.query) params.set('query', filter.query);
  const value = params.toString();
  return value ? `?${value}` : '';
};

const mutationRegion = (): string => {
  const region = navigator.language.split('-')[1]?.toUpperCase();
  return region && /^[A-Z]{2}$/.test(region) ? region : 'ZZ';
};

const mutatePackageOverDesktop = async (
  action: PackageMutationAction,
  id: string,
  permissionConsentId?: string
): Promise<PackageListing> => {
  const api = window.electronAPI?.packageMutation;
  if (!api) throw new Error('PACKAGE_MUTATION_TRUSTED_CHANNEL_UNAVAILABLE');
  const idempotencyKey = globalThis.crypto.randomUUID();
  const region = mutationRegion();
  const grant = await api.requestConsent({ id, action, idempotencyKey, region, confirmed: true });
  return api.execute({
    id,
    action,
    idempotencyKey,
    region,
    consentId: grant.consentId,
    ...(permissionConsentId ? { permissionConsentId } : {}),
  });
};

const mutatePackageOverHttp = async (
  action: PackageMutationAction,
  id: string,
  permissionConsentId?: string
): Promise<PackageListing> => {
  const idempotencyKey = globalThis.crypto.randomUUID();
  const region = mutationRegion();
  const grant = await request<PackageMutationConsentGrant>(`/api/packages/${encodeURIComponent(id)}/consent`, {
    method: 'POST',
    body: JSON.stringify({ action, idempotencyKey, region, confirmed: true }),
  });
  return request(`/api/packages/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: JSON.stringify({
      idempotencyKey,
      region,
      consentId: grant.consentId,
      ...(permissionConsentId ? { permissionConsentId } : {}),
    }),
  });
};

const preparePermissionUpdateOverHttp = (id: string): Promise<PackageUpdatePermissionConsentPreparation> =>
  request(`/api/packages/${encodeURIComponent(id)}/permission-consent`, { method: 'POST', body: '{}' });

const approvePermissionUpdateOverHttp = (
  id: string,
  challengeId: string
): Promise<PackageUpdatePermissionConsentGrant> =>
  request(`/api/packages/${encodeURIComponent(id)}/permission-consent/approve`, {
    method: 'POST',
    body: JSON.stringify({ challengeId, confirmed: true }),
  });

const unwrapMicrosoftStoreResult = <T>(result: MicrosoftStoreNativeResult<T>): T => {
  if (result.ok === false) throw new Error(result.code);
  return result.data;
};

const mutateMicrosoftStore = async (
  action: MicrosoftStoreNativeAction,
  linkedAppId: string
): Promise<MicrosoftStoreNativeExecutionReceipt> => {
  if (!isElectronDesktop()) throw new Error('MICROSOFT_STORE_DESKTOP_REQUIRED');
  const api = window.electronAPI?.microsoftStore;
  if (!api) throw new Error('MICROSOFT_STORE_TRUSTED_CHANNEL_UNAVAILABLE');
  const idempotencyKey = globalThis.crypto.randomUUID();
  const region = mutationRegion();
  const grant: MicrosoftStoreNativeConsentGrant = unwrapMicrosoftStoreResult(
    await api.requestConsent({ action, linkedAppId, region, idempotencyKey })
  );
  return unwrapMicrosoftStoreResult(
    await api.execute({ action, linkedAppId, region, idempotencyKey, consentId: grant.consentId })
  );
};

export const packageClient = {
  refresh: (): Promise<PackageListing[]> =>
    isElectronDesktop()
      ? ipcBridge.packagePlatform.refresh.invoke()
      : request('/api/packages/refresh', { method: 'POST', body: '{}' }),
  list: (filter: PackageListFilter = {}): Promise<PackageListing[]> =>
    isElectronDesktop()
      ? ipcBridge.packagePlatform.list.invoke(filter)
      : request(`/api/packages${queryString(filter)}`),
  search: (searchRequest: PackageSearchRequest): Promise<PackageListing[]> =>
    isElectronDesktop()
      ? ipcBridge.packagePlatform.search.invoke(searchRequest)
      : request(`/api/packages${queryString(searchRequest)}`),
  federatedSearch: (searchRequest: FederatedCatalogSearchRequest): Promise<FederatedCatalogSearchResult> => {
    if (!isElectronDesktop()) return Promise.reject(new Error('FEDERATED_CATALOG_DESKTOP_REQUIRED'));
    return ipcBridge.packagePlatform.federatedSearch.invoke(searchRequest);
  },
  installMicrosoftApp: (linkedAppId: string): Promise<MicrosoftStoreNativeExecutionReceipt> =>
    mutateMicrosoftStore('install', linkedAppId),
  launchMicrosoftApp: (linkedAppId: string): Promise<MicrosoftStoreNativeExecutionReceipt> =>
    mutateMicrosoftStore('launch', linkedAppId),
  openMicrosoftStorePage: async (productId: string): Promise<MicrosoftStoreNativeOpenPageReceipt> => {
    if (!isElectronDesktop()) throw new Error('MICROSOFT_STORE_DESKTOP_REQUIRED');
    const api = window.electronAPI?.microsoftStore;
    if (!api) throw new Error('MICROSOFT_STORE_TRUSTED_CHANNEL_UNAVAILABLE');
    return unwrapMicrosoftStoreResult(await api.openStorePage({ productId }));
  },
  preparePermissionUpdate: (id: string): Promise<PackageUpdatePermissionConsentPreparation> => {
    if (!isElectronDesktop()) return preparePermissionUpdateOverHttp(id);
    const api = window.electronAPI?.packageMutation;
    if (!api) throw new Error('PACKAGE_MUTATION_TRUSTED_CHANNEL_UNAVAILABLE');
    return api.preparePermissionConsent({ id });
  },
  approvePermissionUpdate: (id: string, challengeId: string): Promise<PackageUpdatePermissionConsentGrant> => {
    if (!isElectronDesktop()) return approvePermissionUpdateOverHttp(id, challengeId);
    const api = window.electronAPI?.packageMutation;
    if (!api) throw new Error('PACKAGE_MUTATION_TRUSTED_CHANNEL_UNAVAILABLE');
    return api.approvePermissionConsent({ challengeId, confirmed: true });
  },
  install: (id: string, permissionConsentId?: string): Promise<PackageListing> =>
    isElectronDesktop()
      ? mutatePackageOverDesktop('install', id, permissionConsentId)
      : mutatePackageOverHttp('install', id, permissionConsentId),
  uninstall: (id: string): Promise<PackageListing> =>
    isElectronDesktop() ? mutatePackageOverDesktop('uninstall', id) : mutatePackageOverHttp('uninstall', id),
  enable: (id: string): Promise<PackageListing> =>
    isElectronDesktop() ? mutatePackageOverDesktop('enable', id) : mutatePackageOverHttp('enable', id),
  disable: (id: string): Promise<PackageListing> =>
    isElectronDesktop() ? mutatePackageOverDesktop('disable', id) : mutatePackageOverHttp('disable', id),
  rollback: (id: string): Promise<PackageListing> =>
    isElectronDesktop() ? mutatePackageOverDesktop('rollback', id) : mutatePackageOverHttp('rollback', id),
  openRuntime: async (packageId: string, runtimeId: string): Promise<void> => {
    if (!isElectronDesktop()) {
      await request(`/api/packages/${encodeURIComponent(packageId)}/runtime/open`, {
        method: 'POST',
        body: JSON.stringify({ runtimeId }),
      });
      return;
    }
    const api = window.electronAPI?.packageRuntime;
    if (!api) throw new Error('PACKAGE_RUNTIME_TRACKING_UNAVAILABLE');
    await api.open({ packageId, runtimeId });
  },
  closeRuntime: async (packageId: string, runtimeId: string): Promise<void> => {
    if (!isElectronDesktop()) {
      await request(`/api/packages/${encodeURIComponent(packageId)}/runtime/close`, {
        method: 'POST',
        body: JSON.stringify({ runtimeId }),
      });
      return;
    }
    const api = window.electronAPI?.packageRuntime;
    if (!api) throw new Error('PACKAGE_RUNTIME_TRACKING_UNAVAILABLE');
    await api.close({ packageId, runtimeId });
  },
  activateCapability: async (payload: PackageCapabilityLeaseRequest): Promise<PackageCapabilityLease> => {
    if (!isElectronDesktop()) throw new Error('PACKAGE_CAPABILITY_DESKTOP_REQUIRED');
    const api = window.electronAPI?.packageCapability;
    if (!api) throw new Error('PACKAGE_CAPABILITY_TRUSTED_CHANNEL_UNAVAILABLE');
    return api.activate(payload);
  },
  invokeCapability: async (payload: PackageCapabilitySyscall): Promise<PackageCapabilityResult> => {
    if (!isElectronDesktop()) throw new Error('PACKAGE_CAPABILITY_DESKTOP_REQUIRED');
    const api = window.electronAPI?.packageCapability;
    if (!api) throw new Error('PACKAGE_CAPABILITY_TRUSTED_CHANNEL_UNAVAILABLE');
    return api.invoke(payload);
  },
  cancelCapability: async (
    payload: Pick<PackageCapabilityLease, 'leaseId' | 'packageId' | 'runtimeId'>
  ): Promise<boolean> => {
    if (!isElectronDesktop()) throw new Error('PACKAGE_CAPABILITY_DESKTOP_REQUIRED');
    const api = window.electronAPI?.packageCapability;
    if (!api) throw new Error('PACKAGE_CAPABILITY_TRUSTED_CHANNEL_UNAVAILABLE');
    return api.cancel(payload);
  },
  contributions: (): Promise<PackageContributionState> =>
    isElectronDesktop() ? ipcBridge.packagePlatform.contributions.invoke() : request('/api/packages/contributions'),
  contributionUpdateMode: (): PackageContributionUpdateMode => (isElectronDesktop() ? 'push' : 'long-poll'),
  onContributionsChanged: (listener: (event: PackageContributionChangedEvent) => void): (() => void) =>
    isElectronDesktop() ? ipcBridge.packagePlatform.contributionsChanged.on(listener) : () => undefined,
  waitForContributions: async (afterRevision: number, signal: AbortSignal): Promise<PackageContributionWaitResult> => {
    const params = new URLSearchParams({ afterRevision: String(afterRevision), timeoutMs: '30000' });
    const body = await requestEnvelope<PackageContributionState>(`/api/packages/contributions/wait?${params}`, {
      signal,
    });
    return { state: body.data as PackageContributionState, timedOut: body.timedOut === true };
  },
  readAsset: (id: string, assetPath: string): Promise<PackageAsset> =>
    isElectronDesktop()
      ? ipcBridge.packagePlatform.readAsset.invoke({ id, path: assetPath })
      : request(`/api/packages/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetPath)}`),
};
