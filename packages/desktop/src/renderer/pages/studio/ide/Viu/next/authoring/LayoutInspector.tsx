/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, InputNumber, Select, Switch, Tooltip } from '@arco-design/web-react';
import { Add, Delete, TreeList } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import {
  createBreakpointViuBatch,
  createGuidesViuBatch,
  createLayoutViuBatch,
  createResponsiveViuBatch,
  createSnapSettingsViuBatch,
  createVariableBindingViuBatch,
  createVariableModeViuBatch,
  type ViuAuthoringBatch,
  type ViuLayoutPatch,
  type ViuSelection,
} from '@/common/viu/authoring';
import type { ViuProjectState } from '@/common/viu';
import { getViuRotation, isViuVariable, resolveViuNode } from '@/common/viu/runtime/designSystem';
import type { ViuLayoutInspectorLabels } from './types';

type LayoutInspectorProps = {
  project: ViuProjectState;
  selection: ViuSelection;
  labels: ViuLayoutInspectorLabels;
  disabled?: boolean;
  onCommit: (patch: ViuAuthoringBatch) => void;
};

type FieldProps = { label: string; children: React.ReactNode };
const Field: React.FC<FieldProps> = ({ label, children }) => (
  <label className='flex flex-col gap-6px text-12px font-600 text-t-secondary'>
    <span>{label}</span>
    {children}
  </label>
);

