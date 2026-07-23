/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Space, Tag } from '@arco-design/web-react';
import { ArrowLeft, Close } from '@icon-park/react';
import {
  compileViuImageStyle,
  compileViuPaintStyle,
  resolveViuComponentInstance,
  type ViuNode,
  type ViuNodeStyle,
  type ViuProjectState,
} from '@/common/viu';
import {
  compileViuSite,
  createViuRuntimeState,
  reduceViuRuntime,
  resolveViuNode,
  resolveViuRuntimeNodeMotion,
  type ViuRuntimeBreakpoint,
  type ViuRuntimeContract,
  type ViuRuntimeEffectStyle,
  type ViuRuntimeLayoutStyle,
  type ViuRuntimeMotion,
  type ViuRuntimeNodeContract,
  type ViuRuntimeState,
  type ViuRuntimeTraceEntry,
  type ViuSitePlan,
} from '@/common/viu/runtime';
import styles from './ViuPresentRuntime.module.css';
import ViuVectorGraphic from './ViuVectorGraphic';

export type ViuPresentLabels = {
  back: string;
  closeOverlay: string;
  empty: string;
  route: string;
  exit: string;
};

export type ViuPresentRuntimeProps = {
  project: ViuProjectState;
  labels: ViuPresentLabels;
  contract?: ViuRuntimeContract;
  initialRoute?: string;
  reducedMotion?: boolean;
  onExit?: () => void;
  onTrace?: (entry: ViuRuntimeTraceEntry) => void;
  resolveAssetUrl?: (assetId: string) => string | undefined;
  renderRuntimeSurface?: (node: ViuNode) => React.ReactNode;
  className?: string;
};

type RuntimeNodeProps = {
  plan: ViuSitePlan;
  displayProject: ViuProjectState;
  nodeId: string;
  virtualNodes?: Readonly<Record<string, ViuNode>>;
  instanceOwnerId?: string;
  breakpoint: ViuRuntimeBreakpoint;
  runtime: ViuRuntimeState;
  reducedMotion: boolean;
  root?: boolean;
  registerNode: (nodeId: string, element: HTMLElement | null) => void;
  resolveAssetUrl?: ViuPresentRuntimeProps['resolveAssetUrl'];
  renderRuntimeSurface?: ViuPresentRuntimeProps['renderRuntimeSurface'];
};

const easingValue = (motion: ViuRuntimeMotion): string =>
  motion.easing === 'spring-soft' ? 'cubic-bezier(0.2, 0.8, 0.2, 1)' : (motion.easing ?? 'ease-out');

function mergeNodeContract(
  contract: ViuRuntimeNodeContract | undefined,
  breakpoint: ViuRuntimeBreakpoint
): Omit<ViuRuntimeNodeContract, 'responsive'> {
  const responsive = contract?.responsive?.[breakpoint];
  const hasLayout = Boolean(contract?.layout || responsive?.layout);
  const hasEffects = Boolean(contract?.effects || responsive?.effects);
  return {
    layout: hasLayout ? { ...contract?.layout, ...responsive?.layout } : undefined,
    effects: hasEffects ? { ...contract?.effects, ...responsive?.effects } : undefined,
    motion: responsive?.motion ?? contract?.motion,
    smartAnimateKey: responsive?.smartAnimateKey ?? contract?.smartAnimateKey,
  };
}

function tupleSpacing(value: [number, number, number, number] | undefined): string | undefined {
  return value?.map((item) => `${item}px`).join(' ');
}

function layoutStyle(layout: ViuRuntimeLayoutStyle | undefined): React.CSSProperties {
  if (!layout) return {};
  return {
    display: layout.display,
    position: layout.position,
    flexDirection: layout.flexDirection,
    flexWrap: layout.flexWrap,
    alignItems: layout.alignItems,
    justifyContent: layout.justifyContent,
    gridTemplateColumns: layout.gridTemplateColumns,
    gap: layout.gap,
    padding: tupleSpacing(layout.padding),
    margin: tupleSpacing(layout.margin),
    width: layout.width,
    height: layout.height,
    minHeight: layout.minHeight,
    maxWidth: layout.maxWidth,
    top: layout.inset?.top,
    right: layout.inset?.right,
    bottom: layout.inset?.bottom,
    left: layout.inset?.left,
    zIndex: layout.zIndex,
    overflow: layout.overflow,
  };
}

