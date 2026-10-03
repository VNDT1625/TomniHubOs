/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRemoteCoreTarget } from '../../../../packages/desktop/src/process/experimentalCore/adapters/remote';
import { createElectronRemoteCoreServices } from '../../../../packages/desktop/src/process/experimentalCore/remoteElectronServices';

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true })));
});

const configPath = async (targets: unknown[]): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tomny-remote-core-'));
  temporaryPaths.push(directory);
  const filePath = path.join(directory, 'remote-targets.json');
  await fs.writeFile(filePath, JSON.stringify({ version: 1, targets }), 'utf8');
  return filePath;
};

const target = {
  id: 'controlled-remote',
  name: 'Controlled remote',
  endpoint: 'https://remote.example.test',
  credentialHandle: 'secret://remote-core-token',
  workspaceMappings: [{ localRoot: 'C:\\work', remoteRoot: '/work' }],
};

describe('createElectronRemoteCoreServices', () => {
  it('excludes configured remotes and denies before vault, HTTP, or WebSocket without Main authority', async () => {
    const vault = { resolve: vi.fn() };
    const fetchImpl = vi.fn();
    const socketFactory = vi.fn();
    const services = createElectronRemoteCoreServices(vault as never, await configPath([target]), {
      adapterOptions: { fetchImpl, socketFactory },
    });

    await expect(services.detectTargets()).resolves.toEqual([]);
    await expect(services.adapter.listModels(createRemoteCoreTarget(target))).rejects.toThrow(
      'REMOTE_CORE_EGRESS_DENIED'
    );
    await expect(
      services.adapter.run({
        sessionId: 'session',
        target: createRemoteCoreTarget(target),
        prompt: 'do not disclose',
        workspace: 'C:\\work',
        modelKey: 'model',
        permissionMode: 'workspace-write',
        signal: new AbortController().signal,
        emit: vi.fn(),
        requestPermission: vi.fn(async () => true),
      })
    ).rejects.toThrow('REMOTE_CORE_EGRESS_DENIED');

    expect(vault.resolve).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(socketFactory).not.toHaveBeenCalled();
  });

  it('admits only the exact target approved by a controlled Main authority', async () => {
    const approved = { ...target, id: 'approved-remote' };
    const rejected = { ...target, id: 'rejected-remote', endpoint: 'https://other.example.test' };
    const vault = { resolve: vi.fn(async () => ({ token: 'opaque-token' })) };
    const authority = {
      admitRemoteCoreTarget: vi.fn(
        async (candidate: { targetId: string; endpoint: string }) =>
          candidate.targetId === approved.id && candidate.endpoint === approved.endpoint
      ),
    };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/handshake')) {
        return new Response(
          JSON.stringify({
            protocol: 'tomny-remote',
            version: 1,
            compatibleVersions: [1],
            capabilities: {
              streaming: 'websocket',
              resume: false,
              permissions: false,
              cancellation: true,
              modelDiscovery: true,
            },
          })
        );
      }
      return new Response(JSON.stringify({ models: [{ id: 'approved-model' }] }));
    });
    const services = createElectronRemoteCoreServices(vault as never, await configPath([approved, rejected]), {
      authority,
      adapterOptions: { fetchImpl },
    });

    await expect(services.detectTargets()).resolves.toEqual([
      expect.objectContaining({ id: approved.id, available: true }),
    ]);
    await expect(services.adapter.listModels(createRemoteCoreTarget(approved))).resolves.toEqual([
      expect.objectContaining({ modelId: 'approved-model' }),
    ]);
    expect(vault.resolve).toHaveBeenCalledWith(expect.objectContaining({ handle: approved.credentialHandle }));
    expect(authority.admitRemoteCoreTarget).toHaveBeenCalledWith({
      targetId: approved.id,
      endpoint: approved.endpoint,
      allowInsecureLoopback: false,
    });
  });
});
