import { describe, expect, it, vi } from 'vitest';
import {
  UCON_ARCHETYPES,
  archetypeForIdentity,
  encodeUconAvatar,
  parseUconAvatar,
  resolveUconAppearance,
  subagentAppearance,
} from '@/renderer/components/agents/uconBotConfig';
import { rearModeForState } from '@/renderer/components/agents/uconBotRear';
import { paintUconBot, UCON_STATE_COLORS } from '@/renderer/components/agents/uconBotScene';

describe('UCON visual identity and state contract', () => {
  it('provides 10 stable archetypes with visibly different accessories', () => {
    expect(UCON_ARCHETYPES).toHaveLength(10);
    expect(new Set(UCON_ARCHETYPES).size).toBe(10);
    const silhouettes = UCON_ARCHETYPES.map((a) => {
      const p = resolveUconAppearance(a);
      return [p.ears, p.headwear, p.outfit, p.prop, p.beard].join(':');
    });
    expect(new Set(silhouettes).size).toBe(10);
    expect(archetypeForIdentity('session-42')).toBe(archetypeForIdentity('session-42'));
    expect(resolveUconAppearance('engineer').eyes).toBe('code');
  });

  it('uses only the 5 approved state hues, separate from shapes and work glyphs', () => {
    expect(UCON_STATE_COLORS.sleep).toBe('#89919d');
    expect(UCON_STATE_COLORS.offline).toBe(UCON_STATE_COLORS.sleep);
    expect(UCON_STATE_COLORS.idle).toBe('#38ca85');
    expect(UCON_STATE_COLORS.waiting).toBe(UCON_STATE_COLORS.success);
    expect(UCON_STATE_COLORS.working).toBe('#428eff');
    expect(UCON_STATE_COLORS.thinking).toBe(UCON_STATE_COLORS.working);
    expect(UCON_STATE_COLORS.error).toBe('#f05264');
    expect(UCON_STATE_COLORS.needs_input).toBe('#ffaf42');
    expect(rearModeForState('sleep')).toBe('sleep');
    expect(rearModeForState('thinking')).toBe('orbit');
    expect(rearModeForState('working')).toBe('panels');
    expect(rearModeForState('success')).toBe('pulse');
  });

  it('roundtrips a user assistant avatar and rejects malformed values', () => {
    const encoded = encodeUconAvatar({
      archetype: 'scholar',
      overrides: { ears: 'square', beard: 'circuit', prop: 'scanner' },
    });
    const parsed = parseUconAvatar(encoded);
    expect(parsed?.archetype).toBe('scholar');
    expect(resolveUconAppearance(parsed?.archetype, parsed?.overrides)).toMatchObject({
      ears: 'square',
      beard: 'circuit',
      prop: 'scanner',
    });
    expect(parseUconAvatar('ucon:invalid')).toBeNull();
    expect(parseUconAvatar('ucon:core;ears=not-an-ear')).toBeNull();
    expect(parseUconAvatar('ucon:core;__proto__=x')).toBeNull();
    expect(parseUconAvatar('😀')).toBeNull();
    expect(resolveUconAppearance('core', { ears: 'invalid' as 'none' }).ears).toBe('none');
    expect(encoded.length).toBeLessThan(300);
  });

  it('subagents inherit clothing/props but change mini silhouette without modifying parent', () => {
    const parent = resolveUconAppearance('navigator');
    const child = subagentAppearance(parent, 'team-member-1');
    expect(child.outfit).toBe(parent.outfit);
    expect(child.prop).toBe(parent.prop);
    expect(child.nose).toBe(parent.nose);
    expect(child.ears).not.toBe(parent.ears);
    expect(child.headwear).toBe(parent.headwear);
    expect(child.eyes).toBe(parent.eyes);
    expect(child.apron).toBe(parent.apron);
    expect(resolveUconAppearance('navigator')).toEqual(parent);
  });

  it('fades rear hologram panels as they emerge, instead of popping to full opacity', () => {
    const opacityChanges: number[] = [];
    const c = new Proxy(
      {
        createLinearGradient: () => ({ addColorStop: () => undefined }),
        createRadialGradient: () => ({ addColorStop: () => undefined }),
      } as Record<string, unknown>,
      {
        get(target, key) {
          if (key === 'globalAlpha') return 1;
          return target[String(key)] ?? (() => undefined);
        },
        set(target, key, value: unknown) {
          if (key === 'globalAlpha' && typeof value === 'number') opacityChanges.push(value);
          target[String(key)] = value;
          return true;
        },
      }
    ) as unknown as CanvasRenderingContext2D;
    paintUconBot(c, {
      state: 'working',
      previousState: 'idle',
      transitionProgress: 0.5,
      time: 0,
      detail: 'full',
      appearance: resolveUconAppearance('engineer'),
    });
    expect(opacityChanges).toContain(0.45);
    expect(opacityChanges).toContain(0.35);
  });

  it('renders all archetypes across states and sizes without relying on browser UI', () => {
    const operations = [
      'clearRect',
      'save',
      'restore',
      'translate',
      'rotate',
      'scale',
      'beginPath',
      'ellipse',
      'arc',
      'moveTo',
      'lineTo',
      'stroke',
      'fill',
      'roundRect',
      'closePath',
      'quadraticCurveTo',
      'bezierCurveTo',
      'fillText',
    ];
    const c = Object.fromEntries(operations.map((name) => [name, vi.fn()]));
    const gradient = { addColorStop: vi.fn() };
    Object.assign(c, {
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
    });
    for (const archetype of UCON_ARCHETYPES) {
      for (const state of ['sleep', 'idle', 'thinking', 'working', 'needs_input', 'error', 'success'] as const) {
        paintUconBot(c as unknown as CanvasRenderingContext2D, {
          state,
          previousState: 'idle',
          transitionProgress: 0.5,
          time: 2.5,
          appearance: resolveUconAppearance(archetype),
          detail: 'full',
          taskGlyph: 'code',
        });
        paintUconBot(c as unknown as CanvasRenderingContext2D, {
          state,
          time: 0,
          appearance: resolveUconAppearance(archetype),
          detail: 'mini',
          isSubagent: true,
        });
      }
    }
    expect(c.clearRect).toHaveBeenCalledTimes(UCON_ARCHETYPES.length * 7 * 2);
    expect(c.restore).toHaveBeenCalled();
  });
});