function effectStyle(effects: ViuRuntimeEffectStyle | undefined, nodeStyle: ViuNodeStyle): React.CSSProperties {
  const paint = compileViuPaintStyle(nodeStyle);
  const filters = [
    paint.filter ?? '',
    effects?.blur === undefined ? '' : `blur(${effects.blur}px)`,
    effects?.brightness === undefined ? '' : `brightness(${effects.brightness})`,
    effects?.contrast === undefined ? '' : `contrast(${effects.contrast})`,
    effects?.saturate === undefined ? '' : `saturate(${effects.saturate})`,
  ].filter(Boolean);
  const transforms = [
    effects?.rotateX === undefined ? '' : `rotateX(${effects.rotateX}deg)`,
    effects?.rotateY === undefined ? '' : `rotateY(${effects.rotateY}deg)`,
    effects?.translateZ === undefined ? '' : `translateZ(${effects.translateZ}px)`,
  ].filter(Boolean);
  return {
    filter: filters.length > 0 ? filters.join(' ') : undefined,
    backdropFilter: effects?.backdropBlur !== undefined ? `blur(${effects.backdropBlur}px)` : paint.backdropFilter,
    mixBlendMode: effects?.blendMode,
    perspective: effects?.perspective,
    transform: transforms.length > 0 ? transforms.join(' ') : undefined,
    transformStyle: effects?.perspective ? 'preserve-3d' : undefined,
  };
}

function motionCompletionMs(motion: ViuRuntimeMotion): number {
  const delay = Math.max(0, motion.delayMs ?? 0);
  const duration = Math.max(0, motion.durationMs);
  const iterations = Math.max(1, motion.iterationCount ?? 1);
  return delay + duration * iterations;
}

function motionStyle(motion: ViuRuntimeMotion | undefined, reducedMotion: boolean): React.CSSProperties {
  if (!motion || reducedMotion || motion.preset === 'none') return {};
  return {
    animationDuration: `${Math.max(0, motion.durationMs)}ms`,
    animationDelay: `${Math.max(0, motion.delayMs ?? 0)}ms`,
    animationTimingFunction: easingValue(motion),
    animationIterationCount: Math.max(1, motion.iterationCount ?? 1),
    animationFillMode: 'both',
  };
}

function baseNodeStyle(node: ViuNode, root: boolean): React.CSSProperties {
  const [a, b, c, d, x, y] = node.localTransform;
  const isFlow = node.positionMode === 'flow';

  const layoutMode = node.layout?.mode ?? 'none';
  const autoLayout = layoutMode !== 'none';

  const paint = compileViuPaintStyle(node.style);
  return {
    position: root ? 'relative' : isFlow ? 'relative' : 'absolute',
    left: root || isFlow ? undefined : x,
    top: root || isFlow ? undefined : y,
    width:
      node.sizing.horizontal === 'fill' && !root
        ? '100%'
        : node.sizing.horizontal === 'hug'
          ? 'fit-content'
          : node.size.width,
    height:
      node.sizing.vertical === 'fill' && !root
        ? '100%'
        : node.sizing.vertical === 'hug'
          ? 'fit-content'
          : node.size.height,
    minWidth: node.sizing.minWidth,
    maxWidth: node.sizing.maxWidth,
    minHeight: node.sizing.minHeight,
    maxHeight: node.sizing.maxHeight,
    boxSizing: 'border-box',
    transform: root || isFlow ? undefined : `matrix(${a}, ${b}, ${c}, ${d}, 0, 0)`,
    transformOrigin: '0 0',
    background: node.type === 'vector' ? 'transparent' : paint.background,
    color: node.style.color,
    borderColor: node.type === 'vector' ? 'transparent' : paint.borderColor,
    borderStyle: node.type === 'vector' ? 'none' : paint.borderStyle,
    borderWidth: node.type === 'vector' ? 0 : paint.borderWidth,
    borderRadius: node.style.borderRadius,
    outline: node.type === 'vector' ? undefined : paint.outline,
    outlineOffset: node.type === 'vector' ? undefined : paint.outlineOffset,
    boxShadow: paint.boxShadow,
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
    display: autoLayout ? (layoutMode === 'grid' ? 'grid' : 'flex') : node.type === 'text' ? 'flex' : undefined,
    flexDirection: layoutMode === 'horizontal' ? 'row' : layoutMode === 'vertical' ? 'column' : undefined,
    flexWrap: autoLayout && node.layout?.wrap ? 'wrap' : undefined,
    gridTemplateColumns:
      layoutMode === 'grid' ? `repeat(${Math.max(1, node.layout?.columns ?? 2)}, minmax(0, 1fr))` : undefined,
    gap: autoLayout ? node.layout?.gap : undefined,
    padding: autoLayout ? tupleSpacing(node.layout?.padding) : undefined,
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
        : undefined,
    whiteSpace: node.type === 'text' ? 'pre-wrap' : undefined,
  };
}

