/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Space } from '@arco-design/web-react';
import { Cube } from '@icon-park/react';
import React, { useMemo, useRef, useState } from 'react';
import {
  compileViuImageStyle,
  compileViuPaintStyle,
  resolveViuComponentInstance,
  type ViuNode,
  type ViuProjectState,
} from '@/common/viu';
import {
  createViuSvgPathData,
  getViuVectorContours,
  replaceViuVectorContours,
  type ViuVectorGeometry,
  type ViuVectorPoint,
} from '@/common/viu/graphics/vector';
import type { ViuEditorMode, ViuNextLabels } from './types';
import ViuVectorGraphic from './runtime/ViuVectorGraphic';
import styles from './ViuNextCanvas.module.css';

export type ViuResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

export type ViuGesturePreview = {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type ViuNodeSurfaceProps = {
  project: ViuProjectState;
  nodeId: string;
  virtualNodes?: Readonly<Record<string, ViuNode>>;
  instanceOwner?: ViuNode;
  mode: ViuEditorMode;
  selectedNodeIds: readonly string[];
  preview: ViuGesturePreview | null;
  vectorEditNodeId: string | null;
  selectedVectorPointIds: readonly string[];
  vectorEditLabels: ViuNextLabels['vectorEdit'];

  resolveAssetUrl?: (assetId: string) => string | undefined;
  onSelect: (nodeId: string, additive: boolean) => void;
  onBeginMove: (event: React.PointerEvent, node: ViuNode) => void;
  onBeginResize: (event: React.PointerEvent, node: ViuNode, handle: ViuResizeHandle) => void;
  onActivate: (nodeId: string) => void;
  onEnterVectorEdit: (nodeId: string) => void;
  onExitVectorEdit: () => void;
  onSelectVectorPoint: (pointId: string, additive: boolean) => void;
  onAddVectorPoint: (nodeId: string, contourId: string, x: number, y: number) => void;
  onCommitVectorGeometry: (nodeId: string, geometry: ViuVectorGeometry) => void;
};

const fallbackBackground = (type: ViuNode['type']): string => {
  if (type === 'text') return 'transparent';
  if (type === 'control') return 'var(--color-primary-6)';
  if (type === 'vector') return 'var(--color-primary-light-3)';
  return 'var(--color-bg-2)';
};

const nodeStyle = (node: ViuNode, preview: ViuGesturePreview | null): React.CSSProperties => {
  const [a, b, c, d, transformX, transformY] = node.localTransform;
  const activePreview = preview?.nodeId === node.id ? preview : null;
  const x = activePreview?.x ?? transformX;
  const y = activePreview?.y ?? transformY;
  const width = activePreview?.width ?? node.size.width;
  const height = activePreview?.height ?? node.size.height;
  const isControl = node.type === 'control';

  const layoutMode = node.layout?.mode ?? 'none';
  const autoLayout = layoutMode !== 'none';
  const flowPosition = node.positionMode === 'flow';

  const paint = compileViuPaintStyle(node.style);

  return {
    position: flowPosition ? 'relative' : 'absolute',
    width: node.sizing.horizontal === 'fill' ? '100%' : node.sizing.horizontal === 'hug' ? 'fit-content' : width,
    height: node.sizing.vertical === 'fill' ? '100%' : node.sizing.vertical === 'hug' ? 'fit-content' : height,
    minWidth: node.sizing.minWidth,
    maxWidth: node.sizing.maxWidth,
    minHeight: node.sizing.minHeight,
    maxHeight: node.sizing.maxHeight,
    transform: flowPosition ? `matrix(${a}, ${b}, ${c}, ${d}, 0, 0)` : `matrix(${a}, ${b}, ${c}, ${d}, ${x}, ${y})`,
    boxSizing: 'border-box',
    background: node.type === 'vector' ? 'transparent' : (paint.background ?? fallbackBackground(node.type)),
    color: node.style.color ?? (isControl ? 'var(--color-bg-1)' : 'var(--color-text-1)'),
    borderColor: node.type === 'vector' ? 'transparent' : (paint.borderColor ?? 'transparent'),
    borderStyle: node.type === 'vector' ? 'none' : paint.borderStyle,
    borderWidth: node.type === 'vector' ? 0 : paint.borderWidth,
    borderRadius: node.style.borderRadii?.map((value) => `${value}px`).join(' ') ?? node.style.borderRadius,
    outline: node.type === 'vector' ? undefined : paint.outline,
    outlineOffset: node.type === 'vector' ? undefined : paint.outlineOffset,
    boxShadow: paint.boxShadow,
    filter: paint.filter,
    backdropFilter: paint.backdropFilter,
    opacity: node.style.opacity,
    overflow: node.style.overflow,
    fontFamily: node.style.fontFamily,
    fontSize: node.style.fontSize,
    fontWeight: node.style.fontWeight,
    fontStyle: node.style.fontStyle,
    lineHeight: node.style.lineHeight,
    letterSpacing: node.style.letterSpacing,
    textDecoration: node.style.textDecoration,
    textTransform: node.style.textTransform,
    textAlign: node.style.textAlign,
    display: autoLayout
      ? layoutMode === 'grid'
        ? 'grid'
        : 'flex'
      : isControl || node.type === 'text'
        ? 'flex'
        : undefined,
    flexDirection: layoutMode === 'horizontal' ? 'row' : layoutMode === 'vertical' ? 'column' : undefined,
    flexWrap: autoLayout && node.layout?.wrap ? 'wrap' : undefined,
    gridTemplateColumns:
      layoutMode === 'grid' ? `repeat(${Math.max(1, node.layout?.columns ?? 2)}, minmax(0, 1fr))` : undefined,
    gap: autoLayout ? node.layout?.gap : undefined,
    padding: autoLayout ? node.layout?.padding.map((value) => `${value}px`).join(' ') : undefined,
    alignItems: autoLayout
      ? node.layout?.align === 'start'
        ? 'flex-start'
        : node.layout?.align === 'end'
          ? 'flex-end'
          : node.layout?.align
      : node.type === 'text'
        ? node.style.verticalAlign === 'bottom'
          ? 'flex-end'
          : node.style.verticalAlign === 'middle'
            ? 'center'
            : 'flex-start'
        : isControl
          ? 'center'
          : undefined,
    justifyContent: autoLayout
      ? node.layout?.justify === 'start'
        ? 'flex-start'
        : node.layout?.justify === 'end'
          ? 'flex-end'
          : node.layout?.justify
      : node.type === 'text'
        ? node.style.textAlign === 'right'
          ? 'flex-end'
          : node.style.textAlign === 'center'
            ? 'center'
            : 'flex-start'
        : isControl
          ? 'center'
          : undefined,
    whiteSpace: node.type === 'text' ? 'pre-wrap' : undefined,
  };
};

const handleClassName = (handle: ViuResizeHandle): string =>
  ({
    nw: styles.handleNw,
    ne: styles.handleNe,
    sw: styles.handleSw,
    se: styles.handleSe,
  })[handle];

type VectorDrag = {
  pointerId: number;
  pointId: string;
  handle?: 'handleIn' | 'handleOut';
  geometry: ViuVectorGeometry;
};

type ViuVectorEditorOverlayProps = {
  nodeId: string;
  geometry: ViuVectorGeometry;
  width: number;
  height: number;
  selectedPointIds: readonly string[];
  labels: ViuNextLabels['vectorEdit'];
  onExit: () => void;
  onSelectPoint: (pointId: string, additive: boolean) => void;
  onAddPoint: (nodeId: string, contourId: string, x: number, y: number) => void;
  onCommit: (nodeId: string, geometry: ViuVectorGeometry) => void;
};

const localVectorPoint = (
  svg: SVGSVGElement,
  event: React.PointerEvent<SVGElement> | React.MouseEvent<SVGElement>,
  width: number,
  height: number
): { x: number; y: number } => {
  const bounds = svg.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * width,
    y: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * height,
  };
};

