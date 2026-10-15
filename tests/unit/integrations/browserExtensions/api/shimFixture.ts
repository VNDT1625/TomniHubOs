import {
  createExtensionShim,
  type ExtensionShim,
  type ExtensionShimDeps,
} from '@process/integrations/browserExtensions/api/shim';
import type { CallerSource } from '@process/integrations/browserExtensions/api/identity';

export const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const ID_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

export const workerOf = (id: string): CallerSource => ({ kind: 'service-worker', scope: `chrome-extension://${id}/` });
export const pageOf = (id: string, page = 'popup.html'): CallerSource => ({
  kind: 'frame',
  url: `chrome-extension://${id}/${page}`,
});

export const manifestOf = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  manifest_version: 3,
  name: 'Fixture',
  version: '1.0.0',
  background: { service_worker: 'sw.js' },
  permissions: ['storage'],
  host_permissions: ['https://*.example.com/*'],
  optional_permissions: ['cookies', 'downloads'],
  optional_host_permissions: ['https://optional.test/*'],
  declarative_net_request: {
    rule_resources: [
      { id: 'ads', enabled: true, path: 'ads.json' },
      { id: 'extra', enabled: false, path: 'extra.json' },
    ],
  },
  ...extra,
});

/** A shim with the given extensions attached; `prompt` answers permission questions. */
export const shimWith = (
  extensions: Readonly<Record<string, Record<string, unknown>>>,
  deps: ExtensionShimDeps = {}
): ExtensionShim => {
  const shim = createExtensionShim({ log: () => undefined, audit: () => undefined, ...deps });
  for (const [extensionId, manifest] of Object.entries(extensions)) {
    shim.port.attach({ extensionId, packageId: 'com.community.ext', connectionId: `c-${extensionId[0]}`, manifest });
  }
  return shim;
};

export const call = (shim: ExtensionShim, source: CallerSource, method: string, ...args: unknown[]) =>
  shim.router.handle(source, { method, args });
