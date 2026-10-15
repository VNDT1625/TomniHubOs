/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 6;
const STEP = 1.25;

export type View = { scale: number; x: number; y: number };
export const INITIAL_VIEW: View = { scale: 1, x: 0, y: 0 };

export const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** Changes the zoom so the point under the pointer (px, py, relative to the frame) stays where it is. */
export const zoomAt = (view: View, factor: number, px: number, py: number): View => {
  const scale = clampScale(view.scale * factor);
  if (scale === view.scale) return view;
  const ratio = scale / view.scale;
  return { scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
};

/** Saves SVG markup as a file the user can keep or place in a document. */
export const downloadSvg = (markup: string, filename: string): void => {
  const withNamespace = /<svg\b[^>]*\sxmlns=/iu.test(markup)
    ? markup
    : markup.replace(/<svg\b/iu, '<svg xmlns="http://www.w3.org/2000/svg"');
  const url = URL.createObjectURL(new Blob([withNamespace], { type: 'image/svg+xml;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.svg') ? filename : `${filename}.svg`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const toolButton: React.CSSProperties = {
  cursor: 'pointer',
  minWidth: 26,
  height: 24,
  padding: '0 7px',
  borderRadius: 6,
  border: '1px solid var(--bg-3)',
  background: 'var(--bg-2)',
  color: 'var(--text-primary)',
  fontSize: 12,
  lineHeight: '20px',
};

/**
 * Zoom, pan and export for a vector picture. Ctrl + wheel zooms (a plain wheel still scrolls the chat),
 * dragging pans, and the buttons do the same for people without a mouse wheel.
 */
const PanZoomFrame: React.FC<{
  svgMarkup: string;
  filename: string;
  label: string;
  height?: number;
  testId?: string;
}> = ({ svgMarkup, filename, label, height = 320, testId }) => {
  const [view, setView] = useState<View>(INITIAL_VIEW);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; origin: View } | null>(null);

  const zoomBy = useCallback((factor: number, around?: { x: number; y: number }) => {
    const box = frameRef.current?.getBoundingClientRect();
    const px = around?.x ?? (box ? box.width / 2 : 0);
    const py = around?.y ?? (box ? box.height / 2 : 0);
    setView((current) => zoomAt(current, factor, px, py));
  }, []);

  // A native listener, because React registers wheel handlers as passive and then `preventDefault` is ignored,
  // which would let the window zoom as well.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const box = frame.getBoundingClientRect();
      zoomBy(event.deltaY < 0 ? STEP : 1 / STEP, { x: event.clientX - box.left, y: event.clientY - box.top });
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === '+' || event.key === '=') zoomBy(STEP);
    else if (event.key === '-') zoomBy(1 / STEP);
    else if (event.key === '0') setView(INITIAL_VIEW);
    else return;
    event.preventDefault();
  };

  const percent = Math.round(view.scale * 100);

  return (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type='button' style={toolButton} aria-label='Thu nhỏ' onClick={() => zoomBy(1 / STEP)}>
          −
        </button>
        <button
          type='button'
          style={{ ...toolButton, minWidth: 52 }}
          aria-label='Đặt lại về 100%'
          onClick={() => setView(INITIAL_VIEW)}
        >
          {percent}%
        </button>
        <button type='button' style={toolButton} aria-label='Phóng to' onClick={() => zoomBy(STEP)}>
          +
        </button>
        <button
          type='button'
          style={toolButton}
          aria-label='Tải ảnh SVG'
          onClick={() => downloadSvg(svgMarkup, filename)}
        >
          Tải SVG
        </button>
      </div>
      <div
        ref={frameRef}
        role='img'
        aria-label={label}
        tabIndex={0}
        data-testid={testId ? `${testId}-viewport` : undefined}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY, origin: view };
          (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          setView({
            ...start.origin,
            x: start.origin.x + event.clientX - start.x,
            y: start.origin.y + event.clientY - start.y,
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        style={{
          position: 'relative',
          height,
          overflow: 'hidden',
          cursor: drag.current ? 'grabbing' : 'grab',
          touchAction: 'none',
          background: 'var(--bg-1)',
          borderRadius: 8,
          outline: 'none',
        }}
      >
        <div
          data-testid={testId ? `${testId}-content` : undefined}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: '0 0',
            display: 'inline-block',
            minWidth: '100%',
          }}
          dangerouslySetInnerHTML={{ __html: svgMarkup }}
        />
      </div>
    </div>
  );
};

export default PanZoomFrame;
