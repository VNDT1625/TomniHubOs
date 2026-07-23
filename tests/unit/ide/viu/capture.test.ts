/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { captureSiteProject } from '@/process/ide/viu/capture';
import type { IBrowserViewManager } from '@/process/browser/browserViewManager';

const nativeImage = {
  toPNG: () => Buffer.from('small-png'),
  getSize: () => ({ width: 1440, height: 900 }),
  resize: () => nativeImage,
};

const makeManager = (invalidPayload = false) => {
  let currentUrl = '';
  const executeJavaScript = vi.fn(async (script: string) => {
    if (script.includes('data.viuCapture')) return true;
    if (invalidPayload) return null;
    return {
      title: currentUrl.endsWith('/about') ? 'About' : 'Home',
      url: currentUrl,
      pageWidth: 1440,
      pageHeight: 2400,
      bodyBackground: 'rgb(255, 255, 255)',
      nodes: [
        {
          id: 'node-1',
          parentId: null,
          tag: 'img',
          text: '',
          rect: { x: 720, y: 120, width: 560, height: 420 },
          selector: 'body > img',
          styles: {
            'background-color': 'rgba(0, 0, 0, 0)',
            'background-image': 'linear-gradient(#fff, #eee)',
            'background-position': '50% 50%',
            'background-repeat': 'no-repeat',
            'background-size': 'cover',
            'object-fit': 'cover',
            opacity: '1',
            overflow: 'hidden',
            transform: 'none',
            'z-index': '4',
          },
          attributes: { src: 'https://example.com/hero.png', alt: 'Product preview' },
        },
        {
          id: 'node-2',
          parentId: null,
          tag: 'canvas',
          text: '',
          rect: { x: 900, y: 600, width: 300, height: 300 },
          selector: 'body > canvas',
          styles: { opacity: '1', overflow: 'visible', transform: 'none', 'z-index': '8' },
          attributes: {},
        },
      ],
      links: currentUrl.endsWith('/about') ? [] : ['https://example.com/about', 'https://outside.example/private'],
    };
  });
  const contents = {
    executeJavaScript,
    capturePage: vi.fn(async () => nativeImage),
  };
  const manager = {
    createTab: vi.fn(() => 'viu-tab'),
    loadURL: vi.fn(async (_tabId: string, url: string) => {
      currentUrl = url;
    }),
    getWebContents: vi.fn(() => contents),
    setBounds: vi.fn(),
    destroyTab: vi.fn(),
  };
  return { manager: manager as unknown as IBrowserViewManager, spies: manager };
};

describe('Viu URL capture', () => {
  it('walks same-origin pages and preserves assets, effects, z-order, and runtime boundaries', async () => {
    const { manager, spies } = makeManager();
    const project = await captureSiteProject(
      manager,
      { url: 'example.com', maxPages: 5, viewport: { width: 1280, height: 720 } },
      new Date('2026-07-22T00:00:00.000Z')
    );

    const image = project.documents[0]?.nodes.find((node) => node.id === 'node-1');
    const runtime = project.documents[0]?.nodes.find((node) => node.id === 'node-2');
    expect(project.documents).toHaveLength(2);
    expect(spies.loadURL).toHaveBeenCalledTimes(2);
    expect(spies.loadURL).not.toHaveBeenCalledWith('viu-tab', 'https://outside.example/private');
    expect(image?.asset).toEqual({ kind: 'image', url: 'https://example.com/hero.png', alt: 'Product preview' });
    expect(image?.style.backgroundImage).toContain('linear-gradient');
    expect(image?.zIndex).toBe(4);
    expect(runtime?.fidelity.strategy).toBe('runtime');
    expect(runtime?.runtime?.width).toBe(300);
    expect(spies.setBounds).toHaveBeenLastCalledWith('viu-tab', { x: 0, y: 0, width: 1280, height: 720 });
    expect(spies.destroyTab).toHaveBeenCalledWith('viu-tab');
  });

  it('always destroys the isolated tab when page evidence is invalid', async () => {
    const { manager, spies } = makeManager(true);
    await expect(captureSiteProject(manager, { url: 'https://example.com' })).rejects.toThrow(
      'valid Viu capture payload'
    );
    expect(spies.destroyTab).toHaveBeenCalledWith('viu-tab');
  });
});
