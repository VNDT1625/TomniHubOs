/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getSpotlightTarget, type SpotlightTarget } from '@/common/ui/spotlightTargets';
import { emitter } from '@/renderer/utils/emitter';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const HOLE_PADDING = 6;
const BUBBLE_WIDTH = 300;
const BUBBLE_GAP = 14;
const FIND_TIMEOUT_MS = 2_500;
const FOLLOW_INTERVAL_MS = 250;

type Rect = { left: number; top: number; width: number; height: number };

const measure = (element: Element): Rect | undefined => {
  const box = element.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return undefined;
  return { left: box.left, top: box.top, width: box.width, height: box.height };
};

const sameRect = (a: Rect | undefined, b: Rect | undefined): boolean =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

/** Where the coach mark sits: under the control when there is room, otherwise above it, always on screen. */
export const placeBubble = (
  rect: Rect,
  viewport: { width: number; height: number },
  bubbleHeight = 150
): { left: number; top: number; above: boolean } => {
  const below = rect.top + rect.height + HOLE_PADDING + BUBBLE_GAP;
  const fitsBelow = below + bubbleHeight <= viewport.height - 8;
  const top = fitsBelow ? below : Math.max(8, rect.top - HOLE_PADDING - BUBBLE_GAP - bubbleHeight);
  const centred = rect.left + rect.width / 2 - BUBBLE_WIDTH / 2;
  const left = Math.max(8, Math.min(centred, viewport.width - BUBBLE_WIDTH - 8));
  return { left, top, above: !fitsBelow };
};

const KEYFRAMES = `
@keyframes tomny-spotlight-pulse {
  0% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.75); }
  70% { box-shadow: 0 0 0 12px rgba(99, 102, 241, 0); }
  100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
}
@media (prefers-reduced-motion: reduce) {
  [data-spotlight-ring] { animation: none !important; }
}`;

/**
 * Darkens the screen except for one control and explains it in a bubble. It never changes anything by itself:
 * the user presses the control, or presses "Kích hoạt hộ tôi", which is the only way the control is clicked.
 */
