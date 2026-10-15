/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { TOMNI_GATEWAY_PROVIDER_ID } from '@/common/router9';
import { useGuidModelSelection } from '@/renderer/pages/guid/hooks/useGuidModelSelection';

const { configGet, configSet, providers } = vi.hoisted(() => ({
  configGet: vi.fn(),
  configSet: vi.fn(),
  providers: [
    {
      id: 'tomni-model-gateway',
      name: 'Tomny Gateway',
      platform: 'openai',
      models: ['gateway-model'],
    },
  ] as IProvider[],
}));

vi.mock('@/common/config/configService', () => ({ configService: { get: configGet, set: configSet } }));
vi.mock('@/renderer/hooks/agent/useGoogleAuthModels', () => ({ useGoogleAuthModels: () => ({ isGoogleAuth: false }) }));
vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({ useProvidersQuery: () => ({ data: providers }) }));

describe('useGuidModelSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configGet.mockReturnValue({ id: TOMNI_GATEWAY_PROVIDER_ID, use_model: 'gateway-model', reasoning_effort: 'high' });
    configSet.mockResolvedValue(undefined);
  });

  it('restores and persists the managed gateway reasoning effort', async () => {
    const { result } = renderHook(() => useGuidModelSelection());
    await waitFor(() => expect(result.current.current_model).toMatchObject({
      id: TOMNI_GATEWAY_PROVIDER_ID,
      use_model: 'gateway-model',
      reasoning_effort: 'high',
    }));

    await act(async () => {
      await (result.current as unknown as { setReasoningEffort: (effort: 'max') => Promise<void> }).setReasoningEffort('max');
    });

    expect(configSet).toHaveBeenLastCalledWith('tomnyagentic.defaultModel', {
      id: TOMNI_GATEWAY_PROVIDER_ID,
      use_model: 'gateway-model',
      reasoning_effort: 'max',
    } satisfies Pick<TProviderWithModel, 'id' | 'use_model' | 'reasoning_effort'>);
  });
});