function replayClickMotion(target: EventTarget | null, boundary: HTMLElement): void {
  const motionTarget = target instanceof Element ? target.closest<HTMLElement>(`[data-motion-trigger='click']`) : null;
  if (!motionTarget || !boundary.contains(motionTarget)) return;
  motionTarget.dataset.motionState = 'idle';
  void motionTarget.offsetWidth;
  motionTarget.dataset.motionState = 'active';
}

const RuntimeNode: React.FC<RuntimeNodeProps> = ({
  plan,
  displayProject,
  nodeId,
  virtualNodes,
  instanceOwnerId,
  breakpoint,
  runtime,
  reducedMotion,
  root = false,
  registerNode,
  resolveAssetUrl,
  renderRuntimeSurface,
}) => {
  const storedNode = virtualNodes?.[nodeId] ?? displayProject.nodes[nodeId];
  const resolvedInstance =
    !virtualNodes && storedNode?.componentInstance
      ? resolveViuComponentInstance(displayProject, storedNode)
      : undefined;
  const node = resolvedInstance?.nodes[resolvedInstance.rootId] ?? storedNode;
  if (!node?.visible) return null;
  const componentInstance = storedNode?.componentInstance;
  const interactionNodeId = instanceOwnerId ?? node.id;
  const extension = mergeNodeContract(plan.contract.nodes?.[node.id], breakpoint);
  const motion = extension.motion;
  const timelineMotion = resolveViuRuntimeNodeMotion(plan, runtime, node.id);
  const authoredStyle: React.CSSProperties = {
    ...baseNodeStyle(node, root),
    ...layoutStyle(extension.layout),
    ...effectStyle(extension.effects, node.style),
    ...motionStyle(motion, reducedMotion),
  };
  const runtimeTransforms = [
    timelineMotion.x === undefined ? '' : 'translateX(' + timelineMotion.x + 'px)',
    timelineMotion.y === undefined ? '' : 'translateY(' + timelineMotion.y + 'px)',
    timelineMotion.parallaxY === undefined ? '' : 'translateY(' + timelineMotion.parallaxY + 'px)',
    timelineMotion.scale === undefined ? '' : 'scale(' + timelineMotion.scale + ')',
    timelineMotion.rotate === undefined ? '' : 'rotate(' + timelineMotion.rotate + 'deg)',
  ].filter(Boolean);
  const combinedStyle: React.CSSProperties = {
    ...authoredStyle,
    position: timelineMotion.pinned ? 'sticky' : authoredStyle.position,
    top: timelineMotion.pinned ? 0 : authoredStyle.top,
    opacity: timelineMotion.opacity ?? authoredStyle.opacity,
    transform: [authoredStyle.transform, ...runtimeTransforms].filter(Boolean).join(' ') || undefined,
    filter:
      [authoredStyle.filter, timelineMotion.blur === undefined ? undefined : 'blur(' + timelineMotion.blur + 'px)']
        .filter(Boolean)
        .join(' ') || undefined,
  };
  const assetUrl = node.content?.assetId ? resolveAssetUrl?.(node.content.assetId) : undefined;
  const children = node.childIds.map((childId) => (
    <RuntimeNode
      key={childId}
      plan={plan}
      displayProject={displayProject}
      nodeId={childId}
      virtualNodes={resolvedInstance?.nodes ?? virtualNodes}
      instanceOwnerId={resolvedInstance ? node.id : instanceOwnerId}
      breakpoint={breakpoint}
      runtime={runtime}
      reducedMotion={reducedMotion}
      registerNode={registerNode}
      resolveAssetUrl={resolveAssetUrl}
      renderRuntimeSurface={renderRuntimeSurface}
    />
  ));
  const media =
    node.type === 'image' && assetUrl ? (
      <span className={styles.mediaViewport}>
        <img
          className={styles.media}
          style={compileViuImageStyle(node.imageTransform)}
          src={assetUrl}
          alt={node.semantics.label}
          draggable={false}
        />
      </span>
    ) : node.type === 'video' && assetUrl ? (
      <video className={styles.media} src={assetUrl} autoPlay muted loop playsInline />
    ) : node.type === 'audio' && assetUrl ? (
      <audio src={assetUrl} autoPlay />
    ) : node.type === 'model-3d' || node.type === 'runtime-surface' ? (
      renderRuntimeSurface?.(node)
    ) : null;
  const vectorGraphic =
    node.type === 'vector' && node.vector ? (
      <ViuVectorGraphic
        className={styles.media}
        geometry={node.vector}
        nodeStyle={node.style}
        width={node.size.width}
        height={node.size.height}
      />
    ) : null;
  const commonProps = {
    'data-viu-runtime-node-id': interactionNodeId,
    'data-viu-runtime-render-node-id': node.id,
    'data-viu-component-id': resolvedInstance?.component.id,
    'data-viu-component-source-id': resolvedInstance?.sourceNodeIdByResolvedId[node.id],
    'data-viu-component-variant': componentInstance ? JSON.stringify(componentInstance.variantSelection) : undefined,
    'data-viu-component-properties': componentInstance ? JSON.stringify(componentInstance.propertyValues) : undefined,
    'data-motion': reducedMotion ? 'none' : (motion?.preset ?? 'none'),
    'data-motion-trigger': motion?.trigger ?? 'load',
    'data-motion-state': motion?.trigger === 'load' ? 'active' : 'idle',
    'data-smart-animate-key': extension.smartAnimateKey ?? node.id,
    'data-scroll-progress': timelineMotion.scrollProgress,
    'data-timeline-active': Object.values(runtime.timelines).some((timeline) => timeline.status === 'playing')
      ? 'true'
      : 'false',
    'aria-label': node.semantics.label || undefined,
  } as const;

  if (node.type === 'control' || node.type === 'hotspot') {
    return (
      <Button
        {...commonProps}
        ref={(element) => registerNode(node.id, element instanceof HTMLElement ? element : null)}
        className={`${styles.node} ${styles.control}`}
        style={combinedStyle}
        type='text'
      >
        {node.content?.text}
        {children}
      </Button>
    );
  }

  return (
    <div
      {...commonProps}
      ref={(element) => registerNode(node.id, element)}
      className={styles.node}
      style={combinedStyle}
      role={node.semantics.role === 'heading' ? 'heading' : undefined}
      aria-level={node.semantics.headingLevel}
    >
      {vectorGraphic ?? media ?? node.content?.text}
      {children}
    </div>
  );
};

