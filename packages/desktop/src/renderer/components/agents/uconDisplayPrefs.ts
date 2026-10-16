import { configService } from '@/common/config/configService';
import { useSyncExternalStore } from 'react';

export type UconDisplayPrefs = {
  enabled: boolean;
  animate: boolean;
  live: boolean;
  assistants: boolean;
  miniSubagents: boolean;
};
export const UCON_DISPLAY_DEFAULTS: Readonly<UconDisplayPrefs> = Object.freeze({
  enabled: true,
  animate: true,
  live: true,
  assistants: true,
  miniSubagents: true,
});
const KEY = 'ui.uconDisplay' as const;

function sanitize(value: unknown): UconDisplayPrefs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return UCON_DISPLAY_DEFAULTS;
  const entries = value as Record<string, unknown>;
  return {
    enabled: typeof entries.enabled === 'boolean' ? entries.enabled : true,
    animate: typeof entries.animate === 'boolean' ? entries.animate : true,
    live: typeof entries.live === 'boolean' ? entries.live : true,
    assistants: typeof entries.assistants === 'boolean' ? entries.assistants : true,
    miniSubagents: typeof entries.miniSubagents === 'boolean' ? entries.miniSubagents : true,
  };
}
let lastRaw: unknown;
let lastValue: UconDisplayPrefs = UCON_DISPLAY_DEFAULTS;
function snapshot(): UconDisplayPrefs {
  const raw = configService.get(KEY);
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastValue = sanitize(raw);
  }
  return lastValue;
}
const subscribe = (listener: () => void): (() => void) => configService.subscribe(KEY, listener);

/** Shared live preferences: every UCON respects Display controls, including already-mounted sessions. */
export function useUconDisplayPrefs(): UconDisplayPrefs {
  return useSyncExternalStore(subscribe, snapshot, () => UCON_DISPLAY_DEFAULTS);
}
export function setUconDisplayPref<K extends keyof UconDisplayPrefs>(key: K, checked: boolean): Promise<void> {
  return configService.set(KEY, { ...snapshot(), [key]: checked });
}
/** Reset visibility/animation preferences; never delete installed skins or assistant avatars. */
export function resetUconDisplayPrefs(): Promise<void> {
  return configService.remove(KEY);
}