const SpotlightOverlay: React.FC = () => {
  const navigate = useNavigate();
  const [target, setTarget] = useState<SpotlightTarget | undefined>();
  const [note, setNote] = useState<string | undefined>();
  const [rect, setRect] = useState<Rect | undefined>();
  const [searching, setSearching] = useState(false);
  const elementRef = useRef<Element | null>(null);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));

  const close = useCallback(() => {
    setTarget(undefined);
    setNote(undefined);
    setRect(undefined);
    setSearching(false);
    elementRef.current = null;
  }, []);

  useEffect(() => {
    const onRequest = (request: { targetId: string; note?: string }) => {
      const next = getSpotlightTarget(request.targetId);
      if (!next) return;
      elementRef.current = null;
      setRect(undefined);
      setNote(request.note);
      setTarget(next);
    };
    emitter.on('ui.spotlight', onRequest);
    return () => {
      emitter.off('ui.spotlight', onRequest);
    };
  }, []);

  // Find the control, going to its page first when it lives elsewhere, and keep following it as the layout moves.
  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const started = Date.now();
    setSearching(true);
    if (target.route && !document.querySelector(target.selector)) navigate(target.route);

    const tick = () => {
      if (cancelled) return;
      const element = document.querySelector(target.selector);
      const next = element ? measure(element) : undefined;
      if (element && next) {
        if (elementRef.current !== element) {
          element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
          elementRef.current = element;
        }
        setSearching(false);
        setRect((previous) => (sameRect(previous, next) ? previous : next));
      } else {
        elementRef.current = null;
        setRect(undefined);
        if (Date.now() - started > FIND_TIMEOUT_MS) setSearching(false);
      }
    };
    tick();
    const interval = window.setInterval(tick, FOLLOW_INTERVAL_MS);
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      tick();
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('resize', onResize);
    };
  }, [navigate, target]);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [close, target]);

  // The user pressing the highlighted control is the other way to finish.
  useEffect(() => {
    const element = elementRef.current;
    if (!target || !element || !rect) return;
    const onClick = () => window.setTimeout(close, 0);
    element.addEventListener('click', onClick, { once: true });
    return () => element.removeEventListener('click', onClick);
  }, [close, rect !== undefined, target]); // oxlint-disable-line react-hooks/exhaustive-deps

  if (!target) return null;

  const activate = () => {
    const element = elementRef.current;
    close();
    if (element instanceof HTMLElement) window.setTimeout(() => element.click(), 0);
  };

  const hole = rect && {
    left: Math.max(0, rect.left - HOLE_PADDING),
    top: Math.max(0, rect.top - HOLE_PADDING),
    width: rect.width + HOLE_PADDING * 2,
    height: rect.height + HOLE_PADDING * 2,
  };
  const bubble = rect ? placeBubble(rect, viewport) : undefined;
  const shade = 'rgba(8, 10, 20, 0.66)';

  return (
    <div data-testid='spotlight-overlay' style={{ position: 'fixed', inset: 0, zIndex: 10_000, pointerEvents: 'none' }}>
      <style>{KEYFRAMES}</style>
      {hole ? (
        <>
          {/* Four panels leave the control itself uncovered, so it can be pressed through the dark. */}
          <div
            style={{
              position: 'fixed',
              left: 0,
              top: 0,
              right: 0,
              height: hole.top,
              background: shade,
              pointerEvents: 'auto',
            }}
            onMouseDown={close}
          />
          <div
            style={{
              position: 'fixed',
              left: 0,
              top: hole.top + hole.height,
              right: 0,
              bottom: 0,
              background: shade,
              pointerEvents: 'auto',
            }}
            onMouseDown={close}
          />
          <div
            style={{
              position: 'fixed',
              left: 0,
              top: hole.top,
              width: hole.left,
              height: hole.height,
              background: shade,
              pointerEvents: 'auto',
            }}
            onMouseDown={close}
          />
          <div
            style={{
              position: 'fixed',
              left: hole.left + hole.width,
              top: hole.top,
              right: 0,
              height: hole.height,
              background: shade,
              pointerEvents: 'auto',
            }}
            onMouseDown={close}
          />
          <div
            data-spotlight-ring
            style={{
              position: 'fixed',
              left: hole.left,
              top: hole.top,
              width: hole.width,
              height: hole.height,
              borderRadius: 10,
              border: '2px solid rgb(129, 140, 248)',
              animation: 'tomny-spotlight-pulse 1.6s ease-out infinite',
              pointerEvents: 'none',
            }}
          />
        </>
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: shade, pointerEvents: 'auto' }} onMouseDown={close} />
      )}

      <div
        role='dialog'
        aria-live='polite'
        aria-label={target.label}
        data-testid='spotlight-bubble'
        style={{
          position: 'fixed',
          width: BUBBLE_WIDTH,
          ...(bubble
            ? { left: bubble.left, top: bubble.top }
            : { left: '50%', top: '40%', transform: 'translateX(-50%)' }),
          pointerEvents: 'auto',
          padding: '14px 16px',
          borderRadius: 14,
          background: 'var(--color-bg-1, #14141c)',
          color: 'var(--color-text-1, #f5f5f7)',
          border: '1px solid var(--color-border-2, rgba(255,255,255,0.14))',
          boxShadow: '0 18px 44px rgba(0, 0, 0, 0.45)',
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{target.label}</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--color-text-2, #c9c9d2)' }}>
          {rect
            ? target.hint
            : searching
              ? 'Đang tìm vị trí trên màn hình…'
              : `Chưa thấy "${target.label}" trên màn hình này.${target.route ? ' Mở đúng trang rồi thử lại.' : ''}`}
        </div>
        {note ? <div style={{ fontSize: 12, marginTop: 8, color: 'var(--color-text-3, #9a9aa8)' }}>{note}</div> : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type='button' data-testid='spotlight-dismiss' onClick={close} style={buttonStyle(false)}>
            {rect ? 'Tôi tự bấm' : 'Đóng'}
          </button>
          {rect ? (
            <button type='button' data-testid='spotlight-activate' onClick={activate} style={buttonStyle(true)}>
              Kích hoạt hộ tôi
            </button>
          ) : target.route ? (
            <button
              type='button'
              data-testid='spotlight-go'
              onClick={() => {
                if (target.route) navigate(target.route);
              }}
              style={buttonStyle(true)}
            >
              Đi tới trang
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const buttonStyle = (primary: boolean): React.CSSProperties => ({
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  padding: '6px 12px',
  borderRadius: 8,
  border: primary ? '1px solid transparent' : '1px solid var(--color-border-2, rgba(255,255,255,0.18))',
  background: primary ? 'rgb(99, 102, 241)' : 'transparent',
  color: primary ? '#fff' : 'var(--color-text-1, #f5f5f7)',
});

export default SpotlightOverlay;
