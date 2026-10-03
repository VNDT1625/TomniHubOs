/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Empty, Input, InputNumber, Switch, Tag, Tooltip } from '@arco-design/web-react';
import { Add, BezierCurve, Browser, Components, Picture, PlayOne, Rectangle, Text, TreeList } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyViuTransaction,
  createDefaultViuVectorGeometry,
  createPremiumStarterProject,
  createViuBooleanGeometry,
  createViuMaskGeometry,
  createViuNode,
  getViuVectorContours,
  releaseViuMaskGeometry,
  reorderViuMaskOperands,
  replaceViuVectorContours,
  type CreateViuNodeInput,
  type ViuCommand,
  type ViuNode,
  type ViuProjectState,
  type ViuTransactionResult,
  type ViuVectorBooleanKind,
  type ViuVectorGeometry,
  type ViuVectorMaskKind,
} from '@/common/viu';
import {
  createAlignViuBatch,
  createComponentInstanceViuBatch,
  createDeleteViuBatch,
  createDistributeViuBatch,
  createDuplicateViuBatch,
  createGroupViuBatch,
  createUngroupViuBatch,
  createViuHistoryJournal,
  recordViuHistory,
  redoViuHistory,
  replaceViuSelection,
  toggleViuSelectionNode,
  undoViuHistory,
  type ViuAuthoringBatch,
  type ViuHistoryJournal,
  type ViuSelection,
} from '@/common/viu/authoring';
import { EditorHeader, FloatingAgentDock } from '@package-apps/design/renderer/viu/next/chrome/index';

import { AuthoringInspector, useViuFontCatalog } from '@package-apps/design/renderer/viu/next/authoring/index';
import ComponentLibrary from '@package-apps/design/renderer/viu/next/authoring/ComponentLibrary';

import ViuAuthoringToolbar from '@package-apps/design/renderer/viu/next/ViuAuthoringToolbar';

import ViuAssetLibrary, {
  readViuDraggedAssetId,
  VIU_ASSET_DRAG_MIME,
  type ViuCanvasAsset,
} from '@package-apps/design/renderer/viu/next/ViuAssetLibrary';

import ViuNodeSurface, {
  type ViuGesturePreview,
  type ViuResizeHandle,
} from '@package-apps/design/renderer/viu/next/ViuNodeSurface';
import styles from '@package-apps/design/renderer/viu/next/ViuNextCanvas.module.css';
import type { ViuEditorMode, ViuNextCanvasProps } from '@package-apps/design/renderer/viu/next/types';

import { ViuPresentRuntime } from '@package-apps/design/renderer/viu/next/runtime/index';

type SidebarTab = 'pages' | 'layers' | 'assets' | 'components';

type NodeGesture = {
  kind: 'move' | 'resize';
  handle?: ViuResizeHandle;
  pointerId: number;
  nodeId: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
};

type PanGesture = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPanX: number;
  startPanY: number;
};

type LayerRow = { node: ViuNode; depth: number };
type EditableNodePatch = Partial<Omit<ViuNode, 'id' | 'parentId' | 'childIds' | 'version'>>;
type AddNodePreset = Pick<CreateViuNodeInput, 'type' | 'width' | 'height' | 'text' | 'style' | 'vector'>;

const MIN_ZOOM = 0.12;
const MAX_ZOOM = 2.4;
const MIN_NODE_SIZE = 24;
const SCREEN_GAP = 160;

const VIU_FONT_WEIGHT_OPTIONS = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((value) => ({
  value,
  label: String(value),
}));
const viuContainerLayoutStyle = (node: ViuNode): React.CSSProperties => {
  const layout = node.layout;
  if (!layout || layout.mode === 'none') return {};
  return {
    display: layout.mode === 'grid' ? 'grid' : 'flex',
    flexDirection: layout.mode === 'horizontal' ? 'row' : layout.mode === 'vertical' ? 'column' : undefined,
    flexWrap: layout.wrap ? 'wrap' : undefined,
    gridTemplateColumns:
      layout.mode === 'grid' ? `repeat(${Math.max(1, layout.columns ?? 2)}, minmax(0, 1fr))` : undefined,
    gap: layout.gap,
    padding: layout.padding.map((value) => `${value}px`).join(' '),
    alignItems: layout.align === 'start' ? 'flex-start' : layout.align === 'end' ? 'flex-end' : layout.align,
    justifyContent: layout.justify === 'start' ? 'flex-start' : layout.justify === 'end' ? 'flex-end' : layout.justify,
    boxSizing: 'border-box',
  };
};

let idSequence = 0;

