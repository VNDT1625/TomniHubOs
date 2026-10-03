/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeImageGeneration: vi.fn(),
  listReadyProviders: vi.fn(),
}));

vi.mock('@/common/chat/imageGenCore', () => ({
  executeImageGeneration: mocks.executeImageGeneration,
}));

vi.mock('@process/services/tomnyProviderBridge', () => ({
  listReadyProviders: mocks.listReadyProviders,
}));

import { runImage } from '@/process/makevideo/makeVideoBridge';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('MakeVideo remote image containment', () => {
  it('fails closed before provider lookup, credential handoff, or network transport', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      runImage({
        projectId: 'project-1',
        sceneId: 'scene-1',
        prompt: 'a non-secret test image prompt',
        model: 'image-model',
      })
    ).rejects.toThrow('MAKEVIDEO_IMAGE_REMOTE_TRANSPORT_DISABLED');

    expect(mocks.listReadyProviders).not.toHaveBeenCalled();
    expect(mocks.executeImageGeneration).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
