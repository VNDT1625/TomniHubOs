/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, ColorPicker, Input, InputNumber, Select, Switch, Tag } from '@arco-design/web-react';
import { BezierCurve, Delete, Down, Effects, Picture, Plus, Shield, Text, Up } from '@icon-park/react';
import React, { useMemo } from 'react';
import {
  createAppearanceViuBatch,
  createComponentInstanceViuBatch,
  createComponentSetViuBatch,
  createComponentViuBatch,
  createDetachInstanceViuBatch,
  createInstancePropertyViuBatch,
  createInstanceVariantViuBatch,
  createImageTransformViuBatch,
  createResetInstanceOverridesViuBatch,
  createRenameComponentViuBatch,
  createSwapInstanceViuBatch,
  createTextContentViuBatch,
  createTypographyViuBatch,
  getViuMixedValue,
  getViuTextNodes,
  getViuTypographyNodes,
  type ViuAppearancePatch,
  type ViuAuthoringNodeStyle,
  type ViuMixedValue,
  type ViuTypographyPatch,
} from '@/common/viu/authoring';
import {
  auditViuProjectQuality,
  createViuSvgPathData,
  DEFAULT_VIU_IMAGE_TRANSFORM,
  getViuComponentForRoot,
  isViuSvgPathClosed,
  normalizeViuImageTransform,
  resolveViuComponentDefinition,
  resolveViuComponentInstance,
  validateViuSvgPathData,
  type ViuEffect,
  type ViuFill,
  type ViuNode,
  type ViuStroke,
  type ViuVectorGeometry,
  type ViuVectorPoint,
} from '@/common/viu';
import type {
  ViuAuthoringInspectorProps,
  ViuComponentInspectorModel,
} from '@package-apps/design/renderer/viu/next/authoring/types';

import ComponentInspector from '@package-apps/design/renderer/viu/next/authoring/ComponentInspector';
import LayoutInspector from '@package-apps/design/renderer/viu/next/authoring/LayoutInspector';
import PrototypeInspector from '@package-apps/design/renderer/viu/next/authoring/PrototypeInspector';
import TypographyInspector from '@package-apps/design/renderer/viu/next/authoring/TypographyInspector';
import { useViuImeTextDraft } from '@package-apps/design/renderer/viu/next/authoring/useViuImeTextDraft';