const nextId = (prefix: string): string => {
  idSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSequence.toString(36)}`;
};

const clampZoom = (value: number): number => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));

const flattenLayers = (project: ViuProjectState, rootNodeId: string): LayerRow[] => {
  const rows: LayerRow[] = [];
  const visited = new Set<string>();
  const visit = (nodeId: string, depth: number): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = project.nodes[nodeId];
    if (!node) return;
    rows.push({ node, depth });
    node.childIds.forEach((childId) => visit(childId, depth + 1));
  };
  visit(rootNodeId, 0);
  return rows;
};

const ViuNextCanvas: React.FC<ViuNextCanvasProps> = ({
  labels,
  project: controlledProject,
  localAssets = [],
  onProjectChange,
  onLinkAsset,
  onAgentRequest,

  teamPreviewReference,
  teamPreviewBusy = false,
  teamPreviewDisabled = false,
  onPublishPreview,
  onCopyPreviewReference,
  onModeChange,
  onSelectionChange,
  className,
}) => {
  const [project, setProject] = useState<ViuProjectState>(() => controlledProject ?? createPremiumStarterProject());
  const [mode, setMode] = useState<ViuEditorMode>('design');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('layers');
  const [selection, setSelection] = useState<ViuSelection>({ nodeIds: [], anchorId: null });
  const [vectorEditNodeId, setVectorEditNodeId] = useState<string | null>(null);
  const [selectedVectorPointIds, setSelectedVectorPointIds] = useState<string[]>([]);
  const [history, setHistory] = useState<ViuHistoryJournal>(() => createViuHistoryJournal());
  const selectedNodeId = selection.anchorId;
  const [activeScreenId, setActiveScreenId] = useState<string>(() => project.screenOrder[0] ?? '');
  const [presentScreenId, setPresentScreenId] = useState<string>(() => project.screenOrder[0] ?? '');
  const [zoom, setZoom] = useState(0.56);
  const [pan, setPan] = useState({ x: 88, y: 88 });
  const [nodeGesture, setNodeGesture] = useState<NodeGesture | null>(null);
  const [panGesture, setPanGesture] = useState<PanGesture | null>(null);
  const [preview, setPreview] = useState<ViuGesturePreview | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (controlledProject) {
      setProject(controlledProject);
      setSelection((current) => replaceViuSelection(controlledProject, current.nodeIds));
    }
  }, [controlledProject]);

  useEffect(() => {
    if (!project.screens[activeScreenId]) setActiveScreenId(project.screenOrder[0] ?? '');
  }, [activeScreenId, project.screenOrder, project.screens]);

  const activeScreen = project.screens[activeScreenId] ?? null;
  const selectedNode = selectedNodeId ? (project.nodes[selectedNodeId] ?? null) : null;

  const fontCatalog = useViuFontCatalog(selectedNode?.style.fontFamily);
  const selectedNodes = selection.nodeIds
    .map((nodeId) => project.nodes[nodeId])
    .filter((node): node is ViuNode => Boolean(node));
  const selectionParentIds = new Set(selectedNodes.map((node) => node.parentId));
  const canMutateSelection =
    selectedNodes.length > 0 && selectedNodes.every((node) => node.parentId !== null && !node.locked);
  const canGroupSelection = canMutateSelection && selectionParentIds.size === 1;
  const canUngroupSelection =
    selectedNodes.length === 1 && selectedNodes[0]?.type === 'group' && !selectedNodes[0].locked;
  const canAlignSelection = selectedNodes.length >= 2 && canGroupSelection;
  const canDistributeSelection = selectedNodes.length >= 3 && canGroupSelection;
  const selectedVectorNodes = selectedNodes.filter(
    (node): node is ViuNode & { vector: ViuVectorGeometry } => node.type === 'vector' && Boolean(node.vector)
  );
  const canCreateVectorComposite =
    selectedVectorNodes.length >= 2 &&
    selectedVectorNodes.length === selectedNodes.length &&
    selectedVectorNodes.every(
      (node) =>
        !node.locked &&
        !node.vector.booleanOperation &&
        !node.vector.maskOperation &&
        node.parentId === selectedVectorNodes[0]?.parentId &&
        getViuVectorContours(node.vector).every((contour) => contour.closed)
    );
  const canApplyVectorBoolean = canCreateVectorComposite;
  const selectedMaskNode =
    selectedVectorNodes.length === 1 && selectedVectorNodes[0]?.vector.maskOperation ? selectedVectorNodes[0] : null;

  useEffect(() => {
    if (vectorEditNodeId && !selection.nodeIds.includes(vectorEditNodeId)) {
      setVectorEditNodeId(null);
      setSelectedVectorPointIds([]);
    }
  }, [selection.nodeIds, vectorEditNodeId]);

  const selectNode = useCallback(
    (nodeId: string | null, additive = false): void => {
      setSelection((current) => {
        const next =
          nodeId === null
            ? { nodeIds: [], anchorId: null }
            : additive
              ? toggleViuSelectionNode(project, current, nodeId)
              : replaceViuSelection(project, [nodeId]);
        onSelectionChange?.(next.anchorId);
        return next;
      });
    },
    [onSelectionChange, project]
  );

  const commit = useCallback(
    (commands: ViuCommand[], summary: string, origin: 'canvas' | 'inspector'): ViuTransactionResult => {
      const transactionId = nextId('tx');
      const result = applyViuTransaction(project, {
        transactionId,
        documentId: project.projectId,
        baseRevision: project.revision,
        actor: { id: 'viu-next-user', kind: 'user' },
        origin,
        commands,
        mode: 'commit',
        summary,
      });
      if (result.accepted) {
        setProject(result.state);
        onProjectChange?.(result.state, result);

        setHistory((current) => recordViuHistory(current, { transactionId, summary, result }));
      }
      return result;
    },
    [onProjectChange, project]
  );

  const enterVectorEdit = useCallback(
    (nodeId: string): void => {
      const node = project.nodes[nodeId];
      if (node?.type !== 'vector' || !node.vector || node.locked) return;
      setVectorEditNodeId(nodeId);
      setSelectedVectorPointIds([]);
      selectNode(nodeId);
    },
    [project.nodes, selectNode]
  );

  const exitVectorEdit = useCallback((): void => {
    setVectorEditNodeId(null);
    setSelectedVectorPointIds([]);
  }, []);

  const selectVectorPoint = useCallback((pointId: string, additive: boolean): void => {
    setSelectedVectorPointIds((current) => {
      if (!additive) return current.includes(pointId) ? current : [pointId];
      return current.includes(pointId) ? current.filter((id) => id !== pointId) : [...current, pointId];
    });
  }, []);

  const commitVectorGeometry = useCallback(
    (nodeId: string, vector: ViuVectorGeometry): void => {
      commit([{ type: 'updateNode', nodeId, patch: { vector } }], project.nodes[nodeId]?.name ?? nodeId, 'canvas');
    },
    [commit, project.nodes]
  );

  const addVectorPoint = useCallback(
    (nodeId: string, contourId: string, x: number, y: number): void => {
      const node = project.nodes[nodeId];
      if (!node?.vector) return;
      const pointId = nextId('point');
      const contours = getViuVectorContours(node.vector).map((contour) => {
        if (contour.id !== contourId) return contour;
        const candidates = contour.closed
          ? contour.points.map((point, index) => [point, contour.points[(index + 1) % contour.points.length]!] as const)
          : contour.points.slice(0, -1).map((point, index) => [point, contour.points[index + 1]!] as const);
        let insertIndex = contour.points.length;
        let nearest = Number.POSITIVE_INFINITY;
        candidates.forEach(([start, end], index) => {
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const lengthSquared = dx * dx + dy * dy;
          const ratio =
            lengthSquared === 0
              ? 0
              : Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared));
          const projectedX = start.x + ratio * dx;
          const projectedY = start.y + ratio * dy;
          const distance = Math.hypot(x - projectedX, y - projectedY);
          if (distance < nearest) {
            nearest = distance;
            insertIndex = index + 1;
          }
        });
        const points = [...contour.points];
        points.splice(insertIndex, 0, { id: pointId, x, y, pointType: 'corner' });
        return { ...contour, points };
      });
      commitVectorGeometry(nodeId, replaceViuVectorContours(node.vector, contours));
      setSelectedVectorPointIds([pointId]);
    },
    [commitVectorGeometry, project.nodes]
  );

  const deleteSelectedVectorPoints = useCallback((): void => {
    const node = vectorEditNodeId ? project.nodes[vectorEditNodeId] : undefined;
    if (!node?.vector || selectedVectorPointIds.length === 0) return;
    const selectedIds = new Set(selectedVectorPointIds);
    const contours = getViuVectorContours(node.vector);
    if (contours.some((contour) => contour.points.filter((point) => !selectedIds.has(point.id)).length < 2)) return;
    commitVectorGeometry(
      node.id,
      replaceViuVectorContours(
        node.vector,
        contours.map((contour) => ({
          ...contour,
          points: contour.points.filter((point) => !selectedIds.has(point.id)),
        }))
      )
    );
    setSelectedVectorPointIds([]);
  }, [commitVectorGeometry, project.nodes, selectedVectorPointIds, vectorEditNodeId]);

  const applyVectorBoolean = useCallback(
    (kind: ViuVectorBooleanKind): void => {
      if (!canApplyVectorBoolean) return;
      const first = selectedVectorNodes[0]!;
      const parent = first.parentId ? project.nodes[first.parentId] : undefined;
      if (!parent) return;
      const corners = selectedVectorNodes.flatMap((node) => {
        const [a, b, c, d, e, f] = node.localTransform;
        return [
          [0, 0],
          [node.size.width, 0],
          [node.size.width, node.size.height],
          [0, node.size.height],
        ].map(([x, y]) => ({ x: a * x! + c * y! + e, y: b * x! + d * y! + f }));
      });
      const minX = Math.min(...corners.map((point) => point.x));
      const minY = Math.min(...corners.map((point) => point.y));
      const maxX = Math.max(...corners.map((point) => point.x));
      const maxY = Math.max(...corners.map((point) => point.y));
      try {
        const vector = createViuBooleanGeometry(
          selectedVectorNodes.map((node) => {
            const [a, b, c, d, e, f] = node.localTransform;
            return { id: node.id, geometry: node.vector, transform: [a, b, c, d, e - minX, f - minY] };
          }),
          kind
        );
        const resultId = nextId(`vector-${kind}`);
        const resultNode = createViuNode({
          id: resultId,
          name: labels.vectorEdit[kind],
          type: 'vector',
          parentId: parent.id,
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
          vector,
          style: first.style,
          semantics: { role: 'image', label: labels.vectorEdit[kind] },
        });
        const insertionIndex = Math.min(...selectedVectorNodes.map((node) => parent.childIds.indexOf(node.id)));
        const commands: ViuCommand[] = [
          ...selectedVectorNodes.map((node): ViuCommand => ({ type: 'deleteNode', nodeId: node.id })),
          { type: 'insertNode', node: resultNode, parentId: parent.id, index: insertionIndex },
        ];
        const result = commit(commands, labels.vectorEdit[kind], 'canvas');
        if (result.accepted) {
          const nextSelection = replaceViuSelection(result.state, [resultId]);
          setSelection(nextSelection);
          onSelectionChange?.(resultId);
        }
      } catch {
        // Invalid/open/incompatible operands are intentionally rejected without mutating the document.
      }
    },
    [canApplyVectorBoolean, commit, labels.vectorEdit, onSelectionChange, project.nodes, selectedVectorNodes]
  );
  const applyVectorMask = useCallback(
    (kind: ViuVectorMaskKind): void => {
      if (!canCreateVectorComposite) return;
      const first = selectedVectorNodes[0]!;
      const parent = first.parentId ? project.nodes[first.parentId] : undefined;
      if (!parent) return;
      const corners = selectedVectorNodes.flatMap((node) => {
        const [a, b, c, d, e, f] = node.localTransform;
        return [
          [0, 0],
          [node.size.width, 0],
          [node.size.width, node.size.height],
          [0, node.size.height],
        ].map(([x, y]) => ({ x: a * x! + c * y! + e, y: b * x! + d * y! + f }));
      });
      const minX = Math.min(...corners.map((point) => point.x));
      const minY = Math.min(...corners.map((point) => point.y));
      const maxX = Math.max(...corners.map((point) => point.x));
      const maxY = Math.max(...corners.map((point) => point.y));
      const label = kind === 'clip' ? labels.vectorEdit.clipMask : labels.vectorEdit.alphaMask;
      try {
        const vector = createViuMaskGeometry(
          selectedVectorNodes.map((node) => {
            const [a, b, c, d, e, f] = node.localTransform;
            return { id: node.id, geometry: node.vector, transform: [a, b, c, d, e - minX, f - minY] };
          }),
          kind,
          selectedVectorNodes.at(-1)!.id
        );
        const resultId = nextId(`vector-${kind}-mask`);
        const resultNode = createViuNode({
          id: resultId,
          name: label,
          type: 'vector',
          parentId: parent.id,
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
          vector,
          style: first.style,
          semantics: { role: 'image', label },
        });
        const insertionIndex = Math.min(...selectedVectorNodes.map((node) => parent.childIds.indexOf(node.id)));
        const commands: ViuCommand[] = [
          ...selectedVectorNodes.map((node): ViuCommand => ({ type: 'deleteNode', nodeId: node.id })),
          { type: 'insertNode', node: resultNode, parentId: parent.id, index: insertionIndex },
        ];
        const result = commit(commands, label, 'canvas');
        if (result.accepted) {
          const nextSelection = replaceViuSelection(result.state, [resultId]);
          setSelection(nextSelection);
          onSelectionChange?.(resultId);
        }
      } catch {
        // Invalid or nested operands are rejected without mutating the document.
      }
    },
    [canCreateVectorComposite, commit, labels.vectorEdit, onSelectionChange, project.nodes, selectedVectorNodes]
  );

  const releaseVectorMask = useCallback((): void => {
    if (!selectedMaskNode) return;
    commitVectorGeometry(selectedMaskNode.id, releaseViuMaskGeometry(selectedMaskNode.vector));
  }, [commitVectorGeometry, selectedMaskNode]);

  const reorderVectorMask = useCallback((): void => {
    const operation = selectedMaskNode?.vector.maskOperation;
    if (!selectedMaskNode || !operation) return;
    const order = operation.operands.map((operand) => operand.id);
    const first = order.shift();
    if (!first) return;
    order.push(first);
    commitVectorGeometry(selectedMaskNode.id, reorderViuMaskOperands(selectedMaskNode.vector, order));
  }, [commitVectorGeometry, selectedMaskNode]);

  const changeMode = (nextMode: ViuEditorMode): void => {
    setMode(nextMode);
    if (nextMode === 'present') {
      setPresentScreenId(activeScreenId || project.screenOrder[0] || '');
      selectNode(null);
    }
    onModeChange?.(nextMode);
  };

  const addNode = (kind: keyof ViuNextCanvasProps['labels']['add']): void => {
    if (!activeScreen) return;
    const root = project.nodes[activeScreen.rootNodeId];
    if (!root) return;
    const offset = root.childIds.length * 18;
    const presets: Record<keyof ViuNextCanvasProps['labels']['add'], AddNodePreset> = {
      frame: {
        type: 'frame' as const,
        width: 360,
        height: 220,
        text: undefined,
        style: {
          background: 'var(--color-bg-2)',
          borderColor: 'var(--color-border-2)',
          borderWidth: 1,
          borderRadius: 18,
        },
      },
      text: {
        type: 'text' as const,
        width: 420,
        height: 72,
        text: labels.add.text,
        style: {
          color: 'var(--color-text-1)',
          fontSize: 36,
          fontWeight: 720,
          lineHeight: 1.08,
        },
      },
      button: {
        type: 'control' as const,
        width: 180,
        height: 52,
        text: labels.add.button,
        style: {
          background: 'var(--color-primary-6)',
          color: 'var(--color-bg-1)',
          fontSize: 15,
          fontWeight: 700,
          borderRadius: 14,
        },
      },
      shape: {
        type: 'vector' as const,
        width: 180,
        height: 180,
        text: undefined,
        vector: createDefaultViuVectorGeometry(180, 180, 'rectangle'),
        style: { background: 'var(--color-primary-light-3)' },
      },
      pen: {
        type: 'vector' as const,
        width: 240,
        height: 140,
        text: undefined,
        vector: createDefaultViuVectorGeometry(240, 140, 'pen'),
        style: {
          background: 'transparent',
          borderColor: 'var(--color-primary-6)',
          borderWidth: 3,
          borderStyle: 'solid',
        },
      },
    };
    const preset = presets[kind];

    const id = nextId(`node-${kind}`);
    const node = createViuNode({
      id,
      name: labels.add[kind],
      type: preset.type,
      parentId: root.id,
      x: 72 + (offset % 180),
      y: 96 + (offset % 240),
      width: preset.width,
      height: preset.height,
      text: preset.text,
      vector: preset.vector,
      style: preset.style,
      semantics: kind === 'button' ? { role: 'button', label: labels.add.button } : undefined,
    });
    const result = commit([{ type: 'insertNode', node, parentId: root.id }], labels.add[kind], 'canvas');
    if (result.accepted) {
      const nextSelection = replaceViuSelection(result.state, [id]);
      setSelection(nextSelection);
      onSelectionChange?.(nextSelection.anchorId);
    }
  };

  const insertAsset = useCallback(
    (asset: ViuCanvasAsset, position?: { x: number; y: number }): void => {
      if (!activeScreen || asset.missing) return;
      const root = project.nodes[activeScreen.rootNodeId];
      if (!root) return;
      const isModel = asset.kind === 'model' || asset.kind === 'model-3d';
      const type = isModel ? 'model-3d' : asset.kind === 'video' ? 'video' : 'image';
      const width = isModel ? 520 : 480;
      const height = isModel ? 420 : 320;
      const id = nextId(`node-${type}`);
      const node = createViuNode({
        id,
        name: asset.displayName,
        type,
        parentId: root.id,
        x: Math.max(0, Math.round(position?.x ?? 96 + (root.childIds.length % 4) * 24)),
        y: Math.max(0, Math.round(position?.y ?? 96 + (root.childIds.length % 5) * 24)),
        width,
        height,
        style: {
          background: 'var(--color-fill-2)',
          borderColor: 'var(--color-border-2)',
          borderWidth: 1,
          borderRadius: 24,
          overflow: 'hidden',
        },
        semantics: { role: isModel || type === 'image' ? 'image' : 'region', label: asset.displayName },
      });
      node.content = { assetId: asset.id };
      const result = commit([{ type: 'insertNode', node, parentId: root.id }], asset.displayName, 'canvas');
      if (result.accepted) {
        const nextSelection = replaceViuSelection(result.state, [id]);
        setSelection(nextSelection);
        onSelectionChange?.(nextSelection.anchorId);
      }
    },
    [activeScreen, commit, onSelectionChange, project.nodes]
  );

  const updateNode = (nodeId: string, patch: EditableNodePatch): void => {
    commit([{ type: 'updateNode', nodeId, patch }], project.nodes[nodeId]?.name ?? nodeId, 'inspector');
  };

  const applyAuthoringBatch = useCallback(
    (batch: ViuAuthoringBatch): boolean => {
      if (batch.commands.length === 0) return false;
      const result = commit([...batch.commands], batch.intent, 'inspector');
      if (!result.accepted) return false;
      if (batch.nextSelection) {
        setSelection(batch.nextSelection);
        onSelectionChange?.(batch.nextSelection.anchorId);
      }
      return true;
    },
    [commit, onSelectionChange]
  );

  const insertLibraryComponent = useCallback(
    (componentId: string): boolean => {
      const component = project.components[componentId];
      const screen = project.screens[activeScreenId];
      const targetRoot = screen ? project.nodes[screen.rootNodeId] : undefined;
      const source = component ? project.nodes[component.rootNodeId] : undefined;
      if (!component || !targetRoot || !source) return false;
      const sequence = targetRoot.childIds.length;
      const maxX = Math.max(0, targetRoot.size.width - source.size.width);
      const maxY = Math.max(0, targetRoot.size.height - source.size.height);
      try {
        return applyAuthoringBatch(
          createComponentInstanceViuBatch(
            project,
            { nodeIds: [component.rootNodeId], anchorId: component.rootNodeId },
            {
              instanceId: nextId(`instance-${component.id}`),
              componentId: component.id,
              targetParentId: targetRoot.id,
              position: {
                x: Math.min(maxX, 80 + (sequence % 4) * 28),
                y: Math.min(maxY, 80 + (sequence % 5) * 28),
              },
            }
          )
        );
      } catch {
        return false;
      }
    },
    [activeScreenId, applyAuthoringBatch, project]
  );

  const runHistory = useCallback(
    (direction: 'undo' | 'redo'): void => {
      const execution =
        direction === 'undo'
          ? undoViuHistory(project, history, nextId('history-undo'))
          : redoViuHistory(project, history, nextId('history-redo'));
      if (!execution.result?.accepted) return;
      setProject(execution.state);
      setHistory(execution.journal);
      setSelection((current) => replaceViuSelection(execution.state, current.nodeIds));
      onProjectChange?.(execution.state, execution.result);
    },
    [history, onProjectChange, project]
  );

  const duplicateSelection = useCallback((): void => {
    if (!canMutateSelection) return;
    applyAuthoringBatch(
      createDuplicateViuBatch(project, selection, {
        idFactory: (kind, sourceId) => nextId(`${kind}-${sourceId}`),
      })
    );
  }, [applyAuthoringBatch, canMutateSelection, project, selection]);

  const deleteSelection = useCallback((): void => {
    if (!canMutateSelection) return;
    applyAuthoringBatch(createDeleteViuBatch(project, selection));
  }, [applyAuthoringBatch, canMutateSelection, project, selection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const commandKey = event.ctrlKey || event.metaKey;
      if (commandKey && event.key.toLocaleLowerCase('en-US') === 'z') {
        event.preventDefault();
        runHistory(event.shiftKey ? 'redo' : 'undo');
      } else if (commandKey && event.key.toLocaleLowerCase('en-US') === 'd') {
        event.preventDefault();
        duplicateSelection();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (vectorEditNodeId) exitVectorEdit();
        else if (selectedNode?.type === 'vector') enterVectorEdit(selectedNode.id);
      } else if (event.key === 'Escape' && vectorEditNodeId) {
        event.preventDefault();
        exitVectorEdit();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (vectorEditNodeId) deleteSelectedVectorPoints();
        else deleteSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    deleteSelectedVectorPoints,
    deleteSelection,
    duplicateSelection,
    enterVectorEdit,
    exitVectorEdit,
    runHistory,
    selectedNode,
    vectorEditNodeId,
  ]);

  const beginMove = (event: React.PointerEvent, node: ViuNode): void => {
    event.preventDefault();
    setNodeGesture({
      kind: 'move',
      pointerId: event.pointerId,
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: node.localTransform[4],
      startY: node.localTransform[5],
      startWidth: node.size.width,
      startHeight: node.size.height,
    });
    setPreview({
      nodeId: node.id,
      x: node.localTransform[4],
      y: node.localTransform[5],
      width: node.size.width,
      height: node.size.height,
    });
  };

  const beginResize = (event: React.PointerEvent, node: ViuNode, handle: ViuResizeHandle): void => {
    event.preventDefault();
    setNodeGesture({
      kind: 'resize',
      handle,
      pointerId: event.pointerId,
      nodeId: node.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: node.localTransform[4],
      startY: node.localTransform[5],
      startWidth: node.size.width,
      startHeight: node.size.height,
    });
    setPreview({
      nodeId: node.id,
      x: node.localTransform[4],
      y: node.localTransform[5],
      width: node.size.width,
      height: node.size.height,
    });
  };

  useEffect(() => {
    if (!nodeGesture && !panGesture) return;

    const handleMove = (event: PointerEvent): void => {
      if (nodeGesture && event.pointerId === nodeGesture.pointerId) {
        const deltaX = (event.clientX - nodeGesture.startClientX) / zoom;
        const deltaY = (event.clientY - nodeGesture.startClientY) / zoom;
        if (nodeGesture.kind === 'move') {
          setPreview({
            nodeId: nodeGesture.nodeId,
            x: Math.round(nodeGesture.startX + deltaX),
            y: Math.round(nodeGesture.startY + deltaY),
            width: nodeGesture.startWidth,
            height: nodeGesture.startHeight,
          });
          return;
        }

        const handle = nodeGesture.handle ?? 'se';
        const movesLeft = handle === 'nw' || handle === 'sw';
        const movesTop = handle === 'nw' || handle === 'ne';
        const width = Math.max(MIN_NODE_SIZE, Math.round(nodeGesture.startWidth + (movesLeft ? -deltaX : deltaX)));
        const height = Math.max(MIN_NODE_SIZE, Math.round(nodeGesture.startHeight + (movesTop ? -deltaY : deltaY)));
        setPreview({
          nodeId: nodeGesture.nodeId,
          x: Math.round(nodeGesture.startX + (movesLeft ? nodeGesture.startWidth - width : 0)),
          y: Math.round(nodeGesture.startY + (movesTop ? nodeGesture.startHeight - height : 0)),
          width,
          height,
        });
        return;
      }

      if (panGesture && event.pointerId === panGesture.pointerId) {
        setPan({
          x: panGesture.startPanX + event.clientX - panGesture.startClientX,
          y: panGesture.startPanY + event.clientY - panGesture.startClientY,
        });
      }
    };

    const handleUp = (event: PointerEvent): void => {
      if (nodeGesture && event.pointerId === nodeGesture.pointerId) {
        const node = project.nodes[nodeGesture.nodeId];
        if (node && preview) {
          commit(
            [
              {
                type: 'updateNode',
                nodeId: node.id,
                patch: {
                  localTransform: [
                    node.localTransform[0],
                    node.localTransform[1],
                    node.localTransform[2],
                    node.localTransform[3],
                    preview.x,
                    preview.y,
                  ],
                  size: { width: preview.width, height: preview.height },
                },
              },
            ],
            node.name,
            'canvas'
          );
        }
        setNodeGesture(null);
        setPreview(null);
      }
      if (panGesture && event.pointerId === panGesture.pointerId) setPanGesture(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [commit, nodeGesture, panGesture, preview, project.nodes, zoom]);

  const layers = useMemo(
    () => (activeScreen ? flattenLayers(project, activeScreen.rootNodeId) : []),
    [activeScreen, project]
  );

  const visibleScreenIds =
    mode === 'present' ? [presentScreenId].filter((id) => Boolean(project.screens[id])) : project.screenOrder;

  const fitActiveScreen = useCallback((): void => {
    const viewport = viewportRef.current;
    const targetScreenId = mode === 'present' ? presentScreenId : activeScreenId;
    const screen = project.screens[targetScreenId];
    if (!viewport || !screen || viewport.clientWidth === 0 || viewport.clientHeight === 0) return;
    const availableWidth = Math.max(320, viewport.clientWidth - 144);
    const availableHeight = Math.max(240, viewport.clientHeight - 128);
    const nextZoom = clampZoom(
      Math.min(availableWidth / screen.viewport.width, availableHeight / screen.viewport.height)
    );
    const screenIndex = mode === 'present' ? 0 : Math.max(0, project.screenOrder.indexOf(targetScreenId));
    const screenX = screenIndex * (screen.viewport.width + SCREEN_GAP);
    setZoom(nextZoom);
    setPan({
      x: (viewport.clientWidth - screen.viewport.width * nextZoom) / 2 - screenX * nextZoom,
      y: Math.max(56, (viewport.clientHeight - screen.viewport.height * nextZoom) / 2),
    });
  }, [activeScreenId, mode, presentScreenId, project.screenOrder, project.screens]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(fitActiveScreen);
    return () => window.cancelAnimationFrame(frame);
  }, [activeScreenId, fitActiveScreen, leftCollapsed, mode, rightCollapsed]);

  const activateNode = (nodeId: string): void => {
    const interaction = Object.values(project.interactions).find(
      (candidate) => candidate.sourceNodeId === nodeId && candidate.trigger === 'click'
    );
    if (interaction?.action.type === 'navigate' && project.screens[interaction.action.targetScreenId]) {
      setPresentScreenId(interaction.action.targetScreenId);
    }
  };

  const pagePanel = (
    <div className='flex flex-col gap-10px p-10px'>
      {project.pageOrder.map((pageId) => {
        const page = project.canvasPages[pageId];
        if (!page) return null;
        const pageScreens = project.screenOrder.filter(
          (screenId) => project.screens[screenId]?.canvasPageId === pageId
        );
        return (
          <section key={page.id} className='flex flex-col gap-5px'>
            <div className='px-8px text-11px font-700 uppercase tracking-0.08em text-t-tertiary'>{page.name}</div>
            {pageScreens.map((screenId) => {
              const screen = project.screens[screenId];
              if (!screen) return null;
              return (
                <Button
                  key={screen.id}
                  type={activeScreenId === screen.id ? 'secondary' : 'text'}
                  long
                  size='small'
                  icon={<Browser theme='outline' size={14} />}
                  className='!justify-start'
                  onClick={() => {
                    setActiveScreenId(screen.id);
                    selectNode(screen.rootNodeId);
                  }}
                >
                  <span className='truncate'>{screen.name}</span>
                </Button>
              );
            })}
          </section>
        );
      })}
    </div>
  );

  const layerPanel = (
    <div className='flex flex-col gap-2px p-8px'>
      {layers.map(({ node, depth }) => (
        <Button
          key={node.id}
          type={selectedNodeId === node.id ? 'secondary' : 'text'}
          long
          size='small'
          className='!justify-start'
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => selectNode(node.id)}
        >
          <span className='w-16px shrink-0 text-t-quaternary'>
            {node.type === 'text' ? (
              <Text size={12} />
            ) : node.type === 'control' ? (
              <PlayOne size={12} />
            ) : (
              <Rectangle size={12} />
            )}
          </span>
          <span className='truncate'>{node.name}</span>
        </Button>
      ))}
    </div>
  );

  const assetPanel = (
    <ViuAssetLibrary
      assets={localAssets}
      labels={{
        title: labels.assets.title,
        description: labels.assets.empty,
        linkAction: labels.assets.linkAction,
        insertAction: labels.assets.insertAction,
      }}
      onLinkAsset={onLinkAsset}
      onInsertAsset={insertAsset}
    />
  );

  const componentPanel = (
    <ComponentLibrary
      project={project}
      labels={labels.componentLibrary}
      targetScreenName={activeScreen?.name}
      onInsertComponent={insertLibraryComponent}
    />
  );

  return (
    <div className={`${styles.editorRoot} ${className ?? ''}`} data-testid='viu-next-editor' data-mode={mode}>
      <EditorHeader
        labels={labels}
        projectTitle={project.title}
        mode={mode}
        zoom={zoom}
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        teamPreviewReference={teamPreviewReference}
        teamPreviewBusy={teamPreviewBusy}
        teamPreviewDisabled={teamPreviewDisabled}
        onPublishPreview={onPublishPreview}
        onCopyPreviewReference={onCopyPreviewReference}
        onModeChange={changeMode}
        onZoomIn={() => setZoom((value) => clampZoom(value + 0.1))}
        onZoomOut={() => setZoom((value) => clampZoom(value - 0.1))}
        onFit={fitActiveScreen}
        onToggleLeft={() => setLeftCollapsed((value) => !value)}
        onToggleRight={() => setRightCollapsed((value) => !value)}
      />

      <div
        className={styles.workspaceBody}
        data-left-collapsed={leftCollapsed ? 'true' : 'false'}
        data-right-collapsed={rightCollapsed ? 'true' : 'false'}
      >
        {mode !== 'present' ? (
          <aside
            className={`${styles.leftPanel} ${leftCollapsed ? styles.panelCollapsed : ''}`}
            data-testid='viu-left-panel'
            data-collapsed={leftCollapsed ? 'true' : 'false'}
          >
            <nav className={styles.panelTabs}>
              {(
                [
                  ['pages', labels.sidebar.pages, <Browser key='pages' theme='outline' size={16} />],
                  ['layers', labels.sidebar.layers, <TreeList key='layers' theme='outline' size={16} />],
                  ['assets', labels.sidebar.assets, <Picture key='assets' theme='outline' size={16} />],
                  ['components', labels.sidebar.components, <Components key='components' theme='outline' size={16} />],
                ] as const
              ).map(([key, label, icon]) => (
                <Tooltip key={key} content={label} position='right'>
                  <Button
                    type={sidebarTab === key ? 'secondary' : 'text'}
                    size='small'
                    className={styles.panelTabButton}
                    aria-label={label}
                    data-testid={`viu-sidebar-${key}`}
                    icon={icon}
                    onClick={() => {
                      setSidebarTab(key);
                      if (leftCollapsed) setLeftCollapsed(false);
                    }}
                  >
                    {!leftCollapsed ? label : null}
                  </Button>
                </Tooltip>
              ))}
            </nav>
            {!leftCollapsed ? (
              <div className={styles.panelContent}>
                {sidebarTab === 'pages' ? pagePanel : null}
                {sidebarTab === 'layers' ? layerPanel : null}
                {sidebarTab === 'assets' ? assetPanel : null}
                {sidebarTab === 'components' ? componentPanel : null}
              </div>
            ) : null}
          </aside>
        ) : null}

        <main className={styles.canvasWorkspace}>
          {mode === 'present' ? (
            <ViuPresentRuntime
              project={project}
              labels={labels.present}
              resolveAssetUrl={(assetId) =>
                localAssets.find((asset) => asset.id === assetId && !asset.missing)?.protocolUrl
              }
            />
          ) : (
            <>
              <div className={styles.toolRail} data-testid='viu-next-toolbar'>
                {(
                  [
                    ['frame', labels.add.frame, <Add key='frame' size={17} />],
                    ['text', labels.add.text, <Text key='text' size={17} />],
                    ['button', labels.add.button, <PlayOne key='button' size={17} />],
                    ['shape', labels.add.shape, <Rectangle key='shape' size={17} />],
                    ['pen', labels.add.pen, <BezierCurve key='pen' size={17} />],
                  ] as const
                ).map(([kind, label, icon]) => (
                  <Tooltip key={kind} content={label} position='right'>
                    <Button
                      size='small'
                      type='text'
                      className={styles.toolButton}
                      aria-label={label}
                      data-testid={`viu-add-${kind}`}
                      icon={icon}
                      onClick={() => addNode(kind)}
                    />
                  </Tooltip>
                ))}
              </div>

              {canApplyVectorBoolean || selectedMaskNode ? (
                <div className={styles.vectorBooleanBar} data-testid='viu-vector-boolean-bar'>
                  {canApplyVectorBoolean
                    ? (['union', 'subtract', 'intersect', 'exclude'] as const).map((kind) => (
                        <Button
                          key={kind}
                          size='mini'
                          type='text'
                          data-testid={`viu-vector-boolean-${kind}`}
                          onClick={() => applyVectorBoolean(kind)}
                        >
                          {labels.vectorEdit[kind]}
                        </Button>
                      ))
                    : null}
                  {canCreateVectorComposite
                    ? (['clip', 'alpha'] as const).map((kind) => (
                        <Button
                          key={kind}
                          size='mini'
                          type='text'
                          data-testid={`viu-vector-mask-${kind}`}
                          onClick={() => applyVectorMask(kind)}
                        >
                          {kind === 'clip' ? labels.vectorEdit.clipMask : labels.vectorEdit.alphaMask}
                        </Button>
                      ))
                    : null}
                  {selectedMaskNode ? (
                    <>
                      <Button size='mini' type='text' data-testid='viu-vector-mask-reorder' onClick={reorderVectorMask}>
                        {labels.vectorEdit.reorderMask}
                      </Button>
                      <Button size='mini' type='text' data-testid='viu-vector-mask-release' onClick={releaseVectorMask}>
                        {labels.vectorEdit.releaseMask}
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}

              <div
                ref={viewportRef}
                className={`size-full overflow-hidden touch-none select-none ${styles.canvasGrid}`}
                data-testid='viu-next-canvas'
                onPointerDown={(event) => {
                  if (event.button !== 0 || event.target !== event.currentTarget) return;
                  selectNode(null);
                  setPanGesture({
                    pointerId: event.pointerId,
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    startPanX: pan.x,
                    startPanY: pan.y,
                  });
                }}
                onWheel={(event) => {
                  event.preventDefault();
                  if (event.ctrlKey || event.metaKey) {
                    setZoom((value) => clampZoom(value - event.deltaY * 0.0015));
                  } else {
                    setPan((value) => ({ x: value.x - event.deltaX, y: value.y - event.deltaY }));
                  }
                }}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(VIU_ASSET_DRAG_MIME)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                }}
                onDrop={(event) => {
                  const assetId = readViuDraggedAssetId(event.dataTransfer);
                  const asset = localAssets.find((candidate) => candidate.id === assetId);
                  if (!asset || !activeScreen) return;
                  event.preventDefault();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const screenIndex = Math.max(0, project.screenOrder.indexOf(activeScreen.id));
                  const screenOffsetX = screenIndex * (activeScreen.viewport.width + SCREEN_GAP);
                  insertAsset(asset, {
                    x: (event.clientX - bounds.left - pan.x) / zoom - screenOffsetX - 240,
                    y: (event.clientY - bounds.top - pan.y) / zoom - 160,
                  });
                }}
              >
                <div
                  className={`absolute left-0 top-0 ${styles.stage}`}
                  data-testid='viu-next-stage'
                  style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                >
                  {visibleScreenIds.map((screenId, index) => {
                    const screen = project.screens[screenId];
                    if (!screen) return null;
                    const root = project.nodes[screen.rootNodeId];
                    if (!root) return null;
                    const x = index * (screen.viewport.width + SCREEN_GAP);
                    const active = screen.id === activeScreenId;
                    return (
                      <section
                        key={screen.id}
                        className='absolute top-0'
                        data-testid={`viu-next-screen-${screen.id}`}
                        data-screen-id={screen.id}
                        style={{ left: x, width: screen.viewport.width, height: screen.viewport.height }}
                      >
                        <div className='absolute -top-27px left-0 flex items-center gap-7px whitespace-nowrap'>
                          <span className='text-12px font-700 text-t-secondary'>{screen.name}</span>
                          <Tag size='small'>
                            {screen.viewport.width}?{screen.viewport.height}
                          </Tag>
                        </div>
                        <div
                          className={`relative size-full overflow-hidden ${styles.artboard} ${active ? styles.artboardActive : ''}`}
                          data-testid={`viu-next-artboard-${screen.id}`}
                          style={{
                            ...viuContainerLayoutStyle(root),
                            background: root.style.background ?? 'var(--color-bg-1)',
                            borderRadius: 2,
                          }}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            setActiveScreenId(screen.id);
                            selectNode(root.id);
                          }}
                        >
                          {root.childIds.map((nodeId) => (
                            <ViuNodeSurface
                              key={nodeId}
                              project={project}
                              nodeId={nodeId}
                              mode={mode}
                              selectedNodeIds={selection.nodeIds}
                              preview={preview}
                              vectorEditNodeId={vectorEditNodeId}
                              selectedVectorPointIds={selectedVectorPointIds}
                              vectorEditLabels={labels.vectorEdit}
                              resolveAssetUrl={(assetId) =>
                                localAssets.find((asset) => asset.id === assetId && !asset.missing)?.protocolUrl
                              }
                              onSelect={(id, additive) => {
                                setActiveScreenId(screen.id);
                                selectNode(id, additive);
                              }}
                              onBeginMove={beginMove}
                              onBeginResize={beginResize}
                              onActivate={activateNode}
                              onEnterVectorEdit={enterVectorEdit}
                              onExitVectorEdit={exitVectorEdit}
                              onSelectVectorPoint={selectVectorPoint}
                              onAddVectorPoint={addVectorPoint}
                              onCommitVectorGeometry={commitVectorGeometry}
                            />
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>

              <FloatingAgentDock labels={labels.agent} onRequest={onAgentRequest} />

              <div className={styles.canvasHint}>{labels.canvas.panHint}</div>
            </>
          )}
        </main>

        {mode !== 'present' && !rightCollapsed ? (
          <aside className={styles.inspectorPanel} data-testid='viu-right-panel'>
            <div className={styles.panelHeader}>
              <TreeList theme='outline' size={14} className='text-primary' />
              <span className='min-w-0 flex-1 truncate text-12px font-750'>{labels.inspector.title}</span>
              <Tag size='small' color='arcoblue'>
                {selection.nodeIds.length}
              </Tag>
            </div>
            <ViuAuthoringToolbar
              labels={labels.authoringActions}
              canUndo={history.past.length > 0}
              canRedo={history.future.length > 0}
              canMutate={canMutateSelection}
              canGroup={canGroupSelection}
              canUngroup={canUngroupSelection}
              canAlign={canAlignSelection}
              canDistribute={canDistributeSelection}
              onUndo={() => runHistory('undo')}
              onRedo={() => runHistory('redo')}
              onDuplicate={duplicateSelection}
              onDelete={deleteSelection}
              onGroup={() =>
                applyAuthoringBatch(
                  createGroupViuBatch(project, selection, {
                    groupId: nextId('group'),
                    groupName: labels.authoringActions.group,
                  })
                )
              }
              onUngroup={() => applyAuthoringBatch(createUngroupViuBatch(project, selection))}
              onAlign={(alignment) => applyAuthoringBatch(createAlignViuBatch(project, selection, alignment))}
              onDistribute={(axis) => applyAuthoringBatch(createDistributeViuBatch(project, selection, axis))}
            />
            <div className='flex-1 min-h-0 overflow-auto'>
              {!selectedNode ? (
                <Empty description={labels.inspector.empty} className='mt-64px' />
              ) : (
                <div className={styles.inspectorBody}>
                  <div className='flex items-center justify-between gap-8px'>
                    <Tag color='arcoblue'>{selectedNode.type}</Tag>
                    <span className='min-w-0 truncate text-11px text-t-tertiary'>{selectedNode.id}</span>
                  </div>

                  <label className='flex flex-col gap-6px text-12px font-650 text-t-secondary'>
                    <span>{labels.inspector.name}</span>
                    <Input
                      size='small'
                      value={selectedNode.name}
                      onChange={(name) => updateNode(selectedNode.id, { name })}
                    />
                  </label>

                  <section className={styles.propertySection}>
                    <div className='text-11px font-750 uppercase tracking-0.08em text-t-tertiary'>
                      {labels.inspector.position}
                    </div>
                    <div className='grid grid-cols-2 gap-8px'>
                      <label className='flex flex-col gap-5px text-12px text-t-secondary'>
                        <span>{labels.inspector.x}</span>
                        <InputNumber
                          size='small'
                          value={Math.round(selectedNode.localTransform[4])}
                          onChange={(value) => {
                            if (value === undefined) return;
                            const [a, b, c, d, , y] = selectedNode.localTransform;
                            updateNode(selectedNode.id, { localTransform: [a, b, c, d, value, y] });
                          }}
                        />
                      </label>
                      <label className='flex flex-col gap-5px text-12px text-t-secondary'>
                        <span>{labels.inspector.y}</span>
                        <InputNumber
                          size='small'
                          value={Math.round(selectedNode.localTransform[5])}
                          onChange={(value) => {
                            if (value === undefined) return;
                            const [a, b, c, d, x] = selectedNode.localTransform;
                            updateNode(selectedNode.id, { localTransform: [a, b, c, d, x, value] });
                          }}
                        />
                      </label>
                    </div>
                  </section>

                  <section className={styles.propertySection}>
                    <div className='text-11px font-750 uppercase tracking-0.08em text-t-tertiary'>
                      {labels.inspector.size}
                    </div>
                    <div className='grid grid-cols-2 gap-8px'>
                      <label className='flex flex-col gap-5px text-12px text-t-secondary'>
                        <span>{labels.inspector.width}</span>
                        <InputNumber
                          size='small'
                          min={MIN_NODE_SIZE}
                          value={Math.round(selectedNode.size.width)}
                          onChange={(value) => {
                            if (value === undefined) return;
                            updateNode(selectedNode.id, {
                              size: { ...selectedNode.size, width: Math.max(MIN_NODE_SIZE, value) },
                            });
                          }}
                        />
                      </label>
                      <label className='flex flex-col gap-5px text-12px text-t-secondary'>
                        <span>{labels.inspector.height}</span>
                        <InputNumber
                          size='small'
                          min={MIN_NODE_SIZE}
                          value={Math.round(selectedNode.size.height)}
                          onChange={(value) => {
                            if (value === undefined) return;
                            updateNode(selectedNode.id, {
                              size: { ...selectedNode.size, height: Math.max(MIN_NODE_SIZE, value) },
                            });
                          }}
                        />
                      </label>
                    </div>
                  </section>

                  <div className={styles.propertyCard}>
                    <div className='flex items-center justify-between gap-8px text-12px text-t-secondary'>
                      <span>{labels.inspector.type}</span>
                      <Tag size='small'>{selectedNode.type}</Tag>
                    </div>
                    <div className='flex items-center justify-between gap-8px text-12px text-t-secondary'>
                      <span>{labels.inspector.visible}</span>
                      <Switch
                        size='small'
                        checked={selectedNode.visible}
                        onChange={(visible) => updateNode(selectedNode.id, { visible })}
                      />
                    </div>
                    <div className='flex items-center justify-between gap-8px text-12px text-t-secondary'>
                      <span>{labels.inspector.locked}</span>
                      <Switch
                        size='small'
                        checked={selectedNode.locked}
                        onChange={(locked) => updateNode(selectedNode.id, { locked })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {selectedNode ? (
                <AuthoringInspector
                  project={project}
                  selection={selection}
                  labels={labels.authoring}
                  fontOptions={fontCatalog.options}
                  fontWeightOptions={VIU_FONT_WEIGHT_OPTIONS}
                  fontCatalog={{
                    status: fontCatalog.status,
                    systemFontCount: fontCatalog.systemFontCount,
                    onLoad: () => void fontCatalog.loadSystemFonts(),
                  }}
                  onCommit={applyAuthoringBatch}
                  className='!min-h-auto !overflow-visible'
                />
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
};

export default ViuNextCanvas;
