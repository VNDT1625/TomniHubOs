import { describe, expect, it, vi } from 'vitest';
import {
  UCON_CLI_SKINS,
  appearanceForCliSkin,
  encodeUconCliAvatar,
  paintUconCliBrand,
  parseUconCliAvatar,
  resolveUconCliSkin,
} from '@/renderer/components/agents/uconCliSkins';
import { resolveUconAppearance } from '@/renderer/components/agents/uconBotConfig';

describe('UCON CLI-branded identities', () => {
  it('offers the ten non-Tomny Core CLIs and Grok without changing the old Tomny character', () => {
    expect(UCON_CLI_SKINS.map((skin) => skin.id)).toEqual([
      'claude',
      'codex',
      'gemini',
      'deepseek',
      'cursor',
      'opencode',
      'kiro',
      'antigravity',
      'hermes',
      'openclaw',
      'grok',
    ]);
    expect(resolveUconCliSkin('tomny')).toBeNull();
    expect(resolveUconCliSkin('Tomny CLI')).toBeNull();
    expect(resolveUconAppearance('core')).toEqual(resolveUconAppearance('core'));
    expect(new Set(UCON_CLI_SKINS.map((skin) => skin.color)).size).toBeGreaterThan(5);
  });

  it('recognizes CLI IDs and CLI display names, never model names or substrings', () => {
    expect(resolveUconCliSkin('Claude Code')?.id).toBe('claude');
    expect(resolveUconCliSkin('claude-agent-acp')?.id).toBe('claude');
    expect(resolveUconCliSkin('gemini cli')?.id).toBe('gemini');
    expect(resolveUconCliSkin('deepseek-tui')?.id).toBe('deepseek');
    expect(resolveUconCliSkin('Grok CLI')?.id).toBe('grok');
    for (const model of ['claude-3-opus', 'gpt-5', 'gemini-2.5-pro', 'deepseek-r1', 'grok-4', 'openai/gpt-4o']) {
      expect(resolveUconCliSkin(model)).toBeNull();
    }
    expect(resolveUconCliSkin('')).toBeNull();
  });

  it('persists only known CLI skin names and keeps different silhouettes', () => {
    const unique = new Set<string>();
    for (const skin of UCON_CLI_SKINS) {
      expect(parseUconCliAvatar(encodeUconCliAvatar(skin.id))?.id).toBe(skin.id);
      unique.add(JSON.stringify(appearanceForCliSkin(skin)));
    }
    expect(unique.size).toBeGreaterThanOrEqual(8);
    expect(parseUconCliAvatar('uconcli:tomny')).toBeNull();
    expect(parseUconCliAvatar('uconcli:../../claude')).toBeNull();
  });

  it('paints distinct accent and emblem vectors without repainting the base canvas', () => {
    const calls: string[] = [];
    const gradient = { addColorStop: vi.fn() };
    const context = new Proxy(
      { fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1 } as unknown as CanvasRenderingContext2D,
      {
        get(target, key) {
          const existing = Reflect.get(target, key);
          if (existing !== undefined) return existing;
          if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
          return (...args: unknown[]) => {
            calls.push(String(key) + JSON.stringify(args));
          };
        },
        set(target, key, value) {
          calls.push(String(key) + '=' + String(value));
          return Reflect.set(target, key, value);
        },
      }
    );
    for (const skin of UCON_CLI_SKINS) {
      calls.length = 0;
      paintUconCliBrand(context, skin);
      expect(calls.join('|')).toContain(skin.color);
      expect(calls.some((entry) => entry.startsWith('fill'))).toBe(true);
      if (skin.id !== 'deepseek') expect(calls.some((entry) => entry.startsWith('clearRect'))).toBe(false);
    }
  });
});