const TextArea = Input.TextArea;
let componentIdSequence = 0;
const nextComponentId = (prefix: string): string => {
  componentIdSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${componentIdSequence.toString(36)}`;
};

const commonValue = <T,>(mixed: ViuMixedValue<T>): T | undefined => (mixed.kind === 'value' ? mixed.value : undefined);

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({
  title,
  icon,
  children,
}) => (
  <section className='rd-12px border border-b-1 bg-bg-2 overflow-hidden'>
    <div className='h-38px px-11px flex items-center gap-7px border-b border-b-1 bg-fill-1 text-12px font-700 text-t-primary'>
      <span className='text-primary flex items-center'>{icon}</span>
      <span>{title}</span>
    </div>
    <div className='p-11px flex flex-col gap-11px'>{children}</div>
  </section>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className='flex flex-col gap-6px text-12px font-600 text-t-secondary'>
    <span>{label}</span>
    {children}
  </label>
);

type ViuFillType = 'solid' | 'linear' | 'radial';
type ViuShadowEditorValue = { x: number; y: number; blur: number; spread: number; color: string };
type ViuGradientEditorValue = { type: 'linear' | 'radial'; angle: number; start: string; end: string };

const parseViuGradient = (background: string | undefined): ViuGradientEditorValue | undefined => {
  if (!background) return undefined;
  const linear = background.match(
    /^linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,\s*(.+?)\s+0%\s*,\s*(.+?)\s+100%\s*\)$/i
  );
  if (linear) {
    return { type: 'linear', angle: Number(linear[1]), start: linear[2]!, end: linear[3]! };
  }
  const radial = background.match(/^radial-gradient\(\s*circle\s*,\s*(.+?)\s+0%\s*,\s*(.+?)\s+100%\s*\)$/i);
  return radial ? { type: 'radial', angle: 0, start: radial[1]!, end: radial[2]! } : undefined;
};

const createViuGradient = (gradient: ViuGradientEditorValue): string =>
  gradient.type === 'linear'
    ? `linear-gradient(${gradient.angle}deg, ${gradient.start} 0%, ${gradient.end} 100%)`
    : `radial-gradient(circle, ${gradient.start} 0%, ${gradient.end} 100%)`;

const hasTopLevelComma = (value: string): boolean => {
  let depth = 0;
  for (const character of value) {
    if (character === '(') depth += 1;
    else if (character === ')') depth = Math.max(0, depth - 1);
    else if (character === ',' && depth === 0) return true;
  }
  return false;
};

const parseViuShadow = (shadow: string | undefined): ViuShadowEditorValue | undefined => {
  if (!shadow || hasTopLevelComma(shadow)) return undefined;
  const match = shadow.match(
    /^\s*(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(.+)\s*$/
  );
  return match
    ? { x: Number(match[1]), y: Number(match[2]), blur: Number(match[3]), spread: Number(match[4]), color: match[5]! }
    : undefined;
};

const createViuShadow = (shadow: ViuShadowEditorValue): string =>
  `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${shadow.color}`;

const replaceStackItem = <T extends { id: string }>(items: readonly T[], next: T): T[] =>
  items.map((item) => (item.id === next.id ? next : item));

const moveStackItem = <T extends { id: string }>(items: readonly T[], id: string, direction: -1 | 1): T[] => {
  const index = items.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
};

/** A transaction-only text, typography, and appearance inspector for VIU authoring. */
const AuthoringInspector: React.FC<ViuAuthoringInspectorProps> = ({
  project,
  selection,
  labels,
  fontOptions,
  fontWeightOptions,
  fontCatalog,
  onCommit,
  disabled = false,
  className,
}) => {
  const selectedNodes = useMemo(
    () => selection.nodeIds.map((nodeId) => project.nodes[nodeId]).filter((node): node is ViuNode => Boolean(node)),
    [project.nodes, selection.nodeIds]
  );
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : undefined;
  const selectedVectorNode = selectedNode?.type === 'vector' && selectedNode.vector ? selectedNode : undefined;
  const selectedImageNode = selectedNode?.type === 'image' ? selectedNode : undefined;
  const selectedComponents = selectedNodes
    .map((node) => getViuComponentForRoot(project, node.id))
    .filter((component) => Boolean(component));
  const definition = selectedNode ? getViuComponentForRoot(project, selectedNode.id) : undefined;
  const instanceState = selectedNode?.componentInstance;
  const instanceComponent = instanceState ? resolveViuComponentDefinition(project, instanceState) : undefined;
  const mainComponent = instanceState ? project.components[instanceState.componentId] : undefined;
  const componentSet = mainComponent?.componentSetId ? project.componentSets[mainComponent.componentSetId] : undefined;
  const componentModel: ViuComponentInspectorModel = {
    selected: selectedNodes.length > 0,
    canCreateComponent:
      Boolean(selectedNode) &&
      selectedNode?.parentId !== null &&
      selectedNode?.type !== 'component-instance' &&
      !selectedNode?.locked &&
      !definition,
    canCreateComponentSet:
      selectedComponents.length >= 2 &&
      selectedComponents.length === selectedNodes.length &&
      selectedComponents.every((component) => !component?.componentSetId),
    definition: definition
      ? { id: definition.id, name: definition.name, componentSetId: definition.componentSetId }
      : undefined,
    instance: instanceState
      ? {
          componentId: instanceState.componentId,
          componentName: mainComponent?.name ?? labels.component.missingComponent,
          overrideCount:
            Object.keys(instanceState.propertyValues).length +
            Object.keys(instanceState.styleOverrides ?? {}).length +
            Object.entries(instanceState.variantSelection).filter(
              ([axis, value]) => mainComponent?.variantProperties[axis] !== value
            ).length,
        }
      : undefined,
    components: Object.values(project.components)
      .map((component) => ({ id: component.id, name: component.name }))
      .toSorted((left, right) => left.name.localeCompare(right.name)),
    variantAxes: componentSet
      ? Object.entries(componentSet.variantAxes).map(([axis, options]) => ({
          id: axis,
          label: axis,
          value: instanceState?.variantSelection[axis] ?? options[0] ?? '',
          options,
        }))
      : [],
    properties: instanceComponent
      ? Object.values(instanceComponent.propertyDefinitions).map((property) => {
          const value = instanceState?.propertyValues[property.id] ?? property.defaultValue;
          return property.type === 'boolean'
            ? { id: property.id, label: property.name, type: 'boolean' as const, value: Boolean(value) }
            : { id: property.id, label: property.name, type: 'text' as const, value: String(value) };
        })
      : [],
  };
  const textNodes = useMemo(() => getViuTextNodes(project, selection), [project, selection]);

  const typographyNodes = useMemo(() => getViuTypographyNodes(project, selection), [project, selection]);
  const textValue = commonValue(getViuMixedValue(textNodes, (node) => node.content?.text ?? '')) ?? '';
  const textMixed = getViuMixedValue(textNodes, (node) => node.content?.text ?? '').kind === 'mixed';
  const editable = !disabled && selectedNodes.some((node) => !node.locked);
  const textEditable = editable && textNodes.length > 0;

  const typographyEditable = editable && typographyNodes.length > 0;
  const textDraft = useViuImeTextDraft(
    textValue,
    (value) => onCommit(createTextContentViuBatch(project, selection, value)),
    selection.nodeIds.join(':')
  );
  const imageEditable = Boolean(selectedImageNode && !disabled && !selectedImageNode.locked);
  const imageTransform = normalizeViuImageTransform(selectedImageNode?.imageTransform);
  const commitImageTransform = (patch: Parameters<typeof createImageTransformViuBatch>[2]): void => {
    if (!selectedImageNode) return;
    onCommit(createImageTransformViuBatch(project, selection, patch));
  };
  const qualityDiagnostics = useMemo(() => {
    const diagnostics = auditViuProjectQuality(project);
    if (selection.nodeIds.length === 0) return diagnostics;
    const selectedIds = new Set(selection.nodeIds);
    return diagnostics.filter((item) => item.entityId && selectedIds.has(item.entityId));
  }, [project, selection.nodeIds]);
  const vectorEditable = Boolean(selectedVectorNode && !disabled && !selectedVectorNode.locked);
  const commitVector = (vector: ViuVectorGeometry): void => {
    if (!selectedVectorNode) return;
    onCommit({
      intent: 'vector',
      commands: [{ type: 'updateNode', nodeId: selectedVectorNode.id, patch: { vector } }],
    });
  };
  const vectorDraft = useViuImeTextDraft(
    selectedVectorNode?.vector?.pathData ?? '',
    (pathData) => {
      if (!selectedVectorNode?.vector || validateViuSvgPathData(pathData)) return;
      commitVector({ ...selectedVectorNode.vector, pathData, closed: isViuSvgPathClosed(pathData) });
    },
    selectedVectorNode ? `${selectedVectorNode.id}:${selectedVectorNode.version}` : 'no-vector'
  );
  const vectorPathError = selectedVectorNode ? validateViuSvgPathData(vectorDraft.value) : undefined;
  const commitVectorPoints = (points: ViuVectorPoint[]): void => {
    if (!selectedVectorNode?.vector) return;
    commitVector({
      ...selectedVectorNode.vector,
      points,
      pathData: createViuSvgPathData(points, selectedVectorNode.vector.closed),
    });
  };
  const updateVectorPoint = (pointId: string, patch: Partial<Omit<ViuVectorPoint, 'id'>>): void => {
    if (!selectedVectorNode?.vector) return;
    commitVectorPoints(
      selectedVectorNode.vector.points.map((point) => (point.id === pointId ? { ...point, ...patch } : point))
    );
  };
  const updateVectorHandle = (
    point: ViuVectorPoint,
    handle: 'handleIn' | 'handleOut',
    axis: 'x' | 'y',
    value: number | undefined
  ): void => {
    if (value === undefined) return;
    updateVectorPoint(point.id, { [handle]: { x: 0, y: 0, ...point[handle], [axis]: value } });
  };
  const removeVectorHandle = (point: ViuVectorPoint, handle: 'handleIn' | 'handleOut'): void => {
    const next = { ...point };
    delete next[handle];
    updateVectorPoint(point.id, next);
  };
  const addVectorPoint = (): void => {
    if (!selectedVectorNode?.vector) return;
    const last = selectedVectorNode.vector.points.at(-1);
    commitVectorPoints([
      ...selectedVectorNode.vector.points,
      {
        id: nextComponentId('anchor'),
        x: Math.min(selectedVectorNode.size.width, (last?.x ?? selectedVectorNode.size.width / 2) + 24),
        y: Math.min(selectedVectorNode.size.height, (last?.y ?? selectedVectorNode.size.height / 2) + 24),
        pointType: 'corner',
      },
    ]);
  };
  const removeVectorPoint = (pointId: string): void => {
    if (!selectedVectorNode?.vector || selectedVectorNode.vector.points.length <= 2) return;
    commitVectorPoints(selectedVectorNode.vector.points.filter((point) => point.id !== pointId));
  };

  const renderVectorHandle = (
    point: ViuVectorPoint,
    handle: 'handleIn' | 'handleOut',
    label: string
  ): React.ReactNode => (
    <div className='rd-8px border border-b-1 bg-bg-1 p-8px flex flex-col gap-7px'>
      <div className='flex items-center justify-between gap-6px'>
        <span className='text-11px font-700 text-t-secondary'>{label}</span>
        {point[handle] ? (
          <Button
            size='mini'
            type='text'
            icon={<Delete size={12} />}
            aria-label={labels.vector.removeHandle}
            disabled={!vectorEditable}
            onClick={() => removeVectorHandle(point, handle)}
          />
        ) : null}
      </div>
      <div className='grid grid-cols-2 gap-7px'>
        {(['x', 'y'] as const).map((axis) => (
          <Field key={axis} label={axis === 'x' ? labels.vector.x : labels.vector.y}>
            <InputNumber
              size='mini'
              disabled={!vectorEditable}
              value={point[handle]?.[axis]}
              placeholder='0'
              onChange={(value) => updateVectorHandle(point, handle, axis, value)}
            />
          </Field>
        ))}
      </div>
    </div>
  );

  const styleOf = (node: ViuNode): ViuAuthoringNodeStyle =>
    (node.componentInstance
      ? (resolveViuComponentInstance(project, node)?.nodes[node.id]?.style ?? node.style)
      : node.style) as ViuAuthoringNodeStyle;

  const typographyValue = <K extends keyof ViuAuthoringNodeStyle>(key: K): ViuAuthoringNodeStyle[K] | undefined =>
    commonValue(getViuMixedValue(typographyNodes, (node) => styleOf(node)[key]));
  const appearanceValue = <K extends keyof ViuAuthoringNodeStyle>(key: K): ViuAuthoringNodeStyle[K] | undefined =>
    commonValue(getViuMixedValue(selectedNodes, (node) => styleOf(node)[key]));
  const commitTypography = (patch: ViuTypographyPatch): void =>
    onCommit(createTypographyViuBatch(project, selection, patch));
  const commitAppearance = (patch: ViuAppearancePatch): void =>
    onCommit(createAppearanceViuBatch(project, selection, patch));

  const typography: ViuTypographyPatch = {
    fontFamily: typographyValue('fontFamily') as string | undefined,
    fontSize: typographyValue('fontSize') as number | undefined,
    fontWeight: typographyValue('fontWeight') as number | undefined,
    fontStyle: typographyValue('fontStyle'),
    lineHeight: typographyValue('lineHeight') as number | undefined,
    letterSpacing: typographyValue('letterSpacing') as number | undefined,
    textDecoration: typographyValue('textDecoration'),
    textTransform: typographyValue('textTransform'),
    textAlign: typographyValue('textAlign'),
    verticalAlign: typographyValue('verticalAlign'),
  };
  const shadow = appearanceValue('shadow') as string | undefined;
  const textColor = typographyValue('color') as string | undefined;
  const background = appearanceValue('background') as string | undefined;

  const borderColor = appearanceValue('borderColor') as string | undefined;
  const borderStyle = appearanceValue('borderStyle') as ViuAuthoringNodeStyle['borderStyle'];
  const overflow = appearanceValue('overflow') as 'visible' | 'hidden' | 'scroll' | undefined;
  const gradient = parseViuGradient(background);
  const fillType: ViuFillType = background?.trimStart().startsWith('linear-gradient(')
    ? 'linear'
    : background?.trimStart().startsWith('radial-gradient(')
      ? 'radial'
      : 'solid';
  const gradientStart = gradient?.start ?? (fillType === 'solid' ? (background ?? 'currentColor') : 'currentColor');
  const gradientEnd = gradient?.end ?? 'transparent';
  const gradientAngle = gradient?.angle ?? 135;
  const shadowEditor = parseViuShadow(shadow) ?? {
    x: 0,
    y: 8,
    blur: 24,
    spread: 0,
    color: 'rgba(0, 0, 0, 0.24)',
  };

  const fills = (appearanceValue('fills') as ViuFill[] | undefined) ?? [];
  const effects = (appearanceValue('effects') as ViuEffect[] | undefined) ?? [];
  const strokes = (appearanceValue('strokes') as ViuStroke[] | undefined) ?? [];
  const commitFills = (next: ViuFill[]): void => commitAppearance({ fills: next.length === 0 ? undefined : next });
  const commitEffects = (next: ViuEffect[]): void =>
    commitAppearance({ effects: next.length === 0 ? undefined : next });

  return (
    <aside
      data-testid='viu-authoring-inspector'
      className={`min-h-0 overflow-auto bg-bg-1 p-12px flex flex-col gap-12px ${className ?? ''}`}
    >
      <div className='h-34px flex items-center justify-between gap-10px'>
        <div className='text-13px font-750 text-t-primary'>{labels.title}</div>
        <Tag size='small'>{labels.selectionCount(selectedNodes.length)}</Tag>
      </div>

      <ComponentInspector
        labels={labels.component}
        model={componentModel}
        disabled={disabled}
        onCreateComponent={() => {
          if (!selectedNode) return;
          onCommit(
            createComponentViuBatch(project, selection, {
              componentId: nextComponentId('component'),
              name: selectedNode.name,
            })
          );
        }}
        onCreateInstance={() => {
          if (!definition) return;
          onCommit(
            createComponentInstanceViuBatch(project, selection, {
              instanceId: nextComponentId('instance'),
              componentId: definition.id,
            })
          );
        }}
        onCreateComponentSet={() =>
          onCommit(
            createComponentSetViuBatch(project, selection, {
              componentSetId: nextComponentId('component-set'),
              name: selectedNodes.map((node) => node.name).join(' / '),
              axisName: labels.component.stateAxis,
            })
          )
        }
        onRenameComponent={(name) => {
          if (definition) onCommit(createRenameComponentViuBatch(project, definition.id, name));
        }}
        onSwapComponent={(componentId) => {
          if (selectedNode?.componentInstance) {
            onCommit(createSwapInstanceViuBatch(project, selectedNode.id, componentId));
          }
        }}
        onChangeVariant={(axis, value) => {
          if (selectedNode?.componentInstance) {
            onCommit(createInstanceVariantViuBatch(project, selectedNode.id, axis, value));
          }
        }}
        onChangeProperty={(propertyId, value) => {
          if (selectedNode?.componentInstance) {
            onCommit(createInstancePropertyViuBatch(project, selectedNode.id, propertyId, value));
          }
        }}
        onResetOverrides={() => {
          if (selectedNode?.componentInstance) {
            onCommit(createResetInstanceOverridesViuBatch(project, selectedNode.id));
          }
        }}
        onDetachInstance={() => {
          if (!selectedNode?.componentInstance) return;
          onCommit(
            createDetachInstanceViuBatch(project, selectedNode.id, {
              idFactory: (kind, sourceId) => nextComponentId(`${kind}-${sourceId}`),
            })
          );
        }}
      />

      <PrototypeInspector
        project={project}
        selection={selection}
        labels={labels.prototype}
        disabled={disabled}
        onCommit={onCommit}
      />

      <Section title={labels.text.section} icon={<Text size={15} />}>
        <Field label={labels.text.content}>
          <TextArea
            data-testid='viu-authoring-text-content'
            autoSize={{ minRows: 3, maxRows: 8 }}
            disabled={!textEditable}
            value={textDraft.value}
            placeholder={textMixed ? labels.mixed : labels.text.placeholder}
            onChange={textDraft.onChange}
            onCompositionStart={textDraft.onCompositionStart}
            onCompositionEnd={textDraft.onCompositionEnd}
            onBlur={textDraft.onBlur}
            onKeyDown={textDraft.onKeyDown}
          />
        </Field>
      </Section>

      {selectedImageNode && labels.image ? (
        <Section title={labels.image.section} icon={<Picture size={15} />}>
          <div className='grid grid-cols-2 gap-8px'>
            <Field label={labels.image.fit}>
              <Select
                data-testid='viu-authoring-image-fit'
                size='small'
                disabled={!imageEditable}
                value={imageTransform.fit}
                options={[
                  { value: 'cover', label: labels.image.fitCover },
                  { value: 'contain', label: labels.image.fitContain },
                  { value: 'fill', label: labels.image.fitFill },
                  { value: 'none', label: labels.image.fitNone },
                  { value: 'scale-down', label: labels.image.fitScaleDown },
                ]}
                onChange={(fit) => commitImageTransform({ fit })}
              />
            </Field>
            <Field label={labels.image.rotation}>
              <InputNumber
                data-testid='viu-authoring-image-rotation'
                size='small'
                min={-360_000}
                max={360_000}
                suffix='°'
                disabled={!imageEditable}
                value={imageTransform.rotation}
                onChange={(rotation) => rotation !== undefined && commitImageTransform({ rotation })}
              />
            </Field>
          </div>
          <div className='rd-10px border border-b-1 bg-fill-1 p-9px flex flex-col gap-8px'>
            <div className='text-11px font-750 uppercase tracking-0.08em text-t-secondary'>{labels.image.crop}</div>
            <div className='grid grid-cols-4 gap-6px'>
              {(
                [
                  ['x', 0, 100 - imageTransform.crop.width * 100],
                  ['y', 0, 100 - imageTransform.crop.height * 100],
                  ['width', 0.1, 100 - imageTransform.crop.x * 100],
                  ['height', 0.1, 100 - imageTransform.crop.y * 100],
                ] as const
              ).map(([key, minimum, maximum]) => (
                <Field key={key} label={key === 'x' ? labels.vector.x : key === 'y' ? labels.vector.y : key}>
                  <InputNumber
                    data-testid={`viu-authoring-image-crop-${key}`}
                    size='small'
                    min={minimum}
                    max={maximum}
                    suffix={labels.units.percent}
                    disabled={!imageEditable}
                    value={Math.round(imageTransform.crop[key] * 10_000) / 100}
                    onChange={(value) => value !== undefined && commitImageTransform({ crop: { [key]: value / 100 } })}
                  />
                </Field>
              ))}
            </div>
          </div>
          <div className='rd-10px border border-b-1 bg-fill-1 p-9px flex flex-col gap-8px'>
            <div className='text-11px font-750 uppercase tracking-0.08em text-t-secondary'>
              {labels.image.focalPoint}
            </div>
            <div className='grid grid-cols-2 gap-8px'>
              {(['x', 'y'] as const).map((axis) => (
                <Field key={axis} label={axis.toUpperCase()}>
                  <InputNumber
                    data-testid={`viu-authoring-image-focal-${axis}`}
                    size='small'
                    min={0}
                    max={100}
                    suffix={labels.units.percent}
                    disabled={!imageEditable}
                    value={Math.round(imageTransform.focalPoint[axis] * 10_000) / 100}
                    onChange={(value) =>
                      value !== undefined && commitImageTransform({ focalPoint: { [axis]: value / 100 } })
                    }
                  />
                </Field>
              ))}
            </div>
          </div>
          <div className='grid grid-cols-2 gap-8px'>
            <Field label={labels.image.flipHorizontal}>
              <Switch
                data-testid='viu-authoring-image-flip-horizontal'
                size='small'
                disabled={!imageEditable}
                checked={imageTransform.flipHorizontal}
                onChange={(flipHorizontal) => commitImageTransform({ flipHorizontal })}
              />
            </Field>
            <Field label={labels.image.flipVertical}>
              <Switch
                data-testid='viu-authoring-image-flip-vertical'
                size='small'
                disabled={!imageEditable}
                checked={imageTransform.flipVertical}
                onChange={(flipVertical) => commitImageTransform({ flipVertical })}
              />
            </Field>
          </div>
          <Button
            data-testid='viu-authoring-image-reset'
            size='mini'
            type='text'
            disabled={!imageEditable}
            onClick={() => commitImageTransform(structuredClone(DEFAULT_VIU_IMAGE_TRANSFORM))}
          >
            {labels.image.reset}
          </Button>
        </Section>
      ) : null}

      <TypographyInspector
        labels={labels.typography}
        mixedLabel={labels.mixed}
        pixelsLabel={labels.units.pixels}
        value={typography}
        fontOptions={fontOptions}
        fontWeightOptions={fontWeightOptions}
        fontCatalog={fontCatalog}
        disabled={!typographyEditable}
        onCommit={commitTypography}
      />

      {selectedVectorNode?.vector ? (
        <Section title={labels.vector.section} icon={<BezierCurve size={15} />}>
          <Field label={labels.vector.pathData}>
            <TextArea
              data-testid='viu-authoring-vector-path'
              autoSize={{ minRows: 2, maxRows: 6 }}
              disabled={!vectorEditable}
              value={vectorDraft.value}
              status={vectorPathError ? 'error' : undefined}
              onChange={vectorDraft.onChange}
              onCompositionStart={vectorDraft.onCompositionStart}
              onCompositionEnd={vectorDraft.onCompositionEnd}
              onBlur={vectorDraft.onBlur}
              onKeyDown={vectorDraft.onKeyDown}
            />
            {vectorPathError ? <span className='text-11px text-danger'>{labels.vector.invalidPath}</span> : null}
          </Field>

          <div className='grid grid-cols-2 gap-8px'>
            <Field label={labels.vector.closed}>
              <Switch
                data-testid='viu-authoring-vector-closed'
                size='small'
                disabled={!vectorEditable}
                checked={selectedVectorNode.vector.closed}
                onChange={(closed) =>
                  commitVector({
                    ...selectedVectorNode.vector!,
                    closed,
                    pathData: createViuSvgPathData(selectedVectorNode.vector!.points, closed),
                  })
                }
              />
            </Field>
            <Field label={labels.vector.fillRule}>
              <Select
                data-testid='viu-authoring-vector-fill-rule'
                size='small'
                disabled={!vectorEditable}
                value={selectedVectorNode.vector.fillRule}
                options={[
                  { value: 'nonzero', label: labels.vector.nonzero },
                  { value: 'evenodd', label: labels.vector.evenodd },
                ]}
                onChange={(fillRule) =>
                  commitVector({ ...selectedVectorNode.vector!, fillRule: fillRule as ViuVectorGeometry['fillRule'] })
                }
              />
            </Field>
            <Field label={labels.vector.strokeCap}>
              <Select
                data-testid='viu-authoring-vector-stroke-cap'
                size='small'
                disabled={!vectorEditable}
                value={selectedVectorNode.vector.strokeCap}
                options={[
                  { value: 'butt', label: labels.vector.butt },
                  { value: 'round', label: labels.vector.round },
                  { value: 'square', label: labels.vector.square },
                ]}
                onChange={(strokeCap) =>
                  commitVector({
                    ...selectedVectorNode.vector!,
                    strokeCap: strokeCap as ViuVectorGeometry['strokeCap'],
                  })
                }
              />
            </Field>
            <Field label={labels.vector.strokeJoin}>
              <Select
                data-testid='viu-authoring-vector-stroke-join'
                size='small'
                disabled={!vectorEditable}
                value={selectedVectorNode.vector.strokeJoin}
                options={[
                  { value: 'miter', label: labels.vector.miter },
                  { value: 'round', label: labels.vector.round },
                  { value: 'bevel', label: labels.vector.bevel },
                ]}
                onChange={(strokeJoin) =>
                  commitVector({
                    ...selectedVectorNode.vector!,
                    strokeJoin: strokeJoin as ViuVectorGeometry['strokeJoin'],
                  })
                }
              />
            </Field>
          </div>
          <Field label={labels.vector.miterLimit}>
            <InputNumber
              data-testid='viu-authoring-vector-miter-limit'
              size='small'
              min={1}
              max={1_000}
              disabled={!vectorEditable || selectedVectorNode.vector.strokeJoin !== 'miter'}
              value={selectedVectorNode.vector.miterLimit}
              onChange={(miterLimit) =>
                miterLimit !== undefined && commitVector({ ...selectedVectorNode.vector!, miterLimit })
              }
            />
          </Field>

          <div className='flex items-center justify-between gap-8px'>
            <div className='flex items-center gap-7px'>
              <span className='text-11px font-750 uppercase tracking-0.08em text-t-secondary'>
                {labels.vector.anchors}
              </span>
              <Tag size='small'>{selectedVectorNode.vector.points.length}</Tag>
            </div>
            <Button
              data-testid='viu-authoring-vector-add-anchor'
              size='mini'
              type='text'
              icon={<Plus size={13} />}
              disabled={!vectorEditable || selectedVectorNode.vector.points.length >= 10_000}
              onClick={addVectorPoint}
            >
              {labels.vector.addAnchor}
            </Button>
          </div>

          <div className='flex flex-col gap-8px'>
            {selectedVectorNode.vector.points.map((point, index) => (
              <div
                key={point.id}
                data-testid={`viu-authoring-vector-anchor-${point.id}`}
                className='rd-10px border border-b-1 bg-fill-1 p-9px flex flex-col gap-8px'
              >
                <div className='flex items-center gap-7px'>
                  <Tag size='small'>{index + 1}</Tag>
                  <span className='min-w-0 flex-1 truncate font-mono text-11px text-t-tertiary'>{point.id}</span>
                  <Button
                    size='mini'
                    type='text'
                    icon={<Delete size={13} />}
                    aria-label={labels.vector.removeAnchor}
                    disabled={!vectorEditable || selectedVectorNode.vector!.points.length <= 2}
                    onClick={() => removeVectorPoint(point.id)}
                  />
                </div>
                <Field label={labels.vector.pointType}>
                  <Select
                    size='mini'
                    disabled={!vectorEditable}
                    value={point.pointType}
                    options={[
                      { value: 'corner', label: labels.vector.corner },
                      { value: 'smooth', label: labels.vector.smooth },
                      { value: 'symmetric', label: labels.vector.symmetric },
                    ]}
                    onChange={(pointType) =>
                      updateVectorPoint(point.id, { pointType: pointType as ViuVectorPoint['pointType'] })
                    }
                  />
                </Field>
                <div className='grid grid-cols-2 gap-7px'>
                  {(['x', 'y'] as const).map((axis) => (
                    <Field key={axis} label={axis === 'x' ? labels.vector.x : labels.vector.y}>
                      <InputNumber
                        size='mini'
                        disabled={!vectorEditable}
                        value={point[axis]}
                        onChange={(value) => value !== undefined && updateVectorPoint(point.id, { [axis]: value })}
                      />
                    </Field>
                  ))}
                </div>
                <div className='grid grid-cols-2 gap-7px'>
                  {renderVectorHandle(point, 'handleIn', labels.vector.handleIn)}
                  {renderVectorHandle(point, 'handleOut', labels.vector.handleOut)}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {labels.stroke ? (
        <Section title={labels.stroke.section} icon={<BezierCurve size={15} />}>
          <div className='flex justify-end'>
            <Button
              data-testid='viu-authoring-stroke-add'
              size='mini'
              type='text'
              icon={<Plus size={13} />}
              disabled={!editable || strokes.length >= 32}
              onClick={() =>
                commitAppearance({
                  strokes: [
                    ...strokes,
                    {
                      id: nextComponentId('stroke'),
                      visible: true,
                      opacity: 1,
                      color: borderColor ?? 'currentColor',
                      width: 1,
                      alignment: 'inside',
                      cap: 'butt',
                      join: 'miter',
                      miterLimit: 4,
                      dashPattern: [],
                      dashOffset: 0,
                    },
                  ],
                })
              }
            >
              {labels.stroke.add}
            </Button>
          </div>
          <div className='flex flex-col gap-8px'>
            {strokes.map((stroke, index) => (
              <div key={stroke.id} className='rd-10px border border-b-1 bg-fill-1 p-9px flex flex-col gap-8px'>
                <div className='flex items-center gap-7px'>
                  <Switch
                    size='small'
                    aria-label={labels.stroke.visible}
                    disabled={!editable}
                    checked={stroke.visible}
                    onChange={(visible) =>
                      commitAppearance({ strokes: replaceStackItem(strokes, { ...stroke, visible }) })
                    }
                  />
                  <Tag size='small'>{index + 1}</Tag>
                  <span className='min-w-0 flex-1 truncate font-mono text-11px text-t-tertiary'>{stroke.id}</span>
                  <Button
                    size='mini'
                    type='text'
                    icon={<Delete size={13} />}
                    aria-label={labels.stroke.remove}
                    disabled={!editable}
                    onClick={() => commitAppearance({ strokes: strokes.filter((item) => item.id !== stroke.id) })}
                  />
                </div>
                <div className='grid grid-cols-2 gap-8px'>
                  <Field label={labels.stroke.color}>
                    <ColorPicker
                      size='small'
                      mode='single'
                      showText
                      disabled={!editable}
                      value={stroke.color}
                      onChange={(color) =>
                        typeof color === 'string' &&
                        commitAppearance({ strokes: replaceStackItem(strokes, { ...stroke, color }) })
                      }
                    />
                  </Field>
                  <Field label={labels.stroke.width}>
                    <InputNumber
                      size='small'
                      min={0}
                      max={10_000}
                      suffix={labels.units.pixels}
                      disabled={!editable}
                      value={stroke.width}
                      onChange={(width) =>
                        width !== undefined &&
                        commitAppearance({ strokes: replaceStackItem(strokes, { ...stroke, width }) })
                      }
                    />
                  </Field>
                  <Field label={labels.stroke.alignment}>
                    <Select
                      size='small'
                      disabled={!editable}
                      value={stroke.alignment}
                      options={[
                        { value: 'inside', label: labels.stroke.inside },
                        { value: 'center', label: labels.stroke.center },
                        { value: 'outside', label: labels.stroke.outside },
                      ]}
                      onChange={(alignment) =>
                        commitAppearance({
                          strokes: replaceStackItem(strokes, {
                            ...stroke,
                            alignment: alignment as ViuStroke['alignment'],
                          }),
                        })
                      }
                    />
                  </Field>
                  <Field label={labels.stroke.cap}>
                    <Select
                      size='small'
                      disabled={!editable}
                      value={stroke.cap}
                      options={[
                        { value: 'butt', label: labels.stroke.butt },
                        { value: 'round', label: labels.stroke.round },
                        { value: 'square', label: labels.stroke.square },
                      ]}
                      onChange={(cap) =>
                        commitAppearance({
                          strokes: replaceStackItem(strokes, { ...stroke, cap: cap as ViuStroke['cap'] }),
                        })
                      }
                    />
                  </Field>
                  <Field label={labels.stroke.join}>
                    <Select
                      size='small'
                      disabled={!editable}
                      value={stroke.join}
                      options={[
                        { value: 'miter', label: labels.stroke.miter },
                        { value: 'round', label: labels.stroke.round },
                        { value: 'bevel', label: labels.stroke.bevel },
                      ]}
                      onChange={(join) =>
                        commitAppearance({
                          strokes: replaceStackItem(strokes, { ...stroke, join: join as ViuStroke['join'] }),
                        })
                      }
                    />
                  </Field>
                  <Field label={labels.stroke.miterLimit}>
                    <InputNumber
                      size='small'
                      min={1}
                      max={1_000}
                      disabled={!editable || stroke.join !== 'miter'}
                      value={stroke.miterLimit}
                      onChange={(miterLimit) =>
                        miterLimit !== undefined &&
                        commitAppearance({ strokes: replaceStackItem(strokes, { ...stroke, miterLimit }) })
                      }
                    />
                  </Field>
                  <Field label={labels.stroke.dashPattern}>
                    <Input
                      key={`${stroke.id}:${stroke.dashPattern.join(',')}`}
                      size='small'
                      disabled={!editable}
                      defaultValue={stroke.dashPattern.join(', ')}
                      onPressEnter={(event) => event.currentTarget.blur()}
                      onBlur={(event) => {
                        const dashPattern = event.currentTarget.value
                          .split(/[\s,]+/u)
                          .filter(Boolean)
                          .map(Number)
                          .filter((value) => Number.isFinite(value) && value >= 0);
                        if (
                          dashPattern.length <= 32 &&
                          (dashPattern.length === 0 || !dashPattern.every((value) => value === 0))
                        ) {
                          commitAppearance({ strokes: replaceStackItem(strokes, { ...stroke, dashPattern }) });
                        }
                      }}
                    />
                  </Field>
                  <Field label={labels.stroke.dashOffset}>
                    <InputNumber
                      size='small'
                      min={-100_000}
                      max={100_000}
                      disabled={!editable}
                      value={stroke.dashOffset}
                      onChange={(dashOffset) =>
                        dashOffset !== undefined &&
                        commitAppearance({ strokes: replaceStackItem(strokes, { ...stroke, dashOffset }) })
                      }
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <LayoutInspector
        project={project}
        selection={selection}
        labels={labels.layout}
        disabled={disabled}
        onCommit={onCommit}
      />

      <Section title={labels.appearance.section} icon={<Effects size={15} />}>
        <div className='grid grid-cols-2 gap-9px'>
          <Field label={labels.appearance.textColor}>
            <ColorPicker
              data-testid='viu-authoring-text-color'
              size='small'
              mode='single'
              showText
              disabled={!textEditable}
              value={textColor ?? 'transparent'}
              onChange={(value) => typeof value === 'string' && commitAppearance({ color: value })}
            />
          </Field>
          <Field label={labels.appearance.opacity}>
            <InputNumber
              data-testid='viu-authoring-opacity'
              size='small'
              min={0}
              max={100}
              suffix={labels.units.percent}
              disabled={!editable}
              value={
                appearanceValue('opacity') === undefined
                  ? undefined
                  : Math.round((appearanceValue('opacity') as number) * 100)
              }
              placeholder={labels.mixed}
              onChange={(value) => value !== undefined && commitAppearance({ opacity: value / 100 })}
            />
          </Field>
        </div>

        <div className='rd-10px border border-b-1 bg-fill-1 p-9px flex flex-col gap-9px'>
          <div className='flex items-center justify-between gap-8px'>
            <div className='text-11px font-750 uppercase tracking-0.08em text-t-secondary'>
              {labels.appearance.fillStack}
            </div>
            <Select
              data-testid='viu-authoring-add-fill'
              size='mini'
              disabled={!editable || fills.length >= 32}
              placeholder={labels.appearance.addFill}
              style={{ width: 126 }}
              options={[
                { value: 'solid', label: labels.appearance.fillSolid },
                { value: 'linear', label: labels.appearance.fillLinear },
                { value: 'radial', label: labels.appearance.fillRadial },
              ]}
              onChange={(value) => {
                const id = nextComponentId('fill');
                const stops = [
                  { color: 'currentColor', position: 0 },
                  { color: 'transparent', position: 1 },
                ];
                const next: ViuFill =
                  value === 'solid'
                    ? { id, type: 'solid', visible: true, opacity: 1, color: 'currentColor' }
                    : value === 'linear'
                      ? { id, type: 'linear', visible: true, opacity: 1, angle: 135, stops }
                      : {
                          id,
                          type: 'radial',
                          visible: true,
                          opacity: 1,
                          centerX: 50,
                          centerY: 50,
                          radius: 70,
                          stops,
                        };
                commitFills([...fills, next]);
              }}
            />
          </div>
          {fills.length === 0 ? (
            <div className='py-7px text-center text-11px text-t-tertiary'>{labels.appearance.legacyFallback}</div>
          ) : null}
          {fills.map((fill, index) => (
            <div
              key={fill.id}
              data-testid={`viu-authoring-fill-${fill.id}`}
              className='rd-8px border border-b-1 bg-bg-2 p-8px flex flex-col gap-8px'
            >
              <div className='flex items-center gap-6px'>
                <Switch
                  size='small'
                  checked={fill.visible}
                  disabled={!editable}
                  aria-label={labels.appearance.visible}
                  onChange={(visible) => commitFills(replaceStackItem(fills, { ...fill, visible }))}
                />
                <Select
                  size='mini'
                  className='min-w-0 flex-1'
                  disabled={!editable}
                  value={fill.type}
                  options={[
                    { value: 'solid', label: labels.appearance.fillSolid },
                    { value: 'linear', label: labels.appearance.fillLinear },
                    { value: 'radial', label: labels.appearance.fillRadial },
                  ]}
                  onChange={(value) => {
                    const stops =
                      fill.type === 'solid'
                        ? [
                            { color: fill.color, position: 0 },
                            { color: fill.color, position: 1 },
                          ]
                        : fill.stops;
                    const next: ViuFill =
                      value === 'solid'
                        ? {
                            id: fill.id,
                            type: 'solid',
                            visible: fill.visible,
                            opacity: fill.opacity,
                            color: stops[0]!.color,
                          }
                        : value === 'linear'
                          ? {
                              id: fill.id,
                              type: 'linear',
                              visible: fill.visible,
                              opacity: fill.opacity,
                              angle: 135,
                              stops,
                            }
                          : {
                              id: fill.id,
                              type: 'radial',
                              visible: fill.visible,
                              opacity: fill.opacity,
                              centerX: 50,
                              centerY: 50,
                              radius: 70,
                              stops,
                            };
                    commitFills(replaceStackItem(fills, next));
                  }}
                />
                <Button
                  size='mini'
                  type='text'
                  icon={<Up size={13} />}
                  aria-label={labels.appearance.moveUp}
                  disabled={!editable || index === 0}
                  onClick={() => commitFills(moveStackItem(fills, fill.id, -1))}
                />
                <Button
                  size='mini'
                  type='text'
                  icon={<Down size={13} />}
                  aria-label={labels.appearance.moveDown}
                  disabled={!editable || index === fills.length - 1}
                  onClick={() => commitFills(moveStackItem(fills, fill.id, 1))}
                />
                <Button
                  size='mini'
                  type='text'
                  status='danger'
                  icon={<Delete size={13} />}
                  aria-label={labels.appearance.remove}
                  disabled={!editable}
                  onClick={() => commitFills(fills.filter((item) => item.id !== fill.id))}
                />
              </div>
              <div className='grid grid-cols-2 gap-7px'>
                <Field label={labels.appearance.opacity}>
                  <InputNumber
                    size='mini'
                    min={0}
                    max={100}
                    suffix={labels.units.percent}
                    disabled={!editable}
                    value={Math.round(fill.opacity * 100)}
                    onChange={(value) =>
                      value !== undefined && commitFills(replaceStackItem(fills, { ...fill, opacity: value / 100 }))
                    }
                  />
                </Field>
                {fill.type === 'solid' ? (
                  <Field label={labels.appearance.fillSolid}>
                    <ColorPicker
                      size='small'
                      mode='single'
                      showText
                      disabled={!editable}
                      value={fill.color}
                      onChange={(value) =>
                        typeof value === 'string' && commitFills(replaceStackItem(fills, { ...fill, color: value }))
                      }
                    />
                  </Field>
                ) : (
                  <Field label={labels.appearance.gradientAngle}>
                    <InputNumber
                      size='mini'
                      min={-3_600}
                      max={3_600}
                      disabled={!editable || fill.type === 'radial'}
                      value={fill.type === 'linear' ? fill.angle : undefined}
                      onChange={(value) =>
                        value !== undefined &&
                        fill.type === 'linear' &&
                        commitFills(replaceStackItem(fills, { ...fill, angle: value }))
                      }
                    />
                  </Field>
                )}
              </div>
              {fill.type !== 'solid' ? (
                <>
                  <div className='grid grid-cols-2 gap-7px'>
                    {[0, fill.stops.length - 1].map((stopIndex) => (
                      <Field
                        key={stopIndex}
                        label={stopIndex === 0 ? labels.appearance.fillStart : labels.appearance.fillEnd}
                      >
                        <ColorPicker
                          size='small'
                          mode='single'
                          showText
                          disabled={!editable}
                          value={fill.stops[stopIndex]!.color}
                          onChange={(value) => {
                            if (typeof value !== 'string') return;
                            const stops = fill.stops.map((stop, current) =>
                              current === stopIndex ? { ...stop, color: value } : stop
                            );
                            commitFills(replaceStackItem(fills, { ...fill, stops }));
                          }}
                        />
                      </Field>
                    ))}
                  </div>
                  {fill.type === 'radial' ? (
                    <div className='grid grid-cols-3 gap-7px'>
                      {(
                        [
                          ['centerX', labels.appearance.radialCenterX],
                          ['centerY', labels.appearance.radialCenterY],
                          ['radius', labels.appearance.radialRadius],
                        ] as const
                      ).map(([key, label]) => (
                        <Field key={key} label={label}>
                          <InputNumber
                            size='mini'
                            disabled={!editable}
                            min={key === 'radius' ? 0.01 : -1_000}
                            max={key === 'radius' ? 10_000 : 1_000}
                            value={fill[key]}
                            onChange={(value) =>
                              value !== undefined && commitFills(replaceStackItem(fills, { ...fill, [key]: value }))
                            }
                          />
                        </Field>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ))}
        </div>

        <div className='rd-10px border border-b-1 bg-fill-1 p-9px flex flex-col gap-9px'>
          <div className='flex items-center justify-between gap-8px'>
            <div className='text-11px font-750 uppercase tracking-0.08em text-t-secondary'>
              {labels.appearance.effectStack}
            </div>
            <Select
              data-testid='viu-authoring-add-effect'
              size='mini'
              disabled={!editable || effects.length >= 32}
              placeholder={labels.appearance.addEffect}
              style={{ width: 148 }}
              options={[
                { value: 'drop-shadow', label: labels.appearance.effectDropShadow },
                { value: 'inner-shadow', label: labels.appearance.effectInnerShadow },
                { value: 'layer-blur', label: labels.appearance.effectLayerBlur },
                { value: 'backdrop-blur', label: labels.appearance.effectBackdropBlur },
              ]}
              onChange={(value) => {
                const id = nextComponentId('effect');
                const next: ViuEffect =
                  value === 'layer-blur' || value === 'backdrop-blur'
                    ? { id, type: value, visible: true, radius: 8 }
                    : {
                        id,
                        type: value as 'drop-shadow' | 'inner-shadow',
                        visible: true,
                        x: 0,
                        y: 8,
                        blur: 24,
                        spread: 0,
                        color: 'rgba(0, 0, 0, 0.24)',
                      };
                commitEffects([...effects, next]);
              }}
            />
          </div>
          {effects.length === 0 ? (
            <div className='py-7px text-center text-11px text-t-tertiary'>{labels.appearance.legacyFallback}</div>
          ) : null}
          {effects.map((effect, index) => {
            const blurEffect = 'radius' in effect ? effect : null;
            const shadowEffect = 'radius' in effect ? null : effect;
            return (
              <div
                key={effect.id}
                data-testid={`viu-authoring-effect-${effect.id}`}
                className='rd-8px border border-b-1 bg-bg-2 p-8px flex flex-col gap-8px'
              >
                <div className='flex items-center gap-6px'>
                  <Switch
                    size='small'
                    checked={effect.visible}
                    disabled={!editable}
                    aria-label={labels.appearance.visible}
                    onChange={(visible) => commitEffects(replaceStackItem(effects, { ...effect, visible }))}
                  />
                  <Tag size='small' className='min-w-0 flex-1'>
                    {effect.type === 'drop-shadow'
                      ? labels.appearance.effectDropShadow
                      : effect.type === 'inner-shadow'
                        ? labels.appearance.effectInnerShadow
                        : effect.type === 'layer-blur'
                          ? labels.appearance.effectLayerBlur
                          : labels.appearance.effectBackdropBlur}
                  </Tag>
                  <Button
                    size='mini'
                    type='text'
                    icon={<Up size={13} />}
                    aria-label={labels.appearance.moveUp}
                    disabled={!editable || index === 0}
                    onClick={() => commitEffects(moveStackItem(effects, effect.id, -1))}
                  />
                  <Button
                    size='mini'
                    type='text'
                    icon={<Down size={13} />}
                    aria-label={labels.appearance.moveDown}
                    disabled={!editable || index === effects.length - 1}
                    onClick={() => commitEffects(moveStackItem(effects, effect.id, 1))}
                  />
                  <Button
                    size='mini'
                    type='text'
                    status='danger'
                    icon={<Delete size={13} />}
                    aria-label={labels.appearance.remove}
                    disabled={!editable}
                    onClick={() => commitEffects(effects.filter((item) => item.id !== effect.id))}
                  />
                </div>
                {blurEffect !== null ? (
                  <Field label={labels.appearance.shadowBlur}>
                    <InputNumber
                      size='mini'
                      min={0}
                      max={200}
                      suffix={labels.units.pixels}
                      disabled={!editable}
                      value={blurEffect.radius}
                      onChange={(value) =>
                        value !== undefined &&
                        commitEffects(replaceStackItem(effects, { ...blurEffect, radius: value }))
                      }
                    />
                  </Field>
                ) : (
                  <>
                    <div className='grid grid-cols-4 gap-6px'>
                      {(
                        [
                          ['x', labels.appearance.shadowX],
                          ['y', labels.appearance.shadowY],
                          ['blur', labels.appearance.shadowBlur],
                          ['spread', labels.appearance.shadowSpread],
                        ] as const
                      ).map(([key, label]) => (
                        <Field key={key} label={label}>
                          <InputNumber
                            size='mini'
                            min={key === 'blur' ? 0 : -10_000}
                            max={10_000}
                            disabled={!editable}
                            value={shadowEffect[key]}
                            onChange={(value) =>
                              value !== undefined &&
                              commitEffects(replaceStackItem(effects, { ...shadowEffect, [key]: value }))
                            }
                          />
                        </Field>
                      ))}
                    </div>
                    <Field label={labels.appearance.shadowColor}>
                      <ColorPicker
                        size='small'
                        mode='single'
                        showText
                        disabled={!editable}
                        value={shadowEffect.color}
                        onChange={(value) =>
                          typeof value === 'string' &&
                          commitEffects(replaceStackItem(effects, { ...shadowEffect, color: value }))
                        }
                      />
                    </Field>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className='rd-10px border border-b-1 bg-fill-1 p-9px flex flex-col gap-9px'>
          <div className='text-11px font-750 uppercase tracking-0.08em text-t-secondary'>
            {labels.appearance.background}
          </div>
          <Field label={labels.appearance.fillType}>
            <Select
              data-testid='viu-authoring-fill-type'
              size='small'
              disabled={!editable}
              value={fillType}
              options={[
                { value: 'solid', label: labels.appearance.fillSolid },
                { value: 'linear', label: labels.appearance.fillLinear },
                { value: 'radial', label: labels.appearance.fillRadial },
              ]}
              onChange={(value) => {
                const type = value as ViuFillType;
                commitAppearance({
                  fills: undefined,
                  background:
                    type === 'solid'
                      ? gradientStart
                      : createViuGradient({ type, angle: gradientAngle, start: gradientStart, end: gradientEnd }),
                });
              }}
            />
          </Field>
          {fillType === 'solid' ? (
            <Field label={labels.appearance.fillSolid}>
              <ColorPicker
                data-testid='viu-authoring-background'
                size='small'
                mode='single'
                showText
                disabled={!editable}
                value={background ?? 'transparent'}
                onChange={(value) =>
                  typeof value === 'string' && commitAppearance({ fills: undefined, background: value })
                }
              />
            </Field>
          ) : (
            <div className='grid grid-cols-2 gap-9px'>
              <Field label={labels.appearance.fillStart}>
                <ColorPicker
                  data-testid='viu-authoring-gradient-start'
                  size='small'
                  mode='single'
                  showText
                  disabled={!editable}
                  value={gradientStart}
                  onChange={(value) =>
                    typeof value === 'string' &&
                    commitAppearance({
                      fills: undefined,
                      background: createViuGradient({
                        type: fillType,
                        angle: gradientAngle,
                        start: value,
                        end: gradientEnd,
                      }),
                    })
                  }
                />
              </Field>
              <Field label={labels.appearance.fillEnd}>
                <ColorPicker
                  data-testid='viu-authoring-gradient-end'
                  size='small'
                  mode='single'
                  showText
                  disabled={!editable}
                  value={gradientEnd}
                  onChange={(value) =>
                    typeof value === 'string' &&
                    commitAppearance({
                      fills: undefined,
                      background: createViuGradient({
                        type: fillType,
                        angle: gradientAngle,
                        start: gradientStart,
                        end: value,
                      }),
                    })
                  }
                />
              </Field>
              {fillType === 'linear' ? (
                <Field label={labels.appearance.gradientAngle}>
                  <InputNumber
                    data-testid='viu-authoring-gradient-angle'
                    size='small'
                    min={-360}
                    max={360}
                    suffix='°'
                    disabled={!editable}
                    value={gradientAngle}
                    onChange={(value) =>
                      value !== undefined &&
                      commitAppearance({
                        fills: undefined,
                        background: createViuGradient({
                          type: 'linear',
                          angle: value,
                          start: gradientStart,
                          end: gradientEnd,
                        }),
                      })
                    }
                  />
                </Field>
              ) : null}
            </div>
          )}
          <Field label={labels.appearance.cssValue}>
            <Input
              key={`${selection.nodeIds.join(':')}:${background ?? 'mixed'}`}
              data-testid='viu-authoring-background-css'
              size='small'
              disabled={!editable}
              defaultValue={background}
              placeholder={labels.mixed}
              onPressEnter={(event) => event.currentTarget.blur()}
              onBlur={(event) => {
                if (event.currentTarget.value && event.currentTarget.value !== (background ?? '')) {
                  commitAppearance({ fills: undefined, background: event.currentTarget.value });
                }
              }}
            />
          </Field>
        </div>

        <div className='rd-10px border border-b-1 bg-fill-1 p-9px flex flex-col gap-9px'>
          <div className='text-11px font-750 uppercase tracking-0.08em text-t-secondary'>
            {labels.appearance.borderStyle}
          </div>
          <div className='grid grid-cols-2 gap-9px'>
            <Field label={labels.appearance.borderStyle}>
              <Select
                data-testid='viu-authoring-border-style'
                size='small'
                disabled={!editable}
                value={borderStyle ?? (appearanceValue('borderWidth') ? 'solid' : 'none')}
                options={[
                  { value: 'none', label: labels.appearance.borderNone },
                  { value: 'solid', label: labels.appearance.borderSolid },
                  { value: 'dashed', label: labels.appearance.borderDashed },
                  { value: 'dotted', label: labels.appearance.borderDotted },
                  { value: 'double', label: labels.appearance.borderDouble },
                ]}
                onChange={(value) => commitAppearance({ borderStyle: value as ViuAuthoringNodeStyle['borderStyle'] })}
              />
            </Field>
            <Field label={labels.appearance.borderWidth}>
              <InputNumber
                data-testid='viu-authoring-border-width'
                size='small'
                min={0}
                max={10_000}
                suffix={labels.units.pixels}
                disabled={!editable}
                value={appearanceValue('borderWidth') as number | undefined}
                placeholder={labels.mixed}
                onChange={(value) => value !== undefined && commitAppearance({ borderWidth: value })}
              />
            </Field>
            <Field label={labels.appearance.borderColor}>
              <ColorPicker
                data-testid='viu-authoring-border-color'
                size='small'
                mode='single'
                showText
                disabled={!editable}
                value={borderColor ?? 'transparent'}
                onChange={(value) => typeof value === 'string' && commitAppearance({ borderColor: value })}
              />
            </Field>
            <Field label={labels.appearance.radius}>
              <InputNumber
                data-testid='viu-authoring-radius'
                size='small'
                min={0}
                max={100_000}
                suffix={labels.units.pixels}
                disabled={!editable}
                value={appearanceValue('borderRadius') as number | undefined}
                placeholder={labels.mixed}
                onChange={(value) => value !== undefined && commitAppearance({ borderRadius: value })}
              />
            </Field>
          </div>
        </div>

        <div className='rd-10px border border-b-1 bg-fill-1 p-9px flex flex-col gap-9px'>
          <div className='text-11px font-750 uppercase tracking-0.08em text-t-secondary'>
            {labels.appearance.shadow}
          </div>
          <div className='grid grid-cols-4 gap-6px'>
            {(
              [
                ['x', labels.appearance.shadowX],
                ['y', labels.appearance.shadowY],
                ['blur', labels.appearance.shadowBlur],
                ['spread', labels.appearance.shadowSpread],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <InputNumber
                  data-testid={`viu-authoring-shadow-${key}`}
                  size='small'
                  min={key === 'blur' ? 0 : -10_000}
                  max={10_000}
                  disabled={!editable}
                  value={shadowEditor[key]}
                  onChange={(value) =>
                    value !== undefined &&
                    commitAppearance({ effects: undefined, shadow: createViuShadow({ ...shadowEditor, [key]: value }) })
                  }
                />
              </Field>
            ))}
          </div>
          <Field label={labels.appearance.shadowColor}>
            <ColorPicker
              data-testid='viu-authoring-shadow-color'
              size='small'
              mode='single'
              showText
              disabled={!editable}
              value={shadowEditor.color}
              onChange={(value) =>
                typeof value === 'string' &&
                commitAppearance({ effects: undefined, shadow: createViuShadow({ ...shadowEditor, color: value }) })
              }
            />
          </Field>
          <Field label={labels.appearance.cssValue}>
            <Input
              key={`${selection.nodeIds.join(':')}:${shadow ?? 'mixed'}`}
              data-testid='viu-authoring-shadow'
              size='small'
              disabled={!editable}
              defaultValue={shadow}
              placeholder={shadow === undefined ? labels.mixed : labels.appearance.shadowPlaceholder}
              onPressEnter={(event) => event.currentTarget.blur()}
              onBlur={(event) => {
                if (event.currentTarget.value !== (shadow ?? '')) {
                  commitAppearance({ effects: undefined, shadow: event.currentTarget.value });
                }
              }}
            />
          </Field>
          <div className='grid grid-cols-2 gap-9px'>
            <Field label={labels.appearance.layerBlur}>
              <InputNumber
                data-testid='viu-authoring-layer-blur'
                size='small'
                min={0}
                max={200}
                suffix={labels.units.pixels}
                disabled={!editable}
                value={appearanceValue('blur') as number | undefined}
                placeholder={labels.mixed}
                onChange={(value) => value !== undefined && commitAppearance({ effects: undefined, blur: value })}
              />
            </Field>
            <Field label={labels.appearance.backdropBlur}>
              <InputNumber
                data-testid='viu-authoring-backdrop-blur'
                size='small'
                min={0}
                max={200}
                suffix={labels.units.pixels}
                disabled={!editable}
                value={appearanceValue('backdropBlur') as number | undefined}
                placeholder={labels.mixed}
                onChange={(value) =>
                  value !== undefined && commitAppearance({ effects: undefined, backdropBlur: value })
                }
              />
            </Field>
          </div>
        </div>

        <Field label={labels.appearance.overflow}>
          <Select
            data-testid='viu-authoring-overflow'
            size='small'
            disabled={!editable}
            value={overflow}
            placeholder={labels.mixed}
            options={[
              { value: 'visible', label: labels.appearance.overflowVisible },
              { value: 'hidden', label: labels.appearance.overflowHidden },
              { value: 'scroll', label: labels.appearance.overflowScroll },
            ]}
            onChange={(value) => commitAppearance({ overflow: value as 'visible' | 'hidden' | 'scroll' })}
          />
        </Field>
      </Section>

      {labels.quality ? (
        <Section title={labels.quality.section} icon={<Shield size={15} />}>
          <div className='flex items-center justify-between gap-8px'>
            <span className='text-12px text-t-secondary'>{labels.quality.issueCount(qualityDiagnostics.length)}</span>
            <Tag size='small'>{qualityDiagnostics.length}</Tag>
          </div>
          {qualityDiagnostics.length === 0 ? (
            <div
              data-testid='viu-quality-empty'
              className='rd-10px bg-fill-1 px-10px py-12px text-12px text-t-tertiary'
            >
              {labels.quality.noIssues}
            </div>
          ) : (
            <div data-testid='viu-quality-diagnostics' className='flex flex-col gap-7px'>
              {qualityDiagnostics.map((item) => (
                <div
                  key={`${item.code}:${item.entityId ?? item.flowId ?? 'project'}`}
                  data-severity={item.severity}
                  className='rd-10px border border-b-1 bg-fill-1 px-10px py-9px flex items-start gap-8px'
                >
                  <Tag size='small'>{item.severity === 'error' ? labels.quality.error : labels.quality.warning}</Tag>
                  <span className='min-w-0 flex-1 text-12px leading-18px text-t-secondary'>
                    {labels.quality.issue(item.code, item.entityId)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      ) : null}
    </aside>
  );
};

export default AuthoringInspector;
