import type { HubActivityItem } from '@/common/types/agent/hubActivity';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  archetypeForIdentity,
  parseUconAvatar,
  resolveUconAppearance,
  subagentAppearance,
  type UconAppearance,
  type UconAppearanceOverride,
  type UconArchetype,
  type UconEyes,
} from './uconBotConfig';
import { paintUconBot, type UconBotRole, type UconBotState } from './uconBotScene';
import { appearanceForCliSkin, paintUconCliBrand, parseUconCliAvatar, resolveUconCliSkin } from './uconCliSkins';
import { parsePackageAvatar, resolvePackagedAvatar, useUconPackageSkins } from './uconPackageSkins';
import { useUconDisplayPrefs } from './uconDisplayPrefs';

export type { UconBotRole, UconBotState } from './uconBotScene';
export type { UconArchetype, UconAppearanceOverride } from './uconBotConfig';

export type UconBotProps = {
  state: UconBotState;
  role?: UconBotRole;
  size?: 'mini' | 'small' | 'large' | 'preview';
  label: string;
  className?: string;
  /** Identity establishes appearance, never execution state. */
  identity?: string;
  /** Stable CLI agent/backend ID, never a model/provider id. Tomny retains its existing UCON. */
  cliAgentId?: string;
  /** Persisted assistant avatar marker: ucon:<archetype>[;slot=value...] */
  avatar?: string;
  archetype?: UconArchetype;
  appearanceOverrides?: UconAppearanceOverride;
  /** Explicit semantic tool category; never guessed from prompt or agent role. */
  taskGlyph?: UconEyes;
  isSubagent?: boolean;
  parentAppearance?: UconAppearance;
  /** Gallery previews remain available even if global avatars are disabled. */
  placement?: 'live' | 'assistant' | 'gallery';
  /** A still Canvas for grid galleries: no active animation subscription. */
  staticPreview?: boolean;
};

/** Only Main-published HubActivityStatus determines color and state. */
export function uconBotStateFromActivity(item: HubActivityItem): UconBotState {
  switch (item.status) {
    case 'done':
      return 'success';
    case 'error':
      return 'error';
    case 'stopped':
      return 'sleep';
    case 'needs_input':
      return 'needs_input';
    case 'running':
      return item.kind !== 'agent' || item.steps.some((step) => step.state === 'running') ? 'working' : 'thinking';
  }
}
export function uconBotRoleFromActivity(item: HubActivityItem): UconBotRole {
  return item.kind === 'agent' ? 'primary' : item.kind;
}
/** Kinds are structured runtime information; never parse arbitrary task text. */
export function uconBotTaskGlyphFromActivity(item: HubActivityItem): UconEyes | undefined {
  return item.kind === 'app' ? 'app' : item.kind === 'team' ? 'nodes' : undefined;
}

type FrameListener = (now: number) => void;
const frameListeners = new Set<FrameListener>();
let frameId: number | undefined;
let lastPaintAt = -Infinity;
function scheduleFrame(): void {
  if (frameId !== undefined || frameListeners.size === 0 || document.hidden) return;
  frameId = requestAnimationFrame((now) => {
    frameId = undefined;
    if (now - lastPaintAt >= 32) {
      lastPaintAt = now;
      for (const fn of frameListeners) fn(now);
    }
    scheduleFrame();
  });
}
function handleVisibility(): void {
  if (document.hidden && frameId !== undefined) {
    cancelAnimationFrame(frameId);
    frameId = undefined;
  } else if (!document.hidden) scheduleFrame();
}
function subscribe(fn: FrameListener): () => void {
  if (frameListeners.size === 0) document.addEventListener('visibilitychange', handleVisibility);
  frameListeners.add(fn);
  scheduleFrame();
  return () => {
    frameListeners.delete(fn);
    if (frameListeners.size === 0) {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      frameId = undefined;
      lastPaintAt = -Infinity;
    }
  };
}