const updateVectorAnchor = (
  geometry: ViuVectorGeometry,
  pointIds: ReadonlySet<string>,
  x: number,
  y: number,
  anchorPoint: ViuVectorPoint
): ViuVectorGeometry => {
  const dx = x - anchorPoint.x;
  const dy = y - anchorPoint.y;
  return replaceViuVectorContours(
    geometry,
    getViuVectorContours(geometry).map((contour) => ({
      ...contour,
      points: contour.points.map((point) =>
        pointIds.has(point.id) ? { ...point, x: point.x + dx, y: point.y + dy } : point
      ),
    }))
  );
};

const updateVectorHandle = (
  geometry: ViuVectorGeometry,
  pointId: string,
  handle: 'handleIn' | 'handleOut',
  x: number,
  y: number
): ViuVectorGeometry =>
  replaceViuVectorContours(
    geometry,
    getViuVectorContours(geometry).map((contour) => ({
      ...contour,
      points: contour.points.map((point) => {
        if (point.id !== pointId) return point;
        const nextHandle = { x: x - point.x, y: y - point.y };
        const oppositeKey = handle === 'handleIn' ? 'handleOut' : 'handleIn';
        const opposite = point[oppositeKey];
        if (point.pointType === 'symmetric') {
          return { ...point, [handle]: nextHandle, [oppositeKey]: { x: -nextHandle.x, y: -nextHandle.y } };
        }
        if (point.pointType === 'smooth' && opposite) {
          const length = Math.hypot(opposite.x, opposite.y);
          const nextLength = Math.max(Number.EPSILON, Math.hypot(nextHandle.x, nextHandle.y));
          return {
            ...point,
            [handle]: nextHandle,
            [oppositeKey]: {
              x: (-nextHandle.x / nextLength) * length,
              y: (-nextHandle.y / nextLength) * length,
            },
          };
        }
        return { ...point, [handle]: nextHandle };
      }),
    }))
  );

