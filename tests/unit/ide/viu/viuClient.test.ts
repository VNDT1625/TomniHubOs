/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  methods: new Map<string, ReturnType<typeof vi.fn>>(),
}));

import { viuClient } from '@package-apps/design/renderer/viu/viuClient';

const invocation = (method: string): ReturnType<typeof vi.fn> => {
  const invoke = mocks.methods.get(method);
  if (!invoke) throw new Error(`Missing mocked Design VIU method for ${method}`);
  return invoke;
};

beforeEach(() => {
  mocks.methods.clear();
  const method = (name: string) => {
    const invoke = vi.fn(async (request: unknown) => ({ ok: true as const, data: request }));
    mocks.methods.set(name, invoke);
    return invoke;
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      electronAPI: {
        designViu: {
          create: method('create'),
          capture: method('capture'),
          analyzeImage: method('analyzeImage'),
          persist: method('persist'),
          inspect: method('inspect'),
          preview: method('preview'),
          commit: method('commit'),
          validate: method('validate'),
          grantAsset: method('grantAsset'),
          listAssets: method('listAssets'),
        },
      },
    },
  });
});

describe('VIU renderer bridge client', () => {
  it('denies legacy source and image operations without delegating them to Main', async () => {
    const create = { prompt: 'Build a product page', mode: 'professional' as const };
    const capture = { url: 'https://example.com', maxPages: 3 };
    const image = { assetRef: 'asset:sha256:hero' };

    const results = await Promise.all([
      viuClient.create(create),
      viuClient.capture(capture),
      viuClient.analyzeImage(image),
    ]);

    expect(results).toEqual([
      { ok: false, error: 'DESIGN_VIU_OPERATION_DENIED' },
      { ok: false, error: 'DESIGN_VIU_OPERATION_DENIED' },
      { ok: false, error: 'DESIGN_VIU_OPERATION_DENIED' },
    ]);
    expect(invocation('create')).not.toHaveBeenCalled();
    expect(invocation('capture')).not.toHaveBeenCalled();
    expect(invocation('analyzeImage')).not.toHaveBeenCalled();
  });

  it('denies persistence and raw asset grants without delegating them to Main', async () => {
    const persist = { workspaceKey: 'workspace-opaque', project: {} } as never;
    const grant = {
      workspaceKey: 'repo:C:\\repo',
      path: 'C:\\assets\\scene.glb',
      grantPath: 'C:\\assets\\scene.glb',
      mimeType: 'model/gltf-binary',
    };

    const results = await Promise.all([viuClient.persist(persist), viuClient.grantAsset(grant)]);

    expect(results).toEqual([
      { ok: false, error: 'DESIGN_VIU_OPERATION_DENIED' },
      { ok: false, error: 'DESIGN_VIU_OPERATION_DENIED' },
    ]);
    expect(invocation('persist')).not.toHaveBeenCalled();
    expect(invocation('grantAsset')).not.toHaveBeenCalled();
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

    expect(invocation('inspect')).toHaveBeenCalledWith({ workspaceKey });
    expect(invocation('listAssets')).toHaveBeenCalledWith({ workspaceKey });
    expect(invocation('validate')).toHaveBeenCalledWith({ workspaceKey });
    expect(invocation('preview')).toHaveBeenCalledWith(transactionRequest);
    expect(invocation('commit')).toHaveBeenCalledWith(transactionRequest);
  });
});