/** Accessible Canvas 2D session identity. All avatars share one throttled animation clock. */
export const UconBot: React.FC<UconBotProps> = ({
  state,
  role = 'primary',
  size = 'small',
  label,
  className = '',
  identity,
  cliAgentId,
  avatar,
  archetype,
  appearanceOverrides,
  taskGlyph,
  isSubagent = false,
  parentAppearance,
  placement = 'live',
  staticPreview = false,
}) => {
  const display = useUconDisplayPrefs();
  const hidden =
    placement !== 'gallery' &&
    (!display.enabled ||
      (placement === 'live' && !display.live) ||
      (placement === 'assistant' && !display.assistants) ||
      (isSubagent && !display.miniSubagents));
  const frozen = staticPreview || !display.animate;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const packageSelection = useMemo(() => parsePackageAvatar(avatar), [avatar]);
  const customChoice = useMemo(() => parseUconAvatar(avatar), [avatar]);
  const cliSkin = useMemo(
    () => parseUconCliAvatar(avatar) ?? (customChoice || packageSelection ? null : resolveUconCliSkin(cliAgentId)),
    [avatar, cliAgentId, customChoice, packageSelection]
  );
  const availableSkins = useUconPackageSkins(Boolean(packageSelection));
  const packageAvailable = packageSelection
    ? resolvePackagedAvatar(packageSelection, availableSkins).fromPackage
    : undefined;
  const lastStateRef = useRef<UconBotState>(state);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || hidden || typeof CanvasRenderingContext2D === 'undefined') return undefined;
    let context: CanvasRenderingContext2D | null = null;
    try {
      context = canvas.getContext('2d');
    } catch {
      return undefined;
    }
    if (!context) return undefined;
    const ctx = context;
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    const px = size === 'mini' ? 36 : size === 'large' ? 70 : size === 'preview' ? 128 : 50;
    canvas.width = Math.round(px * dpr);
    canvas.height = Math.round(px * dpr);
    ctx.setTransform(canvas.width / 220, 0, 0, canvas.height / 220, 0, 0);
    const appearance =
      parentAppearance && isSubagent
        ? subagentAppearance(parentAppearance, identity ?? '')
        : packageSelection
          ? resolvePackagedAvatar(packageSelection, availableSkins).appearance
          : cliSkin && !archetype && !appearanceOverrides
            ? appearanceForCliSkin(cliSkin)
            : resolveUconAppearance(
                archetype ?? customChoice?.archetype ?? archetypeForIdentity(identity ?? ''),
                appearanceOverrides ?? customChoice?.overrides
              );
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const priorState = lastStateRef.current;
    lastStateRef.current = state;
    const changedAt = performance.now();
    let visible = true;
    let unsub: (() => void) | undefined;
    const paint = (now: number) => {
      const transitionProgress = reduced?.matches || frozen ? 1 : Math.min(1, (now - changedAt) / 340);
      paintUconBot(ctx, {
        state,
        previousState: priorState,
        transitionProgress,
        appearance,
        taskGlyph,
        isSubagent,
        detail: size === 'mini' ? 'mini' : 'full',
        time: reduced?.matches || frozen ? 0 : now / 1000,
      });
      if (cliSkin) paintUconCliBrand(ctx, cliSkin, isSubagent);
    };
    const stop = () => {
      unsub?.();
      unsub = undefined;
    };
    const resume = () => {
      stop();
      paint(reduced?.matches || frozen ? changedAt + 340 : performance.now());
      if (visible && !reduced?.matches && !frozen) unsub = subscribe(paint);
    };
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(
            (entries) => {
              visible = entries[0]?.isIntersecting ?? false;
              if (visible) resume();
              else stop();
            },
            { threshold: 0.01 }
          );
    observer?.observe(canvas);
    reduced?.addEventListener?.('change', resume);
    resume();
    return () => {
      stop();
      observer?.disconnect();
      reduced?.removeEventListener?.('change', resume);
    };
  }, [
    state,
    role,
    size,
    identity,
    avatar,
    cliAgentId,
    cliSkin,
    customChoice,
    archetype,
    appearanceOverrides,
    taskGlyph,
    isSubagent,
    parentAppearance,
    availableSkins,
    hidden,
    frozen,
  ]);
  return (
    <span
      className={'ucon-bot ucon-bot--' + size + (className ? ' ' + className : '')}
      data-state={state}
      data-role={role}
      data-cli-skin={cliSkin?.id}
      data-package-fallback={packageSelection ? String(!packageAvailable) : undefined}
      data-subagent={isSubagent ? 'true' : undefined}
      data-ucon-hidden={hidden ? 'true' : undefined}
    >
      {hidden ? (
        <span role='img' aria-label={label} className='ucon-bot__fallback'>
          ◈
        </span>
      ) : (
        <canvas ref={canvasRef} role='img' aria-label={label} />
      )}
    </span>
  );
};
