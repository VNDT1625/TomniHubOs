/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  providers: new Map<string, ReturnType<typeof vi.fn>>(),
}));

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: (channel: string) => {
      const invoke = vi.fn(async (request: unknown) => ({ ok: true, data: request }));
      mocks.providers.set(channel, invoke);
      return { invoke };
    },
  },
}));

import { viuClient } from '@/renderer/pages/studio/ide/Viu/viuClient';

const invocation = (channel: string): ReturnType<typeof vi.fn> => {
  const provider = mocks.providers.get(channel);
  if (!provider) throw new Error(`Missing mocked VIU provider for ${channel}`);
  return provider;
};

beforeEach(() => {
  for (const provider of mocks.providers.values()) provider.mockClear();
});

describe('VIU renderer bridge client', () => {
  it('forwards legacy creation inputs without changing source evidence', async () => {
    const create = { prompt: 'Build a product page', mode: 'professional' as const };
    const capture = { url: 'https://example.com', maxPages: 3 };
    const image = { path: 'C:\\assets\\hero.png' };

    await Promise.all([viuClient.create(create), viuClient.capture(capture), viuClient.analyzeImage(image)]);

    expect(invocation('ide.viu.create')).toHaveBeenCalledWith(create);
    expect(invocation('ide.viu.capture')).toHaveBeenCalledWith(capture);
    expect(invocation('ide.viu.analyze-image')).toHaveBeenCalledWith(image);
  });

  it('forwards persistence and asset grants through their dedicated channels', async () => {
    const persist = { rootPath: 'C:\\repo', project: {} } as never;
    const grant = {
      workspaceKey: 'repo:C:\\repo',
      path: 'C:\\assets\\scene.glb',
      grantPath: 'C:\\assets\\scene.glb',
      mimeType: 'model/gltf-binary',
    };

    await Promise.all([viuClient.persist(persist), viuClient.grantAsset(grant)]);

    expect(invocation('ide.viu.persist')).toHaveBeenCalledWith(persist);
    expect(invocation('ide.viu.asset.grant')).toHaveBeenCalledWith(grant);
  });

  it('wraps workspace inspection requests while preserving full transaction envelopes', async () => {
    const workspaceKey = 'repo:C:\\repo';
    const transactionRequest = { workspaceKey, transaction: { transactionId: 'tx-1' } } as never;

    await Promise.all([
      viuClient.inspectV2(workspaceKey),
      viuClient.listAssets(workspaceKey),
      viuClient.validateV2(workspaceKey),
      viuClient.previewV2(transactionRequest),
      viuClient.commitV2(transactionRequest),
    ]);

    expect(invocation('ide.viu.v2.inspect')).toHaveBeenCalledWith({ workspaceKey });
    expect(invocation('ide.viu.asset.list')).toHaveBeenCalledWith({ workspaceKey });
    expect(invocation('ide.viu.v2.validate')).toHaveBeenCalledWith({ workspaceKey });
    expect(invocation('ide.viu.v2.preview')).toHaveBeenCalledWith(transactionRequest);
    expect(invocation('ide.viu.v2.commit')).toHaveBeenCalledWith(transactionRequest);
  });
});