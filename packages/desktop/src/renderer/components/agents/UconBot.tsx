import type { HubActivityItem } from '@/common/types/agent/hubActivity';
import React, { useEffect, useRef } from 'react';
import { paintUconBot, type UconBotRole, type UconBotState } from './uconBotScene';

export type { UconBotRole, UconBotState } from './uconBotScene';

type UconBotProps = {
  state: UconBotState;
  role?: UconBotRole;
  size?: 'mini' | 'small' | 'large';
  label: string;
  className?: string;
};

/**
 * Maps published, redacted Hub activity to visual state. There is no inference
 * from prompt text, and a displayed panel must never imply a tool invocation.
 */
export function uconBotStateFromActivity(item: HubActivityItem): UconBotState {
  switch (item.status) {
    case 'done':
      return 'success';
    case 'error':
      return 'error';
    case 'stopped':
      return 'offline';
    case 'needs_input':
      return 'waiting';
    case 'running':
      return item.kind !== 'agent' || item.steps.some((step) => step.state === 'running') ? 'working' : 'thinking';
  }
}

export function uconBotRoleFromActivity(item: HubActivityItem): UconBotRole {
  return item.kind === 'agent' ? 'primary' : item.kind;
}

// One animation clock for every bot displayed on Home; no per-card RAF loop.
type FrameListener = (now: number) => void;
const frameListeners = new Set<FrameListener>();
let frameId: number | undefined;
let lastPaintAt = 0;

function scheduleFrame(): void {
  if (frameId !== undefined || frameListeners.size === 0 || document.hidden) return;
  frameId = requestAnimationFrame((now) => {
    frameId = undefined;
    // 30fps is sufficient for expression changes; avoid 12+ expensive 2D repaints at 60fps.
    if (now - lastPaintAt >= 32) {
      lastPaintAt = now;
      for (const listener of frameListeners) listener(now);
    }
    scheduleFrame();
  });
}

function onPageVisibility(): void {
  if (document.hidden && frameId !== undefined) {
    cancelAnimationFrame(frameId);
    frameId = undefined;
  } else if (!document.hidden) scheduleFrame();
}

function subscribeToClock(listener: FrameListener): () => void {
  if (frameListeners.size === 0) document.addEventListener('visibilitychange', onPageVisibility);
  frameListeners.add(listener);
  scheduleFrame();
  return () => {
    frameListeners.delete(listener);
    if (frameListeners.size === 0) {
      document.removeEventListener('visibilitychange', onPageVisibility);
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      frameId = undefined;
    }
  };
}

/**
 * The DOM element owns only layout/semantics: shell, face, back-mounted orbital
 * apparatus and work panels are all generated on one pixel-density-aware canvas.
 */
export const UconBot: React.FC<UconBotProps> = ({ state, role = 'primary', size = 'small', label, className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof CanvasRenderingContext2D === 'undefined') return undefined;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      return undefined;
    }
    if (!ctx) return undefined;
    const context = ctx;
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    canvas.width = Math.round(220 * dpr);
    canvas.height = Math.round(220 * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const accent = getComputedStyle(canvas).getPropertyValue('--ucon-bot-accent').trim() || '#74b7ff';
    const detail = size === 'mini' ? 'mini' : 'full';
    let visible = true;
    let unsubscribe: (() => void) | undefined;

    const paint = (now: number) => {
      paintUconBot(context, { state, role, detail, accent, time: now / 1000 });
    };
    const stop = () => {
      unsubscribe?.();
      unsubscribe = undefined;
    };
    const resume = () => {
      stop();
      paint(reduced?.matches ? 0 : performance.now());
      if (visible && !reduced?.matches) unsubscribe = subscribeToClock(paint);
    };
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? undefined
        : new IntersectionObserver(
            (entries) => {
              visible = entries[0]?.isIntersecting ?? false;
              resume();
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
  }, [state, role, size]);

  return (
    <span
      className={'ucon-bot ucon-bot--' + size + (className ? ' ' + className : '')}
      data-state={state}
      data-role={role}
    >
      <canvas ref={canvasRef} role='img' aria-label={label} />
    </span>
  );
};
