/**
 * @license
 * Copyright 2025 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { PluginOption } from 'vite';
import electronViteConfig from '../../../packages/desktop/electron.vite.config';

type RendererConfig = {
  plugins?: PluginOption[];
  server?: { proxy?: Record<string, { target?: string }> };
};

type ElectronConfig = { renderer?: RendererConfig };
type ElectronConfigFactory = (env: { command: 'serve'; mode: string }) => ElectronConfig;

const originalProxy = process.env.TOMNI_WEB_DEV_PROXY;

const pluginNames = (plugins: PluginOption[] = []): string[] =>
  plugins.flatMap((plugin) => {
    if (!plugin) return [];
    if (Array.isArray(plugin)) return pluginNames(plugin);
    return typeof plugin === 'object' && 'name' in plugin ? [plugin.name] : [];
  });

afterEach(() => {
  if (originalProxy === undefined) delete process.env.TOMNI_WEB_DEV_PROXY;
  else process.env.TOMNI_WEB_DEV_PROXY = originalProxy;
});

describe('Web renderer package API parity', () => {
  it('keeps the local Package API ahead of the backend proxy in dev:web', () => {
    process.env.TOMNI_WEB_DEV_PROXY = 'http://127.0.0.1:25809';

    const config = (electronViteConfig as unknown as ElectronConfigFactory)({
      command: 'serve',
      mode: 'development',
    });

    expect(pluginNames(config.renderer?.plugins)).toContain('vite-plugin-tomny-package-api');
    expect(config.renderer?.server?.proxy?.['/api']?.target).toBe('http://127.0.0.1:25809');
  });
});