/** Auto-layout, sizing and responsive-constraint authoring for VIU containers and children. */
const LayoutInspector: React.FC<LayoutInspectorProps> = ({
  project,
  selection,
  labels,
  disabled = false,
  onCommit,
}) => {
  const node = useMemo(
    () => selection.nodeIds.map((nodeId) => project.nodes[nodeId]).find(Boolean) ?? null,
    [project.nodes, selection.nodeIds]
  );
  const [breakpointId, setBreakpointId] = useState<string>('base');
  if (!node) return null;

  const layout = node.layout ?? {
    mode: 'none' as const,
    gap: 0,
    padding: [0, 0, 0, 0] as [number, number, number, number],
    align: 'start' as const,
    justify: 'start' as const,
    wrap: false,
    columns: 2,
  };
  const editable = !disabled && !node.locked;
  const commit = (patch: ViuLayoutPatch): void => onCommit(createLayoutViuBatch(project, selection, patch));
  const updatePadding = (index: number, value: number): void => {
    const padding: [number, number, number, number] = [...layout.padding];
    padding[index] = value;
    commit({ layout: { padding } });
  };
  const sizingOptions = [
    { value: 'fixed', label: labels.fixed },
    { value: 'fill', label: labels.fill },
    { value: 'hug', label: labels.hug },
  ];
  const collections = Object.values(project.variableCollections ?? {}).toSorted((left, right) =>
    left.name.localeCompare(right.name)
  );
  const variables = Object.values(project.variables).filter(isViuVariable);
  const colorVariables = variables
    .filter((variable) => variable.type === 'color')
    .map((variable) => ({ value: variable.id, label: variable.name }));
  const numberVariables = variables
    .filter((variable) => variable.type === 'number')
    .map((variable) => ({ value: variable.id, label: variable.name }));
  const breakpoints = Object.values(project.breakpoints ?? {}).toSorted(
    (left, right) => right.minWidth - left.minWidth || left.id.localeCompare(right.id)
  );
  const activeBreakpoint = breakpointId === 'base' ? undefined : project.breakpoints?.[breakpointId];
  const responsive = activeBreakpoint ? node.responsiveOverrides?.[activeBreakpoint.id] : undefined;
  const viewportWidth = activeBreakpoint
    ? activeBreakpoint.minWidth
    : (Object.values(project.screens).find((screen) => screen.rootNodeId === node.id)?.viewport.width ?? 1440);
  let resolved: ReturnType<typeof resolveViuNode> | null = null;
  try {
    resolved = resolveViuNode(project, node.id, viewportWidth);
  } catch {
    resolved = null;
  }
  const noVariable = '__viu-no-variable__';
  const bind = (property: 'style.background' | 'layout.gap', variableId: string): void =>
    onCommit(
      createVariableBindingViuBatch(project, selection, property, variableId === noVariable ? null : { variableId })
    );
  const updateResponsiveSize = (key: 'width' | 'height', value: number): void => {
    if (!activeBreakpoint) return;
    onCommit(
      createResponsiveViuBatch(project, selection, activeBreakpoint.id, {
        size: { [key]: value },
      })
    );
  };
  const updateBreakpointWidth = (key: 'minWidth' | 'maxWidth', value: number | undefined): void => {
    if (!activeBreakpoint || (key === 'minWidth' && value === undefined)) return;
    onCommit(
      createBreakpointViuBatch({
        ...activeBreakpoint,
        [key]: value,
      })
    );
  };
  const snapSettings = {
    enabled: project.snapSettings?.enabled ?? true,
    pixelGrid: project.snapSettings?.pixelGrid ?? 1,
    threshold: project.snapSettings?.threshold ?? 6,
    snapToGuides: project.snapSettings?.snapToGuides ?? true,
    snapToObjects: project.snapSettings?.snapToObjects ?? true,
  };
  const updateSnapSettings = (patch: Partial<typeof snapSettings>): void =>
    onCommit(createSnapSettingsViuBatch({ ...snapSettings, ...patch }));
  const updateGuide = (guideId: string, position: number): void =>
    onCommit(
      createGuidesViuBatch(
        (project.guides ?? []).map((guide) => (guide.id === guideId ? { ...guide, position } : guide))
      )
    );
  const removeGuide = (guideId: string): void =>
    onCommit(createGuidesViuBatch((project.guides ?? []).filter((guide) => guide.id !== guideId)));
  const addGuide = (axis: 'horizontal' | 'vertical'): void => {
    const existing = new Set((project.guides ?? []).map((guide) => guide.id));
    let sequence = existing.size + 1;
    while (existing.has(`guide-${axis}-${sequence}`)) sequence += 1;
    const screen = Object.values(project.screens).find((item) => item.rootNodeId === node.id);
    const position =
      axis === 'vertical' ? (screen?.viewport.width ?? viewportWidth) / 2 : (screen?.viewport.height ?? 900) / 2;
    onCommit(createGuidesViuBatch([...(project.guides ?? []), { id: `guide-${axis}-${sequence}`, axis, position }]));
  };

  return (
    <section data-testid='viu-layout-inspector' className='rd-12px border border-b-1 bg-bg-2 overflow-hidden'>
      <div className='h-38px px-11px flex items-center gap-7px border-b border-b-1 bg-fill-1 text-12px font-700 text-t-primary'>
        <span className='text-primary flex items-center'>
          <TreeList size={15} />
        </span>
        <span>{labels.section}</span>
      </div>
      <div className='p-11px flex flex-col gap-11px'>
        <div className='pt-1px text-11px font-750 uppercase tracking-0.08em text-t-tertiary'>{labels.designSystem}</div>
        {collections.map((collection) => (
          <Field key={collection.id} label={`${collection.name} · ${labels.activeMode}`}>
            <Select
              data-testid={`viu-variable-mode-${collection.id}`}
              size='small'
              disabled={!editable}
              value={project.activeVariableModes?.[collection.id] ?? collection.defaultModeId}
              options={collection.modeIds.map((modeId) => ({
                value: modeId,
                label: collection.modes[modeId]?.name ?? modeId,
              }))}
              onChange={(modeId) => onCommit(createVariableModeViuBatch(project, collection.id, modeId))}
            />
          </Field>
        ))}
        <div className='grid grid-cols-2 gap-9px'>
          <Field label={labels.backgroundToken}>
            <Select
              data-testid='viu-variable-background'
              size='small'
              disabled={!editable}
              value={node.variableBindings?.['style.background']?.variableId ?? noVariable}
              options={[{ value: noVariable, label: labels.noVariable }, ...colorVariables]}
              onChange={(variableId) => bind('style.background', variableId)}
            />
          </Field>
          <Field label={labels.gapToken}>
            <Select
              data-testid='viu-variable-gap'
              size='small'
              disabled={!editable}
              value={node.variableBindings?.['layout.gap']?.variableId ?? noVariable}
              options={[{ value: noVariable, label: labels.noVariable }, ...numberVariables]}
              onChange={(variableId) => bind('layout.gap', variableId)}
            />
          </Field>
        </div>

        <div className='pt-1px text-11px font-750 uppercase tracking-0.08em text-t-tertiary'>{labels.responsive}</div>
        <Field label={labels.breakpoint}>
          <Select
            data-testid='viu-layout-breakpoint'
            size='small'
            value={breakpointId}
            options={[
              { value: 'base', label: labels.base },
              ...breakpoints.map((breakpoint) => ({ value: breakpoint.id, label: breakpoint.name })),
            ]}
            onChange={setBreakpointId}
          />
        </Field>
        {activeBreakpoint ? (
          <>
            <div className='grid grid-cols-2 gap-9px'>
              <Field label={labels.minWidth}>
                <InputNumber
                  data-testid='viu-breakpoint-min-width'
                  size='small'
                  min={0}
                  max={1_000_000}
                  disabled={!editable}
                  value={activeBreakpoint.minWidth}
                  onChange={(value) => updateBreakpointWidth('minWidth', value)}
                />
              </Field>
              <Field label={labels.maxWidth}>
                <InputNumber
                  data-testid='viu-breakpoint-max-width'
                  size='small'
                  min={activeBreakpoint.minWidth}
                  max={1_000_000}
                  disabled={!editable}
                  value={activeBreakpoint.maxWidth}
                  onChange={(value) => updateBreakpointWidth('maxWidth', value)}
                />
              </Field>
              <Field label={labels.width}>
                <InputNumber
                  data-testid='viu-responsive-width'
                  size='small'
                  min={0}
                  max={1_000_000}
                  disabled={!editable}
                  value={responsive?.size?.width ?? node.size.width}
                  onChange={(value) => value !== undefined && updateResponsiveSize('width', value)}
                />
              </Field>
              <Field label={labels.height}>
                <InputNumber
                  data-testid='viu-responsive-height'
                  size='small'
                  min={0}
                  max={1_000_000}
                  disabled={!editable}
                  value={responsive?.size?.height ?? node.size.height}
                  onChange={(value) => value !== undefined && updateResponsiveSize('height', value)}
                />
              </Field>
            </div>
            <div className='flex items-center justify-between rd-7px border border-b-1 bg-fill-1 px-8px py-6px'>
              <span className='text-12px font-600 text-t-secondary'>{labels.responsiveVisible}</span>
              <Switch
                data-testid='viu-responsive-visible'
                size='small'
                disabled={!editable}
                checked={responsive?.visible ?? node.visible}
                onChange={(visible) =>
                  onCommit(createResponsiveViuBatch(project, selection, activeBreakpoint.id, { visible }))
                }
              />
            </div>
          </>
        ) : null}
        <div
          data-testid='viu-computed-source'
          className='rd-7px border border-b-1 bg-fill-1 px-8px py-6px text-11px text-t-secondary'
        >
          {labels.computed}: {resolved?.breakpoint?.name ?? labels.base} · {resolved?.properties.length ?? 0}
        </div>

        <div className='grid grid-cols-2 gap-9px'>
          <Field label={labels.rotation}>
            <InputNumber
              data-testid='viu-layout-rotation'
              size='small'
              min={-360_000}
              max={360_000}
              disabled={!editable}
              value={getViuRotation(node.localTransform)}
              onChange={(value) => value !== undefined && commit({ rotation: value })}
            />
          </Field>
          <Field label={labels.strokeAlignment}>
            <Select
              data-testid='viu-stroke-alignment'
              size='small'
              disabled={!editable}
              value={node.style.strokeAlignment ?? 'inside'}
              options={[
                { value: 'inside', label: labels.strokeInside },
                { value: 'center', label: labels.strokeCenter },
                { value: 'outside', label: labels.strokeOutside },
              ]}
              onChange={(value) => commit({ strokeAlignment: value as 'inside' | 'center' | 'outside' })}
            />
          </Field>
        </div>
        <Field label={labels.cornerRadii}>
          <div className='grid grid-cols-4 gap-5px'>
            {(
              node.style.borderRadii ?? [
                node.style.borderRadius ?? 0,
                node.style.borderRadius ?? 0,
                node.style.borderRadius ?? 0,
                node.style.borderRadius ?? 0,
              ]
            ).map((radius, index, radii) => (
              <InputNumber
                key={index}
                data-testid={`viu-corner-radius-${index}`}
                size='small'
                min={0}
                max={1_000_000}
                disabled={!editable}
                value={radius}
                onChange={(value) => {
                  if (value === undefined) return;
                  const next = [...radii] as [number, number, number, number];
                  next[index] = value;
                  commit({ borderRadii: next });
                }}
              />
            ))}
          </div>
        </Field>
        <div className='flex flex-col gap-8px rd-7px border border-b-1 bg-fill-1 px-8px py-7px'>
          <div className='flex items-center justify-between'>
            <div className='min-w-0'>
              <div className='text-12px font-650 text-t-primary'>{labels.snapping}</div>
              <div className='text-11px text-t-tertiary'>{labels.guideCount(project.guides?.length ?? 0)}</div>
            </div>
            <Switch
              data-testid='viu-snapping-enabled'
              size='small'
              disabled={!editable}
              checked={snapSettings.enabled}
              onChange={(enabled) => updateSnapSettings({ enabled })}
            />
          </div>
          <div className='grid grid-cols-2 gap-7px'>
            <Field label={labels.pixelGrid}>
              <InputNumber
                data-testid='viu-snap-grid'
                size='small'
                min={0}
                max={10_000}
                disabled={!editable}
                value={snapSettings.pixelGrid}
                onChange={(pixelGrid) => pixelGrid !== undefined && updateSnapSettings({ pixelGrid })}
              />
            </Field>
            <Field label={labels.snapThreshold}>
              <InputNumber
                data-testid='viu-snap-threshold'
                size='small'
                min={0}
                max={10_000}
                disabled={!editable}
                value={snapSettings.threshold}
                onChange={(threshold) => threshold !== undefined && updateSnapSettings({ threshold })}
              />
            </Field>
          </div>
          <div className='grid grid-cols-2 gap-7px'>
            <div className='flex items-center justify-between text-11px text-t-secondary'>
              <span>{labels.snapToGuides}</span>
              <Switch
                data-testid='viu-snap-guides'
                size='small'
                disabled={!editable}
                checked={snapSettings.snapToGuides}
                onChange={(snapToGuides) => updateSnapSettings({ snapToGuides })}
              />
            </div>
            <div className='flex items-center justify-between text-11px text-t-secondary'>
              <span>{labels.snapToObjects}</span>
              <Switch
                data-testid='viu-snap-objects'
                size='small'
                disabled={!editable}
                checked={snapSettings.snapToObjects}
                onChange={(snapToObjects) => updateSnapSettings({ snapToObjects })}
              />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-7px'>
            <Button
              data-testid='viu-add-horizontal-guide'
              size='mini'
              type='secondary'
              disabled={!editable}
              icon={<Add />}
              onClick={() => addGuide('horizontal')}
            >
              {labels.addHorizontalGuide}
            </Button>
            <Button
              data-testid='viu-add-vertical-guide'
              size='mini'
              type='secondary'
              disabled={!editable}
              icon={<Add />}
              onClick={() => addGuide('vertical')}
            >
              {labels.addVerticalGuide}
            </Button>
          </div>
          {(project.guides ?? []).map((guide, index) => (
            <div key={guide.id} className='grid grid-cols-[1fr_auto] gap-6px items-end'>
              <Field label={`${guide.axis === 'horizontal' ? labels.horizontal : labels.vertical} ${index + 1}`}>
                <InputNumber
                  data-testid={`viu-guide-position-${guide.id}`}
                  size='small'
                  disabled={!editable || guide.locked}
                  value={guide.position}
                  onChange={(position) => position !== undefined && updateGuide(guide.id, position)}
                />
              </Field>
              <Tooltip content={labels.removeGuide}>
                <Button
                  data-testid={`viu-remove-guide-${guide.id}`}
                  size='mini'
                  status='danger'
                  disabled={!editable || guide.locked}
                  aria-label={labels.removeGuide}
                  icon={<Delete />}
                  onClick={() => removeGuide(guide.id)}
                />
              </Tooltip>
            </div>
          ))}
        </div>

        <Field label={labels.mode}>
          <Select
            data-testid='viu-layout-mode'
            size='small'
            disabled={!editable}
            value={layout.mode}
            options={[
              { value: 'none', label: labels.none },
              { value: 'horizontal', label: labels.horizontal },
              { value: 'vertical', label: labels.vertical },
              { value: 'grid', label: labels.grid },
            ]}
            onChange={(value) => commit({ layout: { mode: value as 'none' | 'horizontal' | 'vertical' | 'grid' } })}
          />
        </Field>

        {layout.mode !== 'none' ? (
          <>
            <div className='grid grid-cols-2 gap-9px'>
              <Field label={labels.gap}>
                <InputNumber
                  data-testid='viu-layout-gap'
                  size='small'
                  min={0}
                  max={100_000}
                  disabled={!editable}
                  value={layout.gap}
                  onChange={(value) => value !== undefined && commit({ layout: { gap: value } })}
                />
              </Field>
              {layout.mode === 'grid' ? (
                <Field label={labels.columns}>
                  <InputNumber
                    data-testid='viu-layout-columns'
                    size='small'
                    min={1}
                    max={64}
                    disabled={!editable}
                    value={layout.columns ?? 2}
                    onChange={(value) => value !== undefined && commit({ layout: { columns: value } })}
                  />
                </Field>
              ) : (
                <Field label={labels.wrap}>
                  <div className='h-32px flex items-center'>
                    <Switch
                      data-testid='viu-layout-wrap'
                      size='small'
                      disabled={!editable}
                      checked={layout.wrap ?? false}
                      onChange={(wrap) => commit({ layout: { wrap } })}
                    />
                  </div>
                </Field>
              )}
            </div>

            <Field label={labels.padding}>
              <div className='grid grid-cols-4 gap-5px'>
                {[labels.top, labels.right, labels.bottom, labels.left].map((label, index) => (
                  <InputNumber
                    key={label}
                    data-testid={`viu-layout-padding-${index}`}
                    size='small'
                    min={0}
                    max={100_000}
                    disabled={!editable}
                    value={layout.padding[index]}
                    prefix={label.slice(0, 1)}
                    onChange={(value) => value !== undefined && updatePadding(index, value)}
                  />
                ))}
              </div>
            </Field>

            <div className='grid grid-cols-2 gap-9px'>
              <Field label={labels.alignment}>
                <Select
                  data-testid='viu-layout-align'
                  size='small'
                  disabled={!editable}
                  value={layout.align}
                  options={[
                    { value: 'start', label: labels.start },
                    { value: 'center', label: labels.center },
                    { value: 'end', label: labels.end },
                    { value: 'stretch', label: labels.stretch },
                  ]}
                  onChange={(value) => commit({ layout: { align: value as typeof layout.align } })}
                />
              </Field>
              <Field label={labels.distribution}>
                <Select
                  data-testid='viu-layout-justify'
                  size='small'
                  disabled={!editable}
                  value={layout.justify}
                  options={[
                    { value: 'start', label: labels.start },
                    { value: 'center', label: labels.center },
                    { value: 'end', label: labels.end },
                    { value: 'space-between', label: labels.spaceBetween },
                  ]}
                  onChange={(value) => commit({ layout: { justify: value as typeof layout.justify } })}
                />
              </Field>
            </div>
          </>
        ) : null}

        <div className='pt-2px text-11px font-750 uppercase tracking-0.08em text-t-tertiary'>{labels.childSizing}</div>
        <Field label={labels.position}>
          <Select
            data-testid='viu-layout-position'
            size='small'
            disabled={!editable}
            value={node.positionMode}
            options={[
              { value: 'flow', label: labels.flow },
              { value: 'absolute', label: labels.absolute },
            ]}
            onChange={(value) => commit({ positionMode: value as 'flow' | 'absolute' })}
          />
        </Field>
        <div className='grid grid-cols-2 gap-9px'>
          <Field label={labels.width}>
            <Select
              data-testid='viu-layout-width-sizing'
              size='small'
              disabled={!editable}
              value={node.sizing.horizontal}
              options={sizingOptions}
              onChange={(value) => commit({ sizing: { horizontal: value as 'fixed' | 'fill' | 'hug' } })}
            />
          </Field>
          <Field label={labels.height}>
            <Select
              data-testid='viu-layout-height-sizing'
              size='small'
              disabled={!editable}
              value={node.sizing.vertical}
              options={sizingOptions}
              onChange={(value) => commit({ sizing: { vertical: value as 'fixed' | 'fill' | 'hug' } })}
            />
          </Field>
          {[
            ['minWidth', labels.minWidth, node.sizing.minWidth],
            ['maxWidth', labels.maxWidth, node.sizing.maxWidth],
            ['minHeight', labels.minHeight, node.sizing.minHeight],
            ['maxHeight', labels.maxHeight, node.sizing.maxHeight],
          ].map(([key, label, value]) => (
            <Field key={String(key)} label={String(label)}>
              <InputNumber
                data-testid={`viu-layout-${String(key)}`}
                size='small'
                min={0}
                max={1_000_000}
                disabled={!editable}
                value={value as number | undefined}
                onChange={(nextValue) => nextValue !== undefined && commit({ sizing: { [key as string]: nextValue } })}
              />
            </Field>
          ))}
        </div>

        <div className='pt-2px text-11px font-750 uppercase tracking-0.08em text-t-tertiary'>{labels.constraints}</div>
        <div className='grid grid-cols-2 gap-9px'>
          <Field label={labels.horizontal}>
            <Select
              data-testid='viu-layout-horizontal-constraint'
              size='small'
              disabled={!editable}
              value={node.constraints.horizontal}
              options={[
                { value: 'left', label: labels.left },
                { value: 'right', label: labels.right },
                { value: 'center', label: labels.center },
                { value: 'stretch', label: labels.stretch },
                { value: 'scale', label: labels.fill },
              ]}
              onChange={(value) => commit({ constraints: { horizontal: value as typeof node.constraints.horizontal } })}
            />
          </Field>
          <Field label={labels.vertical}>
            <Select
              data-testid='viu-layout-vertical-constraint'
              size='small'
              disabled={!editable}
              value={node.constraints.vertical}
              options={[
                { value: 'top', label: labels.top },
                { value: 'bottom', label: labels.bottom },
                { value: 'center', label: labels.center },
                { value: 'stretch', label: labels.stretch },
                { value: 'scale', label: labels.fill },
              ]}
              onChange={(value) => commit({ constraints: { vertical: value as typeof node.constraints.vertical } })}
            />
          </Field>
        </div>
      </div>
    </section>
  );
};

export default LayoutInspector;
