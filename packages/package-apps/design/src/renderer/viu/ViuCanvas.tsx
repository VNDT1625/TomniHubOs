/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ViuDocument, ViuNode } from '@package-apps/design/renderer/viu/viuClient';

type ViuCanvasProps = {
  document: ViuDocument;
  selectedNodeId: string | null;
  referencePreviewDataUrl?: string;
  showReference: boolean;
  showLayers: boolean;
  onSelectNode: (nodeId: string) => void;
  onChangeNode: (nodeId: string, patch: Partial<ViuNode>) => void;
};

type DragState = {
  nodeId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
};

const safeCssColor = (value: string | undefined, fallback: string): string => value?.trim() || fallback;

const ViuCanvas: React.FC<ViuCanvasProps> = ({
  document,
  selectedNodeId,
  referencePreviewDataUrl,
  showReference,
  showLayers,
  onSelectNode,
  onChangeNode,
}) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(960);
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = (): void => setViewportWidth(element.clientWidth || 960);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale = useMemo(
    () => Math.max(0.08, Math.min(1, (viewportWidth - 56) / Math.max(1, document.page.width))),
    [document.page.width, viewportWidth]
  );
  const orderedNodes = useMemo(
    () => document.nodes.filter((node) => node.visible).toSorted((left, right) => left.zIndex - right.zIndex),
    [document.nodes]
  );

  useEffect(() => {
    if (!drag) return;
    const handleMove = (event: PointerEvent): void => {
      if (event.pointerId !== drag.pointerId) return;
      const node = document.nodes.find((candidate) => candidate.id === drag.nodeId);
      if (!node || node.locked) return;
      const nextX = drag.startX + (event.clientX - drag.startClientX) / scale;
      const nextY = drag.startY + (event.clientY - drag.startClientY) / scale;
      onChangeNode(node.id, {
        rect: {
          ...node.rect,
          x: Math.round(Math.max(0, nextX)),
          y: Math.round(Math.max(0, nextY)),
        },
      });
    };
    const handleUp = (event: PointerEvent): void => {
      if (event.pointerId === drag.pointerId) setDrag(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [document.nodes, drag, onChangeNode, scale]);

  return (
    <div ref={viewportRef} className='size-full min-w-0 overflow-auto bg-fill-1 p-28px'>
      <div
        className='relative mx-auto origin-top-left shadow-lg'
        data-testid='viu-artboard'
        style={{
          width: document.page.width * scale,
          height: document.page.height * scale,
          background: document.page.background,
        }}
      >
        {showReference && referencePreviewDataUrl ? (
          <img
            src={referencePreviewDataUrl}
            alt=''
            draggable={false}
            className='absolute left-0 top-0 select-none pointer-events-none'
            style={{
              width: (document.sourceKind === 'url' ? document.viewport.width : document.page.width) * scale,
              height: (document.sourceKind === 'url' ? document.viewport.height : document.page.height) * scale,
              objectFit: 'fill',
            }}
          />
        ) : null}
        {showLayers
          ? orderedNodes.map((node) => {
              const selected = selectedNodeId === node.id;
              const referenceOverlay = Boolean(showReference && referencePreviewDataUrl);
              return (
                <div
                  key={node.id}
                  data-testid={`viu-node-${node.id}`}
                  data-viu-node-id={node.id}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    onSelectNode(node.id);
                    if (node.locked) return;
                    setDrag({
                      nodeId: node.id,
                      pointerId: event.pointerId,
                      startClientX: event.clientX,
                      startClientY: event.clientY,
                      startX: node.rect.x,
                      startY: node.rect.y,
                    });
                  }}
                  className={`absolute overflow-hidden select-none ${node.locked ? 'cursor-default' : 'cursor-move'}`}
                  style={{
                    left: node.rect.x * scale,
                    top: node.rect.y * scale,
                    width: node.rect.width * scale,
                    height: node.rect.height * scale,
                    zIndex: node.zIndex,
                    color: safeCssColor(node.style.color, 'inherit'),
                    backgroundImage: referenceOverlay ? undefined : node.style.backgroundImage,
                    backgroundPosition: node.style.backgroundPosition,
                    backgroundSize: node.style.backgroundSize,
                    backgroundRepeat: node.style.backgroundRepeat,
                    backgroundColor: referenceOverlay
                      ? node.kind === 'text'
                        ? 'transparent'
                        : 'color-mix(in srgb, var(--color-primary-6) 12%, transparent)'
                      : safeCssColor(node.style.fill, 'transparent'),
                    borderRadius: (node.style.radius ?? 0) * scale,
                    border:
                      selected || referenceOverlay
                        ? `${Math.max(1, scale)}px solid var(--color-primary-6)`
                        : node.style.borderWidth
                          ? `${node.style.borderWidth * scale}px solid ${safeCssColor(node.style.borderColor, 'transparent')}`
                          : undefined,
                    boxShadow: selected ? '0 0 0 2px var(--color-primary-3)' : node.style.shadow,
                    opacity: node.style.opacity ?? 1,
                    transform: node.style.transform,
                    filter: node.style.filter,
                    clipPath: node.style.clipPath,
                    mixBlendMode: node.style.mixBlendMode as React.CSSProperties['mixBlendMode'],
                    fontFamily: node.style.fontFamily,
                    fontSize: node.style.fontSize ? node.style.fontSize * scale : undefined,
                    fontWeight: node.style.fontWeight,
                    lineHeight: node.style.lineHeight,
                    padding: node.kind === 'button' ? `${10 * scale}px ${14 * scale}px` : undefined,
                    display: node.kind === 'button' ? 'flex' : undefined,
                    alignItems: node.kind === 'button' ? 'center' : undefined,
                    justifyContent: node.kind === 'button' ? 'center' : undefined,
                    whiteSpace: node.kind === 'text' ? 'pre-wrap' : undefined,
                  }}
                >
                  {node.asset?.kind === 'image' && node.asset.url ? (
                    <img
                      src={node.asset.url}
                      alt={node.asset.alt}
                      draggable={false}
                      className='size-full pointer-events-none'
                      style={{ objectFit: node.style.objectFit ?? 'fill', opacity: referenceOverlay ? 0.35 : 1 }}
                    />
                  ) : node.asset?.kind === 'video' && node.asset.url ? (
                    <video
                      src={node.asset.url}
                      aria-label={node.asset.alt}
                      muted
                      playsInline
                      preload='metadata'
                      className='size-full pointer-events-none'
                      style={{ objectFit: node.style.objectFit ?? 'fill', opacity: referenceOverlay ? 0.35 : 1 }}
                    />
                  ) : (
                    node.content
                  )}
                </div>
              );
            })
          : null}
      </div>
    </div>
  );
};

export default ViuCanvas;
