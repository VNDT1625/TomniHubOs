/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SecretVault } from '@process/agentRuntime/secretVault';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  createRemoteCoreTarget,
  RemoteCoreAdapter,
  type DetectedCoreTarget,
  type RemoteAdapterOptions,
  type RemoteCredentialProvider,
  type RemoteTargetConnection,
  type RemoteTargetResolver,
} from './adapters';

export type ElectronRemoteCoreTarget = {
  id: string;
  name: string;
  endpoint: string;
  credentialHandle: string;
  enabled?: boolean;
  allowInsecureLoopback?: boolean;
  workspaceMappings: Array<{ localRoot: string; remoteRoot: string }>;
};

/**
 * Main-owned admission for a configured Remote Core target. This does not
 * expose a credential handle or workspace mappings to the authority.
 */
export type RemoteCoreTargetAuthority = Readonly<{
  admitRemoteCoreTarget(
    target: Readonly<{
      targetId: string;
      endpoint: string;
      allowInsecureLoopback: boolean;
    }>
  ): Promise<boolean>;
}>;

export type ElectronRemoteCoreServicesOptions = Readonly<{
  authority?: RemoteCoreTargetAuthority;
  adapterOptions?: RemoteAdapterOptions;
}>;

type RemoteCoreConfiguration = { version: 1; targets: ElectronRemoteCoreTarget[] };

const normalizeConfig = (value: unknown): RemoteCoreConfiguration => {
  if (!value || typeof value !== 'object') return { version: 1, targets: [] };
  const candidate = value as Partial<RemoteCoreConfiguration>;
  if (candidate.version !== 1 || !Array.isArray(candidate.targets)) return { version: 1, targets: [] };
  const ids = new Set<string>();
  const targets = candidate.targets.filter((target): target is ElectronRemoteCoreTarget => {
    if (!target || typeof target !== 'object') return false;
    const valid =
      typeof target.id === 'string' &&
      Boolean(target.id.trim()) &&
      !ids.has(target.id.trim()) &&
      typeof target.name === 'string' &&
      Boolean(target.name.trim()) &&
      typeof target.endpoint === 'string' &&
      Boolean(target.endpoint.trim()) &&
      typeof target.credentialHandle === 'string' &&
      target.credentialHandle.startsWith('secret://') &&
      Array.isArray(target.workspaceMappings);
    if (valid) ids.add(target.id.trim());
    return valid;
  });
  return { version: 1, targets };
};

const isMissing = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';

const mapWorkspace = (workspace: string, mappings: ElectronRemoteCoreTarget['workspaceMappings']): string => {
  const normalizedWorkspace = path.resolve(workspace);
  const matches = mappings
    .map((mapping) => ({ ...mapping, localRoot: path.resolve(mapping.localRoot) }))
    .filter((mapping) => {
      const relative = path.relative(mapping.localRoot, normalizedWorkspace);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    })
    .toSorted((left, right) => right.localRoot.length - left.localRoot.length);
  const selected = matches[0];
  if (!selected) throw new Error('No explicit remote workspace mapping covers the selected local workspace.');
  const relative = path.relative(selected.localRoot, normalizedWorkspace);
  return relative
    ? path.posix.join(selected.remoteRoot.replaceAll('\\', '/'), relative.replaceAll('\\', '/'))
    : selected.remoteRoot;
};

/** Main-process-only Remote wiring. Configuration stores opaque handles, never credential values. */
export const createElectronRemoteCoreServices = (
  vault: SecretVault,
  configPath: string,
  options: ElectronRemoteCoreServicesOptions = {}
): {
  adapter: RemoteCoreAdapter;
  detectTargets: () => Promise<DetectedCoreTarget[]>;
} => {
  const load = async (): Promise<RemoteCoreConfiguration> => {
    try {
      return normalizeConfig(JSON.parse(await fs.readFile(configPath, 'utf-8')));
    } catch (error) {
      if (isMissing(error)) return { version: 1, targets: [] };
      throw error;
    }
  };
  const isAdmitted = async (target: ElectronRemoteCoreTarget): Promise<boolean> => {
    if (target.enabled === false || !options.authority) return false;
    try {
      return await options.authority.admitRemoteCoreTarget({
        targetId: target.id,
        endpoint: target.endpoint,
        allowInsecureLoopback: target.allowInsecureLoopback === true,
      });
    } catch {
      return false;
    }
  };
  const targetFor = async (id: string): Promise<ElectronRemoteCoreTarget> => {
    const target = (await load()).targets.find((item) => item.id.trim() === id);
    if (!target || !(await isAdmitted(target))) throw new Error('Remote core target is unavailable.');
    return target;
  };
  const executionAuthority = {
    authorizeRemoteCoreTarget: async (target: DetectedCoreTarget): Promise<boolean> => {
      const configured = (await load()).targets.find((item) => item.id.trim() === target.id);
      return configured ? isAdmitted(configured) : false;
    },
  };
  const resolver: RemoteTargetResolver = {
    async resolve(target): Promise<RemoteTargetConnection> {
      const configured = await targetFor(target.id);
      return {
        endpoint: configured.endpoint,
        credentialHandle: configured.credentialHandle,
        allowInsecureLoopback: configured.allowInsecureLoopback,
        mapWorkspace: async (workspace) => mapWorkspace(workspace, configured.workspaceMappings),
      };
    },
  };
  const credentials: RemoteCredentialProvider = {
    async resolve(handle, request) {
      const payload = await vault.resolve({
        handle,
        surface: 'remote',
        purpose: request.purpose,
        target: request.targetId,
        fields: ['token'],
      });
      return { scheme: 'bearer', value: payload.token };
    },
  };
  return {
    adapter: new RemoteCoreAdapter(resolver, credentials, options.adapterOptions, executionAuthority),
    detectTargets: async () => {
      const targets = await Promise.all(
        (await load()).targets.map(async (target) => ({ target, admitted: await isAdmitted(target) }))
      );
      return targets
        .filter(({ admitted }) => admitted)
        .map(({ target }) =>
          createRemoteCoreTarget({
            id: target.id,
            name: target.name,
            available: true,
            detail: 'Remote Tomny Core gateway (opaque credential)',
            networkHost: (() => {
              try {
                return new URL(target.endpoint).hostname;
              } catch {
                return undefined;
              }
            })(),
          })
        );
    },
  };
};