const prepareSymmetricVectorHandles = (geometry: ViuVectorGeometry, pointId: string): ViuVectorGeometry =>
  replaceViuVectorContours(
    geometry,
    getViuVectorContours(geometry).map((contour) => ({
      ...contour,
      points: contour.points.map((point) =>
        point.id === pointId
          ? {
              ...point,
              pointType: 'symmetric',
              handleIn: point.handleIn ?? { x: 0, y: 0 },
              handleOut: point.handleOut ?? { x: 0, y: 0 },
            }
          : point
      ),
    }))
  );

const ViuVectorEditorOverlay: React.FC<ViuVectorEditorOverlayProps> = ({
  nodeId,
  geometry,
  width,
  height,
  selectedPointIds,
  labels,
  onExit,
  onSelectPoint,
  onAddPoint,
  onCommit,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<VectorDrag | null>(null);
  const [draft, setDraft] = useState<ViuVectorGeometry | null>(null);
  const activeGeometry = draft ?? geometry;
  const contours = getViuVectorContours(activeGeometry);
  const selected = new Set(selectedPointIds);
  const selectedContour =
    contours.find((contour) => contour.points.some((point) => selected.has(point.id))) ?? contours[0];

  const updateDrag = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (!drag || event.pointerId !== drag.pointerId || !svgRef.current) return;
    const position = localVectorPoint(svgRef.current, event, width, height);
    const anchor = getViuVectorContours(drag.geometry)
      .flatMap((contour) => contour.points)
      .find((point) => point.id === drag.pointId);
    if (!anchor) return;
    const next = drag.handle
      ? updateVectorHandle(drag.geometry, drag.pointId, drag.handle, position.x, position.y)
      : updateVectorAnchor(
          drag.geometry,
          selected.has(drag.pointId) ? selected : new Set([drag.pointId]),
          position.x,
          position.y,
          anchor
        );
    setDraft(next);
  };

  const finishDrag = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (draft) onCommit(nodeId, draft);
    setDrag(null);
    setDraft(null);
  };

  return (
    <div
      className={styles.vectorEditor}
      data-testid='viu-vector-editor'
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Space size={4} className={styles.vectorEditorToolbar}>
        <Button
          size='mini'
          type='secondary'
          onClick={() => {
            if (!selectedContour) return;
            onCommit(
              nodeId,
              replaceViuVectorContours(
                geometry,
                getViuVectorContours(geometry).map((contour) =>
                  contour.id === selectedContour.id ? { ...contour, closed: !contour.closed } : contour
                )
              )
            );
          }}
        >
          {selectedContour?.closed ? labels.openPath : labels.closePath}
        </Button>
        <Button size='mini' type='text' onClick={onExit}>
          {labels.exit}
        </Button>
      </Space>
      <svg
        ref={svgRef}
        className={styles.vectorEditorSvg}
        viewBox={`0 0 ${Math.max(1, width)} ${Math.max(1, height)}`}
        onPointerMove={updateDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        {contours.map((contour) => (
          <React.Fragment key={contour.id}>
            <path
              className={styles.vectorEditPath}
              d={createViuSvgPathData(contour.points, contour.closed)}
              data-testid={`viu-vector-contour-${contour.id}`}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (!svgRef.current) return;
                const point = localVectorPoint(svgRef.current, event, width, height);
                onAddPoint(nodeId, contour.id, point.x, point.y);
              }}
            />
            {contour.points.map((point) => {
              const isSelected = selected.has(point.id);
              return (
                <React.Fragment key={point.id}>
                  {isSelected && point.handleIn ? (
                    <>
                      <line
                        className={styles.vectorHandleLine}
                        x1={point.x}
                        y1={point.y}
                        x2={point.x + point.handleIn.x}
                        y2={point.y + point.handleIn.y}
                      />
                      <circle
                        className={styles.vectorHandle}
                        cx={point.x + point.handleIn.x}
                        cy={point.y + point.handleIn.y}
                        r={4}
                        data-testid={`viu-vector-handle-in-${point.id}`}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          event.currentTarget.setPointerCapture?.(event.pointerId);
                          setDrag({ pointerId: event.pointerId, pointId: point.id, handle: 'handleIn', geometry });
                        }}
                      />
                    </>
                  ) : null}
                  {isSelected && point.handleOut ? (
                    <>
                      <line
                        className={styles.vectorHandleLine}
                        x1={point.x}
                        y1={point.y}
                        x2={point.x + point.handleOut.x}
                        y2={point.y + point.handleOut.y}
                      />
                      <circle
                        className={styles.vectorHandle}
                        cx={point.x + point.handleOut.x}
                        cy={point.y + point.handleOut.y}
                        r={4}
                        data-testid={`viu-vector-handle-out-${point.id}`}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          event.currentTarget.setPointerCapture?.(event.pointerId);
                          setDrag({ pointerId: event.pointerId, pointId: point.id, handle: 'handleOut', geometry });
                        }}
                      />
                    </>
                  ) : null}
                  <circle
                    className={isSelected ? styles.vectorAnchorSelected : styles.vectorAnchor}
                    cx={point.x}
                    cy={point.y}
                    r={5}
                    data-testid={`viu-vector-anchor-${point.id}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      onSelectPoint(point.id, event.shiftKey || event.metaKey);
                      event.currentTarget.setPointerCapture?.(event.pointerId);
                      if (event.altKey) {
                        const prepared = prepareSymmetricVectorHandles(geometry, point.id);
                        setDraft(prepared);
                        setDrag({
                          pointerId: event.pointerId,
                          pointId: point.id,
                          handle: 'handleOut',
                          geometry: prepared,
                        });
                        return;
                      }
                      setDrag({ pointerId: event.pointerId, pointId: point.id, geometry });
                    }}
                  />
                </React.Fragment>
              );
            })}
          </React.Fragment>
        ))}
      </svg>
    </div>
  );
};
const ViuNodeSurface: React.FC<ViuNodeSurfaceProps> = ({
  project,
  nodeId,
  virtualNodes,
  instanceOwner,
  mode,
  selectedNodeIds,
  preview,
  vectorEditNodeId,
  selectedVectorPointIds,
  vectorEditLabels,

  resolveAssetUrl,
  onSelect,
  onBeginMove,
  onBeginResize,
  onActivate,
  onEnterVectorEdit,
  onExitVectorEdit,
  onSelectVectorPoint,
  onAddVectorPoint,
  onCommitVectorGeometry,
}) => {
  const storedNode = virtualNodes?.[nodeId] ?? project.nodes[nodeId];
  const resolvedInstance =
    !virtualNodes && storedNode?.componentInstance ? resolveViuComponentInstance(project, storedNode) : undefined;
  const node = resolvedInstance?.nodes[resolvedInstance.rootId] ?? storedNode;
  const ownerNode = resolvedInstance ? storedNode : instanceOwner;
  const interactionNode = ownerNode ?? node;
  const component =
    resolvedInstance?.component ??
    (ownerNode?.componentInstance ? project.components[ownerNode.componentInstance.componentId] : undefined);
  const componentInstance = ownerNode?.componentInstance;
  const className = useMemo(() => {
    if (!node) return styles.designNode;
    return [
      styles.designNode,
      mode !== 'present' && !interactionNode?.locked ? styles.editableNode : '',
      selectedNodeIds.includes(interactionNode?.id ?? nodeId) && mode !== 'present' && !instanceOwner
        ? styles.selectedNode
        : '',
      mode === 'prototype' && (interactionNode?.behaviorBindings.length ?? 0) > 0 ? styles.prototypeNode : '',
    ]
      .filter(Boolean)
      .join(' ');
  }, [instanceOwner, interactionNode, mode, node, nodeId, selectedNodeIds]);

  if (!node || !node.visible) return null;

  const vectorEditing = !instanceOwner && vectorEditNodeId === interactionNode.id && mode === 'design';
  const selected = !instanceOwner && selectedNodeIds.includes(interactionNode.id) && mode === 'design';
  const assetUrl = node.content?.assetId ? resolveAssetUrl?.(node.content.assetId) : undefined;
  const media =
    node.type === 'image' && assetUrl ? (
      <span
        className='pointer-events-none relative block size-full overflow-hidden'
        data-testid={`viu-image-viewport-${node.id}`}
      >
        <img
          className='pointer-events-none'
          data-testid={`viu-image-media-${node.id}`}
          style={compileViuImageStyle(node.imageTransform)}
          src={assetUrl}
          alt={node.semantics.label}
          draggable={false}
        />
      </span>
    ) : node.type === 'video' && assetUrl ? (
      <video className='pointer-events-none size-full object-cover' src={assetUrl} autoPlay muted loop playsInline />
    ) : node.type === 'model-3d' ? (
      <span className='pointer-events-none size-full flex-center text-t-tertiary'>
        <Cube theme='outline' size={Math.max(24, Math.min(72, node.size.width / 5))} />
      </span>
    ) : null;
  const vectorGraphic =
    node.type === 'vector' && node.vector ? (
      <ViuVectorGraphic
        className='pointer-events-none block size-full'
        geometry={node.vector}
        nodeStyle={node.style}
        width={node.size.width}
        height={node.size.height}
      />
    ) : null;

  return (
    <div
      className={className}
      data-testid={`viu-next-node-${node.id}`}
      data-viu-node-id={node.id}
      data-viu-component-id={component?.id}
      data-viu-component-source-id={resolvedInstance?.sourceNodeIdByResolvedId[node.id]}
      data-viu-component-variant={componentInstance ? JSON.stringify(componentInstance.variantSelection) : undefined}
      data-viu-component-properties={componentInstance ? JSON.stringify(componentInstance.propertyValues) : undefined}
      data-selected={selectedNodeIds.includes(interactionNode.id) && !instanceOwner ? 'true' : 'false'}
      role={node.semantics.role === 'button' ? 'button' : undefined}
      aria-label={node.semantics.label}
      style={nodeStyle(node, preview)}
      onClick={(event) => {
        if (mode !== 'present') return;
        event.stopPropagation();
        onActivate(interactionNode.id);
      }}
      onDoubleClick={(event) => {
        if (mode !== 'design' || interactionNode.type !== 'vector' || interactionNode.locked) return;
        event.stopPropagation();
        onEnterVectorEdit(interactionNode.id);
      }}
      onPointerDown={(event) => {
        if (mode === 'present') return;
        event.stopPropagation();
        onSelect(interactionNode.id, event.shiftKey || event.metaKey);
        if (!vectorEditing && !interactionNode.locked) onBeginMove(event, interactionNode);
      }}
    >
      {vectorGraphic ?? media ?? node.content?.text ?? null}
      {vectorEditing && node.vector ? (
        <ViuVectorEditorOverlay
          nodeId={interactionNode.id}
          geometry={node.vector}
          width={node.size.width}
          height={node.size.height}
          selectedPointIds={selectedVectorPointIds}
          labels={vectorEditLabels}
          onExit={onExitVectorEdit}
          onSelectPoint={onSelectVectorPoint}
          onAddPoint={onAddVectorPoint}
          onCommit={onCommitVectorGeometry}
        />
      ) : null}
      {node.childIds.map((childId) => (
        <ViuNodeSurface
          key={childId}
          project={project}
          nodeId={childId}
          virtualNodes={resolvedInstance?.nodes ?? virtualNodes}
          instanceOwner={ownerNode ?? instanceOwner}
          mode={mode}
          selectedNodeIds={selectedNodeIds}
          preview={preview}
          vectorEditNodeId={vectorEditNodeId}
          selectedVectorPointIds={selectedVectorPointIds}
          vectorEditLabels={vectorEditLabels}
          resolveAssetUrl={resolveAssetUrl}
          onSelect={onSelect}
          onBeginMove={onBeginMove}
          onBeginResize={onBeginResize}
          onActivate={onActivate}
          onEnterVectorEdit={onEnterVectorEdit}
          onExitVectorEdit={onExitVectorEdit}
          onSelectVectorPoint={onSelectVectorPoint}
          onAddVectorPoint={onAddVectorPoint}
          onCommitVectorGeometry={onCommitVectorGeometry}
        />
      ))}
      {selected
        ? (['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
            <div
              key={handle}
              aria-hidden='true'
              data-testid={`viu-next-resize-${handle}`}
              className={`${styles.resizeHandle} ${handleClassName(handle)}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                onBeginResize(event, interactionNode, handle);
              }}
            />
          ))
        : null}
    </div>
  );
};

export default ViuNodeSurface;
