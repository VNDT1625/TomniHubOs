import { describe, expect, it, vi } from 'vitest';
const config = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const listeners = new Set<() => void>();
  return {
    values,
    listeners,
    get: vi.fn((key: string) => values.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
      listeners.forEach((listener) => listener());
    }),
    remove: vi.fn(async (key: string) => {
      values.delete(key);
      listeners.forEach((listener) => listener());
    }),
    subscribe: vi.fn((_key: string, listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };
});
vi.mock('@/common/config/configService', () => ({ configService: config }));
import {
  UCON_DISPLAY_DEFAULTS,
  resetUconDisplayPrefs,
  setUconDisplayPref,
} from '@/renderer/components/agents/uconDisplayPrefs';

describe('UCON Display preferences', () => {
  it('defaults to enabled and only persists bounded display flags', async () => {
    config.values.clear();
    expect(UCON_DISPLAY_DEFAULTS).toMatchObject({
      enabled: true,
      animate: true,
      live: true,
      assistants: true,
      miniSubagents: true,
    });
    await setUconDisplayPref('animate', false);
    expect(config.values.get('ui.uconDisplay')).toMatchObject({ enabled: true, animate: false, live: true });
    await setUconDisplayPref('live', false);
    expect(config.values.get('ui.uconDisplay')).toMatchObject({ animate: false, live: false });
  });
  it('reset removes only cosmetic settings, not avatars or packages', async () => {
    config.values.set('avatars.persisted', 'ucon:engineer');
    await resetUconDisplayPrefs();
    expect(config.remove).toHaveBeenCalledWith('ui.uconDisplay');
    expect(config.values.get('avatars.persisted')).toBe('ucon:engineer');
  });
});
