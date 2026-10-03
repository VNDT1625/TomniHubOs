import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configService } from '@/common/config/configService';
import { systemSettings } from '@/common/adapter/ipcBridge';

const jsonResponse = (data: unknown): Response =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('configService refresh', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort = 13400;
    configService.reset();
  });

  afterEach(() => {
    delete (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
    vi.unstubAllGlobals();
    configService.reset();
  });

  it('publishes a Telegram model changed outside the renderer cache', async () => {
    const selected = { id: 'provider-2', use_model: 'model-b' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ 'assistant.telegram.defaultModel': selected })));
    const subscriber = vi.fn();
    configService.subscribe('assistant.telegram.defaultModel', subscriber);

    await configService.refresh('assistant.telegram.defaultModel');

    expect(configService.get('assistant.telegram.defaultModel')).toEqual(selected);
    expect(subscriber).toHaveBeenCalledWith(selected);
  });

  it('does not publish when the backend value has not changed', async () => {
    const selected = { id: 'provider-1', use_model: 'model-a' };
    configService.setLocal('assistant.telegram.defaultModel', selected);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ 'assistant.telegram.defaultModel': selected })));
    const subscriber = vi.fn();
    configService.subscribe('assistant.telegram.defaultModel', subscriber);

    await configService.refresh('assistant.telegram.defaultModel');

    expect(subscriber).not.toHaveBeenCalled();
  });

  it('keeps the cached model when refreshing fails', async () => {
    const selected = { id: 'provider-1', use_model: 'model-a' };
    configService.setLocal('assistant.telegram.defaultModel', selected);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(configService.refresh('assistant.telegram.defaultModel')).rejects.toThrow('offline');

    expect(configService.get('assistant.telegram.defaultModel')).toEqual(selected);
  });
});

describe('configService Native Desktop IPC', () => {
  beforeEach(() => {
    configService.reset();
    (globalThis as unknown as { window?: unknown }).window = {
      electronAPI: {
        emit: vi.fn(),
        on: vi.fn(),
      },
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    vi.restoreAllMocks();
    configService.reset();
  });

  it('initializes from native systemSettings.getClientConfig IPC without HTTP', async () => {
    const mockConfig = {
      theme: 'dark',
      customCss: '.body { color: red; }',
      'developer.consoleOverlay': true,
    };
    vi.spyOn(systemSettings.getClientConfig, 'invoke').mockResolvedValue(mockConfig);

    await configService.initialize();

    expect(systemSettings.getClientConfig.invoke).toHaveBeenCalledTimes(1);
    expect(configService.get('theme')).toBe('dark');
    expect(configService.get('customCss')).toBe('.body { color: red; }');
    expect(configService.get('developer.consoleOverlay')).toBe(true);
  });

  it('persists set() through native systemSettings.setClientConfig IPC', async () => {
    const setSpy = vi.spyOn(systemSettings.setClientConfig, 'invoke').mockResolvedValue(undefined);
    const subscriber = vi.fn();
    configService.subscribe('theme', subscriber);

    await configService.set('theme', 'dark');

    expect(setSpy).toHaveBeenCalledWith({ key: 'theme', value: 'dark' });
    expect(configService.get('theme')).toBe('dark');
    expect(subscriber).toHaveBeenCalledWith('dark');
  });

  it('persists remove() through native systemSettings.removeClientConfig IPC', async () => {
    configService.setLocal('customCss', '.test {}');
    const removeSpy = vi.spyOn(systemSettings.removeClientConfig, 'invoke').mockResolvedValue(undefined);
    const subscriber = vi.fn();
    configService.subscribe('customCss', subscriber);

    await configService.remove('customCss');

    expect(removeSpy).toHaveBeenCalledWith({ key: 'customCss' });
    expect(configService.get('customCss')).toBeUndefined();
    expect(subscriber).toHaveBeenCalledWith(undefined);
  });

  it('persists setBatch() through native systemSettings.setBatchClientConfig IPC', async () => {
    const batchSpy = vi.spyOn(systemSettings.setBatchClientConfig, 'invoke').mockResolvedValue(undefined);

    await configService.setBatch({
      theme: 'light',
      'ui.zoomFactor': 1.2,
    });

    expect(batchSpy).toHaveBeenCalledWith({
      entries: {
        theme: 'light',
        'ui.zoomFactor': 1.2,
      },
    });
    expect(configService.get('theme')).toBe('light');
    expect(configService.get('ui.zoomFactor')).toBe(1.2);
  });

  it('refreshes through native systemSettings.getClientConfig IPC', async () => {
    configService.setLocal('theme', 'light');
    vi.spyOn(systemSettings.getClientConfig, 'invoke').mockResolvedValue({
      theme: 'dark',
    });
    const subscriber = vi.fn();
    configService.subscribe('theme', subscriber);

    const updated = await configService.refresh('theme');

    expect(updated).toBe('dark');
    expect(configService.get('theme')).toBe('dark');
    expect(subscriber).toHaveBeenCalledWith('dark');
  });
});
