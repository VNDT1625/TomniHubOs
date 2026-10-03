/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  detectNewApiProtocol,
  getPlatformByValue,
  getSuggestedModelsForPlatform,
} from '@/renderer/utils/model/modelPlatforms';

vi.mock('@/renderer/utils/platform', () => ({
  resolveBackendAssetUrl: (path: string) => path,
}));

describe('modelPlatforms', () => {
  it('does not expose the managed gateway as a manually configured direct provider', () => {
    expect(getPlatformByValue('9router')).toBeUndefined();
  });

  it('detects Anthropic protocol for prefixed 9Router Claude model ids', () => {
    // External custom gateways still benefit from model-name protocol detection.
    expect(detectNewApiProtocol('freemodel/claude-opus-4-8')).toBe('anthropic');
    expect(detectNewApiProtocol('kr/claude-sonnet-4.5')).toBe('anthropic');
  });

  it('provides suggested models including local proxy and popular options for custom platforms', () => {
    const customModels = getSuggestedModelsForPlatform('custom');
    expect(customModels.some((m) => m.value === 'ag/gemini-3.8-flash-medium')).toBe(true);
    expect(customModels.some((m) => m.value === 'gemini-2.5-flash')).toBe(true);
    expect(customModels.some((m) => m.value === 'gpt-4o')).toBe(true);

    const geminiModels = getSuggestedModelsForPlatform('gemini');
    expect(geminiModels.some((m) => m.value === 'gemini-2.5-flash')).toBe(true);

    const anthropicModels = getSuggestedModelsForPlatform('anthropic');
    expect(anthropicModels.some((m) => m.value === 'claude-3-7-sonnet')).toBe(true);
  });
});