const ViuPresentRuntime: React.FC<ViuPresentRuntimeProps> = ({
  project,
  labels,
  contract,
  initialRoute,
  reducedMotion = false,
  onExit,
  onTrace,
  resolveAssetUrl,
  renderRuntimeSurface,
  className,
}) => {
  const plan = useMemo(() => compileViuSite(project, contract), [contract, project]);
  const [runtime, setRuntime] = useState<ViuRuntimeState>(() =>
    createViuRuntimeState(plan, { initialRoute, reducedMotion })
  );
  const displayProject = useMemo(() => {
    const runtimeProject = structuredClone(project);
    for (const [variableId, value] of Object.entries(runtime.variables)) {
      const variable = runtimeProject.variables[variableId];
      if (!variable) continue;
      if ('value' in variable) {
        variable.value = value;
        continue;
      }
      const collection = runtimeProject.variableCollections?.[variable.collectionId];
      const modeId = runtimeProject.activeVariableModes?.[variable.collectionId] ?? collection?.defaultModeId;
      if (modeId && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
        variable.valuesByMode[modeId] = value;
      }
    }
    runtimeProject.nodes = Object.fromEntries(
      Object.keys(runtimeProject.nodes).map((nodeId) => [
        nodeId,
        resolveViuNode(runtimeProject, nodeId, runtime.viewport.width).node,
      ])
    );
    return runtimeProject;
  }, [project, runtime.variables, runtime.viewport.width]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const nodeElements = useRef(new Map<string, HTMLElement>());
  const smartAnimateRects = useRef(new Map<string, DOMRect>());
  const triggeredInteractions = useRef(new Set<string>());
  const reportedSequence = useRef(0);

  useEffect(() => {
    triggeredInteractions.current.clear();
    setRuntime(createViuRuntimeState(plan, { initialRoute, reducedMotion }));
  }, [initialRoute, plan, reducedMotion]);

  const hasPlayingTimeline = Object.values(runtime.timelines).some((timeline) => timeline.status === 'playing');
  useEffect(() => {
    if (!hasPlayingTimeline || runtime.reducedMotion) return;
    let previous = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      const deltaMs = Math.max(0, now - previous);
      previous = now;
      setRuntime((current) =>
        Object.entries(current.timelines).reduce(
          (next, [timelineId, timeline]) =>
            timeline.status === 'playing'
              ? reduceViuRuntime(plan, next, { type: 'tickTimeline', timelineId, deltaMs })
              : next,
          current
        )
      );
    }, 16);
    return () => window.clearInterval(interval);
  }, [hasPlayingTimeline, plan, runtime.reducedMotion]);

  useLayoutEffect(() => {
    const effect = runtime.pendingEffect;
    if (!effect || effect.type !== 'route' || effect.transition.preset !== 'smart-animate' || runtime.reducedMotion) {
      return;
    }
    for (const match of effect.smartAnimateMatches) {
      const from = smartAnimateRects.current.get(match.key);
      const target = nodeElements.current.get(match.toNodeId);
      if (!from || !target) continue;
      const to = target.getBoundingClientRect();
      const scaleX = to.width > 0 ? from.width / to.width : 1;
      const scaleY = to.height > 0 ? from.height / to.height : 1;
      target.dataset.smartAnimateState = 'matched';
      target.animate?.(
        [
          {
            transform:
              'translate(' +
              (from.left - to.left) +
              'px, ' +
              (from.top - to.top) +
              'px) scale(' +
              scaleX +
              ', ' +
              scaleY +
              ')',
            opacity: 0.82,
          },
          { transform: 'none', opacity: 1 },
        ],
        {
          duration: effect.transition.durationMs,
          delay: effect.transition.delayMs ?? 0,
          easing: easingValue(effect.transition),
          fill: 'both',
        }
      );
    }
    smartAnimateRects.current.clear();
  }, [runtime.currentRoute, runtime.pendingEffect, runtime.reducedMotion]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setRuntime((current) =>
        reduceViuRuntime(plan, current, {
          type: 'setViewport',
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [plan]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const targets = [...viewport.querySelectorAll<HTMLElement>(`[data-motion-trigger='in-view']`)];
    if (targets.length === 0) return;
    if (runtime.reducedMotion || typeof IntersectionObserver === 'undefined') {
      targets.forEach((target) => {
        target.dataset.motionState = runtime.reducedMotion ? 'idle' : 'active';
      });
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.target instanceof HTMLElement) {
            entry.target.dataset.motionState = entry.isIntersecting ? 'active' : 'idle';
          }
        });
      },
      { root: viewport, threshold: 0.15 }
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [runtime.currentRoute, runtime.reducedMotion, runtime.viewport.breakpoint]);

  useEffect(() => {
    const entry = runtime.trace.at(-1);
    if (entry && entry.sequence > reportedSequence.current) {
      reportedSequence.current = entry.sequence;
      onTrace?.(entry);
    }
  }, [onTrace, runtime.trace]);

  useEffect(() => {
    const effect = runtime.pendingEffect;
    if (!effect) return;
    const targetId =
      effect.type === 'route'
        ? plan.routeByPath[effect.route]?.sections.find((section) => section.screenId === effect.screenId)?.rootNodeId
        : effect.type === 'scroll'
          ? effect.nodeId
          : undefined;
    if (targetId)
      nodeElements.current.get(targetId)?.scrollIntoView?.({ behavior: runtime.reducedMotion ? 'auto' : 'smooth' });
    const timeout = window.setTimeout(
      () => setRuntime((current) => reduceViuRuntime(plan, current, { type: 'consumeEffect' })),
      motionCompletionMs(effect.transition)
    );
    return () => window.clearTimeout(timeout);
  }, [plan, runtime.pendingEffect, runtime.reducedMotion]);

  const routePlan = plan.routeByPath[runtime.currentRoute];
  const registerNode = (nodeId: string, element: HTMLElement | null): void => {
    if (element) nodeElements.current.set(nodeId, element);
    else nodeElements.current.delete(nodeId);
  };
  const captureSmartAnimate = (targetScreenId: string, motion: ViuRuntimeMotion | undefined): void => {
    if (runtime.reducedMotion || motion?.preset !== 'smart-animate' || !runtime.activeScreenId) {
      return;
    }
    const from = plan.smartAnimateKeysByScreen[runtime.activeScreenId] ?? {};
    const to = plan.smartAnimateKeysByScreen[targetScreenId] ?? {};
    for (const key of Object.keys(from)) {
      if (!to[key]) continue;
      const element = nodeElements.current.get(from[key]!);
      if (element) smartAnimateRects.current.set(key, element.getBoundingClientRect());
    }
  };

  const handleViewportScroll = (): void => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const viewportRect = viewport.getBoundingClientRect();
    setRuntime((current) =>
      Object.values(plan.scrollBindings).reduce((next, binding) => {
        const element = nodeElements.current.get(binding.nodeId);
        if (!element) return next;
        const rect = element.getBoundingClientRect();
        const travel = Math.max(1, viewportRect.height + rect.height);
        const progress = Math.min(1, Math.max(0, (viewportRect.bottom - rect.top) / travel));
        return reduceViuRuntime(plan, next, {
          type: 'setScrollProgress',
          bindingId: binding.id,
          progress,
        });
      }, current)
    );
    const screenId = runtime.activeScreenId;
    if (!screenId) return;
    for (const nodeId of plan.nodesByScreen[screenId] ?? []) {
      const interactionId = plan.interactionIdsBySource[nodeId]?.find(
        (id) => plan.interactions[id]?.trigger === 'scroll'
      );
      const element = interactionId ? nodeElements.current.get(nodeId) : undefined;
      if (!interactionId || !element) continue;
      const rect = element.getBoundingClientRect();
      const isVisible = rect.bottom >= viewportRect.top && rect.top <= viewportRect.bottom;
      const triggerKey = `scroll:${screenId}:${interactionId}`;
      if (!isVisible || triggeredInteractions.current.has(triggerKey)) continue;
      triggeredInteractions.current.add(triggerKey);
      setRuntime((current) => reduceViuRuntime(plan, current, { type: 'activateNode', nodeId, trigger: 'scroll' }));
    }
  };

  const findInteractionElement = (
    target: EventTarget | null,
    boundary: HTMLElement,
    trigger: 'click' | 'hover' | 'focus' | 'submit'
  ): HTMLElement | null => {
    let candidate = target instanceof Element ? target.closest<HTMLElement>('[data-viu-runtime-node-id]') : null;
    while (candidate && boundary.contains(candidate)) {
      const nodeId = candidate.dataset.viuRuntimeNodeId;
      const supportsTrigger = nodeId
        ? plan.interactionIdsBySource[nodeId]?.some((id) => plan.interactions[id]?.trigger === trigger)
        : false;
      if (supportsTrigger) return candidate;
      candidate = candidate.parentElement?.closest<HTMLElement>('[data-viu-runtime-node-id]') ?? null;
    }
    return null;
  };

  const activateNode = (nodeId: string, trigger: 'click' | 'hover' | 'focus' | 'submit' | 'scroll' | 'load'): void => {
    const interactionId = plan.interactionIdsBySource[nodeId]?.find((id) => plan.interactions[id]?.trigger === trigger);
    const interaction = interactionId ? plan.interactions[interactionId] : undefined;
    const navigation = interaction?.actions.find((step) => step.action.type === 'navigate');
    if (navigation?.action.type === 'navigate') {
      captureSmartAnimate(navigation.action.targetScreenId, interaction?.transition);
    }
    setRuntime((current) => reduceViuRuntime(plan, current, { type: 'activateNode', nodeId, trigger }));
  };

  const activateFromEvent = (
    event: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement> | React.FormEvent<HTMLElement>,
    trigger: 'click' | 'hover' | 'focus' | 'submit'
  ): void => {
    if (trigger === 'click') replayClickMotion(event.target, event.currentTarget);
    const target = findInteractionElement(event.target, event.currentTarget, trigger);
    if (!target) return;
    if (
      trigger === 'hover' &&
      'relatedTarget' in event &&
      event.relatedTarget instanceof Node &&
      target.contains(event.relatedTarget)
    ) {
      return;
    }
    const nodeId = target.dataset.viuRuntimeNodeId;
    if (nodeId) activateNode(nodeId, trigger);
  };

  useEffect(() => {
    const activeScreenId = runtime.activeScreenId;
    if (!activeScreenId) return;
    const loadActions = (plan.nodesByScreen[activeScreenId] ?? [])
      .map((nodeId) => ({
        nodeId,
        interactionId: plan.interactionIdsBySource[nodeId]?.find((id) => plan.interactions[id]?.trigger === 'load'),
      }))
      .filter(
        (entry): entry is { nodeId: string; interactionId: string } =>
          Boolean(entry.interactionId) &&
          !triggeredInteractions.current.has(`load:${activeScreenId}:${entry.interactionId}`)
      );
    if (loadActions.length === 0) return;
    loadActions.forEach((entry) => triggeredInteractions.current.add(`load:${activeScreenId}:${entry.interactionId}`));
    setRuntime((current) =>
      loadActions.reduce(
        (next, entry) => reduceViuRuntime(plan, next, { type: 'activateNode', nodeId: entry.nodeId, trigger: 'load' }),
        current
      )
    );
  }, [plan, runtime.activeScreenId]);

  const goBack = (): void => {
    const previousScreenId = runtime.history.at(-1)?.screenId;
    if (previousScreenId) captureSmartAnimate(previousScreenId, plan.contract.routeTransition);
    setRuntime((current) => reduceViuRuntime(plan, current, { type: 'back' }));
  };
  const transition = runtime.pendingEffect?.transition ?? plan.contract.routeTransition;

  return (
    <div
      className={`${styles.runtime} ${className ?? ''}`}
      data-reduced-motion={runtime.reducedMotion ? 'true' : 'false'}
    >
      <div className={styles.chrome}>
        <Space size={8}>
          <Button
            type='text'
            size='small'
            icon={<ArrowLeft theme='outline' />}
            disabled={runtime.history.length === 0 && runtime.overlayNodeIds.length === 0}
            onClick={goBack}
          >
            {labels.back}
          </Button>
          <Tag bordered className={styles.routeTag}>
            {labels.route}: {runtime.currentRoute}
          </Tag>
        </Space>
        {onExit ? (
          <Button type='text' size='small' icon={<Close theme='outline' />} onClick={onExit}>
            {labels.exit}
          </Button>
        ) : null}
      </div>

      <div
        ref={viewportRef}
        className={styles.viewport}
        data-route-motion={runtime.reducedMotion ? 'none' : (transition?.preset ?? 'none')}
        onClickCapture={(event) => activateFromEvent(event, 'click')}
        onMouseOverCapture={(event) => activateFromEvent(event, 'hover')}
        onFocusCapture={(event) => activateFromEvent(event, 'focus')}
        onSubmitCapture={(event) => activateFromEvent(event, 'submit')}
        onScroll={handleViewportScroll}
      >
        {!routePlan ? (
          <Empty className={styles.empty} description={labels.empty} />
        ) : (
          routePlan.sections.map((section) => {
            const scale = Math.max(0.1, runtime.viewport.width / section.viewport.width);
            const sectionHeight = Math.max(section.minHeight, section.contentSize.height) * scale;
            return (
              <section
                key={section.screenId}
                id={section.anchorId}
                className={styles.section}
                data-screen-id={section.screenId}
                data-scroll-snap={section.scrollSnap}
                data-sticky={section.sticky ? 'true' : 'false'}
                style={{ height: sectionHeight, ...motionStyle(transition, runtime.reducedMotion) }}
              >
                <div
                  className={styles.scaler}
                  style={{
                    width: section.contentSize.width,
                    height: section.contentSize.height,
                    transform: `scale(${scale})`,
                  }}
                >
                  <RuntimeNode
                    plan={plan}
                    displayProject={displayProject}
                    nodeId={section.rootNodeId}
                    breakpoint={runtime.viewport.breakpoint}
                    runtime={runtime}
                    reducedMotion={runtime.reducedMotion}
                    root
                    registerNode={registerNode}
                    resolveAssetUrl={resolveAssetUrl}
                    renderRuntimeSurface={renderRuntimeSurface}
                  />
                </div>
              </section>
            );
          })
        )}
      </div>

      {runtime.overlayNodeIds.map((nodeId) => {
        const overlayMotion =
          runtime.pendingEffect?.type === 'overlay' && runtime.pendingEffect.nodeId === nodeId
            ? runtime.pendingEffect.transition
            : undefined;
        return (
          <div
            key={nodeId}
            className={`${styles.overlay} ${styles.node}`}
            data-testid={`viu-runtime-overlay-${nodeId}`}
            data-motion={runtime.reducedMotion ? 'none' : (overlayMotion?.preset ?? 'none')}
            data-motion-state='active'
            style={motionStyle(overlayMotion, runtime.reducedMotion)}
          >
            <Button
              className={styles.overlayClose}
              type='secondary'
              shape='circle'
              aria-label={labels.closeOverlay}
              icon={<Close theme='outline' />}
              onClick={() => setRuntime((current) => reduceViuRuntime(plan, current, { type: 'closeOverlay', nodeId }))}
            />
            <div
              className={styles.overlaySurface}
              onClickCapture={(event) => activateFromEvent(event, 'click')}
              onMouseOverCapture={(event) => activateFromEvent(event, 'hover')}
              onFocusCapture={(event) => activateFromEvent(event, 'focus')}
              onSubmitCapture={(event) => activateFromEvent(event, 'submit')}
            >
              <RuntimeNode
                plan={plan}
                displayProject={displayProject}
                nodeId={nodeId}
                breakpoint={runtime.viewport.breakpoint}
                runtime={runtime}
                reducedMotion={runtime.reducedMotion}
                root
                registerNode={registerNode}
                resolveAssetUrl={resolveAssetUrl}
                renderRuntimeSurface={renderRuntimeSurface}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ViuPresentRuntime;
