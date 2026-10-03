/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Alert, Button, Empty, Input, InputNumber, Select, Switch, Tag } from '@arco-design/web-react';
import { AddOne, Attention, Branch, Delete, Down, Up } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import {
  createDeleteInteractionViuBatch,
  createDeleteScrollBindingViuBatch,
  createDeleteTimelineViuBatch,
  createInteractionViuBatch,
  createTimelineViuBatch,
  createUpdateInteractionViuBatch,
  createUpdateTimelineViuBatch,
  createUpsertScrollBindingViuBatch,
  type ViuAuthoringBatch,
  type ViuSelection,
} from '@/common/viu/authoring';
import {
  validateViuProject,
  type ViuInteraction,
  type ViuInteractionAction,
  type ViuInteractionTransition,
  type ViuInteractionTrigger,
  type ViuProjectState,
  type ViuScrollBinding,
  type ViuTimeline,
  type ViuTimelineTrack,
} from '@/common/viu';
import type { ViuPrototypeInspectorLabels } from '@package-apps/design/renderer/viu/next/authoring/types';

const ACTION_TYPES = [
  'navigate',
  'openOverlay',
  'closeOverlay',
  'back',
  'scrollTo',
  'setVariable',
  'toggleVariable',
  'playTimeline',
  'pauseTimeline',
  'seekTimeline',
] as const;
type PrototypeActionType = (typeof ACTION_TYPES)[number];
const TARGETLESS_ACTIONS = new Set<PrototypeActionType>(['closeOverlay', 'back']);

let interactionSequence = 0;
let motionSequence = 0;
const nextInteractionId = (): string => {
  interactionSequence += 1;
  return `interaction-${Date.now()}-${interactionSequence}`;
};
const nextMotionId = (prefix: 'timeline' | 'track' | 'keyframe' | 'scroll'): string => {
  motionSequence += 1;
  return `${prefix}-${Date.now()}-${motionSequence}`;
};

const NO_TIMELINE = '__none__';

const DEFAULT_TRANSITION: ViuInteractionTransition = {
  preset: 'fade',
  durationMs: 280,
  easing: 'ease-out',
};

const nodeToScreenMap = (project: ViuProjectState): Map<string, string> => {
  const result = new Map<string, string>();
  for (const screen of Object.values(project.screens)) {
    const pending = [screen.rootNodeId];
    while (pending.length > 0) {
      const nodeId = pending.pop();
      if (!nodeId || result.has(nodeId)) continue;
      result.set(nodeId, screen.id);
      pending.push(...(project.nodes[nodeId]?.childIds ?? []));
    }
  }
  return result;
};

const actionType = (action: ViuInteractionAction): PrototypeActionType => action.type;

const actionTarget = (action: ViuInteractionAction): string => {
  if (action.type === 'navigate') return action.targetScreenId;
  if (action.type === 'openOverlay' || action.type === 'scrollTo') return action.targetNodeId;
  if (action.type === 'setVariable' || action.type === 'toggleVariable') return action.variableId;
  if (action.type === 'playTimeline' || action.type === 'pauseTimeline' || action.type === 'seekTimeline') {
    return action.timelineId;
  }
  return '';
};

const defaultVariableValue = (project: ViuProjectState, variableId: string): unknown => {
  const variable = project.variables[variableId];
  if (!variable) return '';
  if (variable.type === 'boolean') return false;
  if (variable.type === 'number') return 0;
  return '';
};

const createAction = (project: ViuProjectState, type: PrototypeActionType, targetId: string): ViuInteractionAction => {
  if (type === 'navigate') return { type, targetScreenId: targetId };
  if (type === 'openOverlay' || type === 'scrollTo') return { type, targetNodeId: targetId };
  if (type === 'closeOverlay' || type === 'back') return { type };
  if (type === 'setVariable') return { type, variableId: targetId, value: defaultVariableValue(project, targetId) };
  if (type === 'toggleVariable') return { type, variableId: targetId };
  if (type === 'seekTimeline') return { type, timelineId: targetId, offsetMs: 0 };
  return { type, timelineId: targetId };
};

const transitionOf = (interaction: ViuInteraction): ViuInteractionTransition =>
  interaction.transition ?? DEFAULT_TRANSITION;

type PrototypeInspectorProps = {
  project: ViuProjectState;
  selection: ViuSelection;
  labels: ViuPrototypeInspectorLabels;
  disabled?: boolean;
  onCommit: (batch: ViuAuthoringBatch) => void;
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className='min-w-0 flex flex-col gap-5px text-11px font-650 text-t-secondary'>
    <span className='truncate'>{label}</span>
    {children}
  </label>
);

/** Transaction-only prototype binding editor for navigation, overlays, scrolling, and motion. */
const PrototypeInspector: React.FC<PrototypeInspectorProps> = ({
  project,
  selection,
  labels,
  disabled = false,
  onCommit,
}) => {
  const [draftTrigger, setDraftTrigger] = useState<ViuInteractionTrigger>('click');
  const [draftActionType, setDraftActionType] = useState<PrototypeActionType>('navigate');
  const [draftTargetId, setDraftTargetId] = useState('');
  const [draftTransition, setDraftTransition] = useState<ViuInteractionTransition>(DEFAULT_TRANSITION);

  const selectedNode = selection.nodeIds.length === 1 ? project.nodes[selection.nodeIds[0]!] : undefined;
  const nodeToScreen = useMemo(() => nodeToScreenMap(project), [project]);
  const selectedScreenId = selectedNode ? nodeToScreen.get(selectedNode.id) : undefined;
  const flows = Object.values(project.flows).toSorted((left, right) => left.name.localeCompare(right.name));
  const defaultFlow =
    flows.find(
      (flow) =>
        flow.startScreenId === selectedScreenId ||
        (selectedScreenId && flow.requiredScreenIds.includes(selectedScreenId))
    ) ?? flows[0];
  const bindings = selectedNode
    ? Object.values(project.interactions)
        .filter((interaction) => interaction.sourceNodeId === selectedNode.id)
        .toSorted((left, right) => left.id.localeCompare(right.id))
    : [];
  const screenOptions = Object.values(project.screens)
    .map((screen) => ({ value: screen.id, label: `${screen.name} · ${screen.route}` }))
    .toSorted((left, right) => left.label.localeCompare(right.label));
  const nodeOptions = Object.values(project.nodes)
    .filter((node) => node.parentId !== null)
    .map((node) => {
      const screen = project.screens[nodeToScreen.get(node.id) ?? ''];
      return { value: node.id, label: `${node.name}${screen ? ` · ${screen.name}` : ''}` };
    })
    .toSorted((left, right) => left.label.localeCompare(right.label));
  const currentScreenNodes = nodeOptions.filter((option) => nodeToScreen.get(option.value) === selectedScreenId);
  const variableOptions = Object.values(project.variables)
    .map((variable) => ({ value: variable.id, label: variable.name }))
    .toSorted((left, right) => left.label.localeCompare(right.label));
  const timelineOptions = Object.values(project.timelines)
    .map((timeline) => ({ value: timeline.id, label: timeline.name }))
    .toSorted((left, right) => left.label.localeCompare(right.label));
  const optionsFor = (type: PrototypeActionType): Array<{ value: string; label: string }> => {
    if (type === 'navigate') return screenOptions;
    if (type === 'scrollTo') return currentScreenNodes;
    if (type === 'openOverlay') return nodeOptions;
    if (type === 'setVariable' || type === 'toggleVariable') return variableOptions;
    if (type === 'playTimeline' || type === 'pauseTimeline' || type === 'seekTimeline') return timelineOptions;
    return [];
  };
  const draftTarget = draftTargetId || optionsFor(draftActionType)[0]?.value || '';
  const warnings = validateViuProject(project).filter(
    (diagnostic) => diagnostic.code === 'orphan-screen' || diagnostic.code === 'unreachable-required-screen'
  );
  const disconnectedScreenNames = [
    ...new Set(
      warnings
        .map((warning) => (warning.entityId ? project.screens[warning.entityId]?.name : undefined))
        .filter((name): name is string => Boolean(name))
    ),
  ];

  const triggerOptions = [
    { value: 'click', label: labels.click },
    { value: 'hover', label: labels.hover },
    { value: 'focus', label: labels.focus },
    { value: 'submit', label: labels.submit },
    { value: 'scroll', label: labels.scroll },
    { value: 'load', label: labels.load },
  ];
  const actionOptions = [
    { value: 'navigate', label: labels.navigate },
    { value: 'openOverlay', label: labels.openOverlay },
    { value: 'closeOverlay', label: labels.closeOverlay },
    { value: 'back', label: labels.back },
    { value: 'scrollTo', label: labels.scrollTo },
    { value: 'setVariable', label: labels.setVariable },
    { value: 'toggleVariable', label: labels.toggleVariable },
    { value: 'playTimeline', label: labels.playTimeline },
    { value: 'pauseTimeline', label: labels.pauseTimeline },
    { value: 'seekTimeline', label: labels.seekTimeline },
  ];
  const presetOptions = [
    { value: 'none', label: labels.presetNone },
    { value: 'fade', label: labels.presetFade },
    { value: 'rise', label: labels.presetRise },
    { value: 'scale', label: labels.presetScale },
    { value: 'slide-left', label: labels.presetSlideLeft },
    { value: 'slide-right', label: labels.presetSlideRight },
    { value: 'blur-in', label: labels.presetBlur },
    { value: 'reveal', label: labels.presetReveal },
    { value: 'smart-animate', label: labels.presetSmartAnimate },
  ];
  const easingOptions = [
    { value: 'linear', label: labels.easingLinear },
    { value: 'ease', label: labels.easingEase },
    { value: 'ease-in', label: labels.easingIn },
    { value: 'ease-out', label: labels.easingOut },
    { value: 'ease-in-out', label: labels.easingInOut },
    { value: 'spring-soft', label: labels.easingSpring },
  ];

  const timelines = Object.values(project.timelines).toSorted((left, right) => left.name.localeCompare(right.name));
  const scrollBindings = Object.values(project.scrollBindings ?? {}).toSorted((left, right) =>
    left.id.localeCompare(right.id)
  );
  const propertyOptions: Array<{ value: ViuTimelineTrack['property']; label: string }> = [
    { value: 'x', label: labels.x },
    { value: 'y', label: labels.y },
    { value: 'opacity', label: labels.opacity },
    { value: 'scale', label: labels.scale },
    { value: 'rotate', label: labels.rotate },
    { value: 'blur', label: labels.blur },
  ];
  const scrollTimelineOptions = [{ value: NO_TIMELINE, label: labels.noTimeline }, ...timelineOptions];

  const updateTimeline = (timeline: ViuTimeline, patch: Parameters<typeof createUpdateTimelineViuBatch>[2]): void =>
    onCommit(createUpdateTimelineViuBatch(project, timeline.id, patch));

  const updateTimelineTrack = (timeline: ViuTimeline, trackIndex: number, patch: Partial<ViuTimelineTrack>): void => {
    const tracks = [...(timeline.tracks ?? [])];
    tracks[trackIndex] = { ...tracks[trackIndex]!, ...patch };
    updateTimeline(timeline, { tracks });
  };

  const updateScrollBinding = (binding: ViuScrollBinding, patch: Partial<ViuScrollBinding>): void =>
    onCommit(createUpsertScrollBindingViuBatch(project, { ...binding, ...patch, id: binding.id }));

  const isTimelineReferenced = (timelineId: string): boolean =>
    Object.values(project.interactions).some((interaction) =>
      (interaction.actions?.length ? interaction.actions : [interaction.action]).some(
        (action) =>
          (action.type === 'playTimeline' || action.type === 'pauseTimeline' || action.type === 'seekTimeline') &&
          action.timelineId === timelineId
      )
    ) || scrollBindings.some((binding) => binding.timelineId === timelineId);

  const updateInteraction = (
    interaction: ViuInteraction,
    patch: Parameters<typeof createUpdateInteractionViuBatch>[2]
  ) => onCommit(createUpdateInteractionViuBatch(project, interaction.id, patch));

  const orderedActions = (interaction: ViuInteraction): ViuInteractionAction[] =>
    interaction.actions?.length ? [...interaction.actions] : [interaction.action];

  const updateActions = (interaction: ViuInteraction, actions: ViuInteractionAction[]): void => {
    const nextActions = actions.length > 0 ? actions : [interaction.action];
    updateInteraction(interaction, { action: nextActions[0]!, actions: nextActions });
  };

  return (
    <section className='rd-12px border border-b-1 bg-bg-2 overflow-hidden' data-testid='viu-prototype-inspector'>
      <div className='h-40px px-11px flex items-center gap-8px border-b border-b-1 bg-fill-1'>
        <span className='text-primary flex items-center'>
          <Branch size={16} />
        </span>
        <span className='min-w-0 flex-1 truncate text-12px font-750 text-t-primary'>{labels.section}</span>
        <Tag size='small'>{bindings.length}</Tag>
      </div>

      <div className='p-11px flex flex-col gap-11px'>
        {disconnectedScreenNames.length > 0 ? (
          <Alert
            type='warning'
            showIcon
            icon={<Attention size={14} />}
            content={labels.disconnectedScreens(disconnectedScreenNames.length)}
            title={disconnectedScreenNames.join(', ')}
          />
        ) : null}

        {!selectedNode ? <Empty description={labels.noSelection} className='py-8px' /> : null}
        {selectedNode && !defaultFlow ? <Alert type='warning' showIcon content={labels.noFlow} /> : null}

        {bindings.map((interaction, index) => {
          const actions = orderedActions(interaction);
          const transition = transitionOf(interaction);
          const conditionVariable = interaction.condition
            ? project.variables[interaction.condition.variableId]
            : undefined;
          return (
            <div
              key={interaction.id}
              className='rd-10px border border-b-1 bg-fill-1 p-9px flex flex-col gap-9px'
              data-testid={`viu-prototype-binding-${interaction.id}`}
            >
              <div className='flex items-center gap-8px'>
                <span className='min-w-0 flex-1 truncate text-11px font-750 text-t-primary'>
                  {labels.bindings} {index + 1}
                </span>
                <Button
                  type='text'
                  size='mini'
                  status='danger'
                  aria-label={labels.remove}
                  icon={<Delete size={13} />}
                  disabled={disabled}
                  onClick={() => onCommit(createDeleteInteractionViuBatch(project, interaction.id))}
                />
              </div>
              <Field label={labels.trigger}>
                <Select
                  size='mini'
                  value={interaction.trigger}
                  options={triggerOptions}
                  disabled={disabled}
                  onChange={(value) =>
                    updateInteraction(interaction, { trigger: String(value) as ViuInteractionTrigger })
                  }
                />
              </Field>
              {actions.map((action, actionIndex) => {
                const type = actionType(action);
                const actionOptionsForType = optionsFor(type);
                const selectedVariable =
                  action.type === 'setVariable' || action.type === 'toggleVariable'
                    ? project.variables[action.variableId]
                    : undefined;
                return (
                  <div
                    key={actionIndex}
                    className='rd-8px border border-b-1 bg-bg-2 p-8px flex flex-col gap-8px'
                    data-testid={`viu-prototype-action-${interaction.id}-${actionIndex}`}
                  >
                    <div className='flex items-end gap-6px'>
                      <div className='min-w-0 flex-1'>
                        <Field label={`${labels.action} ${actionIndex + 1}`}>
                          <Select
                            size='mini'
                            value={type}
                            options={actionOptions}
                            disabled={disabled}
                            onChange={(value) => {
                              const nextType = String(value) as PrototypeActionType;
                              const target = optionsFor(nextType)[0]?.value ?? '';
                              if (!TARGETLESS_ACTIONS.has(nextType) && !target) return;
                              const next = [...actions];
                              next[actionIndex] = createAction(project, nextType, target);
                              updateActions(interaction, next);
                            }}
                          />
                        </Field>
                      </div>
                      <Button
                        type='text'
                        size='mini'
                        aria-label={labels.moveUp}
                        icon={<Up size={12} />}
                        disabled={disabled || actionIndex === 0}
                        onClick={() => {
                          const next = [...actions];
                          [next[actionIndex - 1], next[actionIndex]] = [next[actionIndex]!, next[actionIndex - 1]!];
                          updateActions(interaction, next);
                        }}
                      />
                      <Button
                        type='text'
                        size='mini'
                        aria-label={labels.moveDown}
                        icon={<Down size={12} />}
                        disabled={disabled || actionIndex === actions.length - 1}
                        onClick={() => {
                          const next = [...actions];
                          [next[actionIndex], next[actionIndex + 1]] = [next[actionIndex + 1]!, next[actionIndex]!];
                          updateActions(interaction, next);
                        }}
                      />
                      <Button
                        type='text'
                        size='mini'
                        status='danger'
                        aria-label={`${labels.remove} ${labels.action} ${actionIndex + 1}`}
                        icon={<Delete size={12} />}
                        disabled={disabled || actions.length === 1}
                        onClick={() =>
                          updateActions(
                            interaction,
                            actions.filter((_, itemIndex) => itemIndex !== actionIndex)
                          )
                        }
                      />
                    </div>
                    {!TARGETLESS_ACTIONS.has(type) ? (
                      <Field label={labels.destination}>
                        <Select
                          size='mini'
                          showSearch
                          value={actionTarget(action)}
                          options={actionOptionsForType}
                          disabled={disabled || actionOptionsForType.length === 0}
                          onChange={(value) => {
                            const next = [...actions];
                            next[actionIndex] = createAction(project, type, String(value));
                            updateActions(interaction, next);
                          }}
                        />
                      </Field>
                    ) : null}
                    {action.type === 'setVariable' && selectedVariable?.type === 'number' ? (
                      <Field label={labels.value}>
                        <InputNumber
                          size='mini'
                          value={typeof action.value === 'number' ? action.value : 0}
                          disabled={disabled}
                          onChange={(value) => {
                            if (typeof value !== 'number') return;
                            const next = [...actions];
                            next[actionIndex] = { ...action, value };
                            updateActions(interaction, next);
                          }}
                        />
                      </Field>
                    ) : null}
                    {action.type === 'setVariable' && selectedVariable?.type === 'boolean' ? (
                      <Field label={labels.value}>
                        <Select
                          size='mini'
                          value={action.value ? 'true' : 'false'}
                          options={[
                            { value: 'true', label: labels.conditionTruthy },
                            { value: 'false', label: labels.conditionFalsy },
                          ]}
                          disabled={disabled}
                          onChange={(value) => {
                            const next = [...actions];
                            next[actionIndex] = { ...action, value: value === 'true' };
                            updateActions(interaction, next);
                          }}
                        />
                      </Field>
                    ) : null}
                    {action.type === 'setVariable' &&
                    selectedVariable &&
                    selectedVariable.type !== 'number' &&
                    selectedVariable.type !== 'boolean' ? (
                      <Field label={labels.value}>
                        <Input
                          size='mini'
                          value={typeof action.value === 'string' ? action.value : ''}
                          disabled={disabled}
                          onChange={(value) => {
                            const next = [...actions];
                            next[actionIndex] = { ...action, value };
                            updateActions(interaction, next);
                          }}
                        />
                      </Field>
                    ) : null}
                    {action.type === 'seekTimeline' ? (
                      <Field label={labels.position}>
                        <InputNumber
                          size='mini'
                          min={0}
                          max={3_600_000}
                          step={50}
                          value={action.offsetMs}
                          disabled={disabled}
                          onChange={(value) => {
                            if (typeof value !== 'number') return;
                            const next = [...actions];
                            next[actionIndex] = { ...action, offsetMs: value };
                            updateActions(interaction, next);
                          }}
                        />
                      </Field>
                    ) : null}
                  </div>
                );
              })}
              <Button
                long
                type='text'
                size='mini'
                icon={<AddOne size={12} />}
                disabled={disabled || actions.length >= 32 || screenOptions.length === 0}
                onClick={() =>
                  updateActions(interaction, [
                    ...actions,
                    createAction(project, 'navigate', screenOptions[0]?.value ?? ''),
                  ])
                }
              >
                {labels.addAction}
              </Button>
              <div className='grid grid-cols-2 gap-8px'>
                <Field label={labels.condition}>
                  <Select
                    size='mini'
                    value={interaction.condition?.operator ?? 'none'}
                    options={[
                      { value: 'none', label: labels.conditionNone },
                      { value: 'truthy', label: labels.conditionTruthy },
                      { value: 'falsy', label: labels.conditionFalsy },
                      { value: 'eq', label: labels.conditionEq },
                      { value: 'neq', label: labels.conditionNeq },
                      { value: 'gt', label: labels.conditionGt },
                      { value: 'gte', label: labels.conditionGte },
                      { value: 'lt', label: labels.conditionLt },
                      { value: 'lte', label: labels.conditionLte },
                    ]}
                    disabled={disabled || variableOptions.length === 0}
                    onChange={(value) => {
                      const operator = String(value);
                      updateInteraction(interaction, {
                        condition:
                          operator === 'none'
                            ? undefined
                            : {
                                variableId: interaction.condition?.variableId ?? variableOptions[0]!.value,
                                operator: operator as NonNullable<ViuInteraction['condition']>['operator'],
                                value: operator === 'truthy' || operator === 'falsy' ? undefined : 0,
                              },
                      });
                    }}
                  />
                </Field>
                {interaction.condition ? (
                  <Field label={labels.destination}>
                    <Select
                      size='mini'
                      showSearch
                      value={interaction.condition.variableId}
                      options={variableOptions}
                      disabled={disabled}
                      onChange={(value) =>
                        updateInteraction(interaction, {
                          condition: { ...interaction.condition!, variableId: String(value) },
                        })
                      }
                    />
                  </Field>
                ) : null}
              </div>
              {interaction.condition &&
              interaction.condition.operator !== 'truthy' &&
              interaction.condition.operator !== 'falsy' ? (
                <Field label={labels.value}>
                  {conditionVariable?.type === 'number' ? (
                    <InputNumber
                      size='mini'
                      value={typeof interaction.condition.value === 'number' ? interaction.condition.value : 0}
                      disabled={disabled}
                      onChange={(value) =>
                        typeof value === 'number' &&
                        updateInteraction(interaction, {
                          condition: { ...interaction.condition!, value },
                        })
                      }
                    />
                  ) : (
                    <Input
                      size='mini'
                      value={typeof interaction.condition.value === 'string' ? interaction.condition.value : ''}
                      disabled={disabled}
                      onChange={(value) =>
                        updateInteraction(interaction, {
                          condition: { ...interaction.condition!, value },
                        })
                      }
                    />
                  )}
                </Field>
              ) : null}
              <div className='grid grid-cols-2 gap-8px'>
                <Field label={labels.transition}>
                  <Select
                    size='mini'
                    value={transition.preset}
                    options={presetOptions}
                    disabled={disabled}
                    onChange={(value) =>
                      updateInteraction(interaction, {
                        transition: { ...transition, preset: String(value) as ViuInteractionTransition['preset'] },
                      })
                    }
                  />
                </Field>
                <Field label={labels.duration}>
                  <InputNumber
                    size='mini'
                    min={0}
                    max={60_000}
                    step={20}
                    value={transition.durationMs}
                    disabled={disabled}
                    onChange={(value) =>
                      typeof value === 'number' &&
                      updateInteraction(interaction, { transition: { ...transition, durationMs: value } })
                    }
                  />
                </Field>
              </div>
              <Field label={labels.easing}>
                <Select
                  size='mini'
                  value={transition.easing}
                  options={easingOptions}
                  disabled={disabled}
                  onChange={(value) =>
                    updateInteraction(interaction, {
                      transition: { ...transition, easing: String(value) as ViuInteractionTransition['easing'] },
                    })
                  }
                />
              </Field>
            </div>
          );
        })}

        {selectedNode && defaultFlow ? (
          <div className='rd-10px border border-dashed border-b-2 bg-bg-1 p-9px flex flex-col gap-9px'>
            <div className='grid grid-cols-2 gap-8px'>
              <Field label={labels.trigger}>
                <Select
                  size='mini'
                  value={draftTrigger}
                  options={triggerOptions}
                  disabled={disabled}
                  onChange={(value) => setDraftTrigger(String(value) as ViuInteractionTrigger)}
                />
              </Field>
              <Field label={labels.action}>
                <Select
                  size='mini'
                  value={draftActionType}
                  options={actionOptions}
                  disabled={disabled}
                  onChange={(value) => {
                    const nextType = String(value) as PrototypeActionType;
                    setDraftActionType(nextType);
                    setDraftTargetId(optionsFor(nextType)[0]?.value ?? '');
                  }}
                />
              </Field>
              {!TARGETLESS_ACTIONS.has(draftActionType) ? (
                <Field label={labels.destination}>
                  <Select
                    size='mini'
                    showSearch
                    value={draftTarget}
                    options={optionsFor(draftActionType)}
                    disabled={disabled || optionsFor(draftActionType).length === 0}
                    onChange={(value) => setDraftTargetId(String(value))}
                  />
                </Field>
              ) : null}
            </div>
            <div className='grid grid-cols-2 gap-8px'>
              <Field label={labels.transition}>
                <Select
                  size='mini'
                  value={draftTransition.preset}
                  options={presetOptions}
                  disabled={disabled}
                  onChange={(value) =>
                    setDraftTransition((current) => ({
                      ...current,
                      preset: String(value) as ViuInteractionTransition['preset'],
                    }))
                  }
                />
              </Field>
              <Field label={labels.duration}>
                <InputNumber
                  size='mini'
                  min={0}
                  max={60_000}
                  step={20}
                  value={draftTransition.durationMs}
                  disabled={disabled}
                  onChange={(value) =>
                    typeof value === 'number' && setDraftTransition((current) => ({ ...current, durationMs: value }))
                  }
                />
              </Field>
              <Field label={labels.easing}>
                <Select
                  size='mini'
                  value={draftTransition.easing}
                  options={easingOptions}
                  disabled={disabled}
                  onChange={(value) =>
                    setDraftTransition((current) => ({
                      ...current,
                      easing: String(value) as ViuInteractionTransition['easing'],
                    }))
                  }
                />
              </Field>
            </div>
            <Button
              long
              type='outline'
              icon={<AddOne size={14} />}
              disabled={disabled || (!TARGETLESS_ACTIONS.has(draftActionType) && !draftTarget)}
              data-testid='viu-add-prototype-binding'
              onClick={() => {
                if (!TARGETLESS_ACTIONS.has(draftActionType) && !draftTarget) return;
                onCommit(
                  createInteractionViuBatch(project, {
                    id: nextInteractionId(),
                    flowId: defaultFlow.id,
                    sourceNodeId: selectedNode.id,
                    trigger: draftTrigger,
                    action: createAction(project, draftActionType, draftTarget),
                    transition: draftTransition,
                  })
                );
              }}
            >
              {labels.addInteraction}
            </Button>
          </div>
        ) : null}

        <div className='mt-3px border-t border-b-1 pt-11px flex flex-col gap-9px' data-testid='viu-motion-editor'>
          <div className='flex items-center gap-8px'>
            <span className='min-w-0 flex-1 truncate text-11px font-750 text-t-primary'>{labels.timeline}</span>
            <Tag size='small'>{timelines.length}</Tag>
            <Button
              type='outline'
              size='mini'
              icon={<AddOne size={12} />}
              disabled={disabled}
              data-testid='viu-create-timeline'
              onClick={() => {
                const timeline: ViuTimeline = {
                  id: nextMotionId('timeline'),
                  name: `${labels.timeline} ${timelines.length + 1}`,
                  durationMs: 1000,
                  loop: false,
                  tracks: [],
                };
                onCommit(createTimelineViuBatch(project, timeline));
              }}
            >
              {labels.createTimeline}
            </Button>
          </div>

          {timelines.length === 0 ? <Empty description={labels.noTimeline} /> : null}
          {timelines.map((timeline) => (
            <div
              key={timeline.id}
              className='rd-10px border border-b-1 bg-fill-1 p-9px flex flex-col gap-9px'
              data-testid={`viu-timeline-${timeline.id}`}
            >
              <div className='grid grid-cols-[minmax(0,1fr)_88px_auto_auto] items-end gap-7px'>
                <Field label={labels.timeline}>
                  <Input
                    size='mini'
                    value={timeline.name}
                    disabled={disabled}
                    onChange={(name) => name.trim() && updateTimeline(timeline, { name })}
                  />
                </Field>
                <Field label={labels.duration}>
                  <InputNumber
                    size='mini'
                    min={Math.max(
                      1,
                      ...(timeline.tracks ?? []).flatMap((track) =>
                        track.keyframes.map((keyframe) => keyframe.offsetMs)
                      )
                    )}
                    max={3_600_000}
                    step={50}
                    value={timeline.durationMs}
                    disabled={disabled}
                    onChange={(durationMs) =>
                      typeof durationMs === 'number' && updateTimeline(timeline, { durationMs })
                    }
                  />
                </Field>
                <Field label={labels.loop}>
                  <Switch
                    size='small'
                    checked={Boolean(timeline.loop)}
                    disabled={disabled}
                    onChange={(loop) => updateTimeline(timeline, { loop })}
                  />
                </Field>
                <Button
                  type='text'
                  size='mini'
                  status='danger'
                  aria-label={labels.remove}
                  icon={<Delete size={13} />}
                  disabled={disabled || isTimelineReferenced(timeline.id)}
                  onClick={() => onCommit(createDeleteTimelineViuBatch(project, timeline.id))}
                />
              </div>

              {(timeline.tracks ?? []).map((track, trackIndex) => (
                <div
                  key={track.id}
                  className='rd-8px border border-b-1 bg-bg-2 p-8px flex flex-col gap-8px'
                  data-testid={`viu-timeline-track-${track.id}`}
                >
                  <div className='grid grid-cols-[minmax(0,1fr)_112px_auto] items-end gap-7px'>
                    <Field label={labels.destination}>
                      <Select
                        size='mini'
                        showSearch
                        value={track.nodeId}
                        options={nodeOptions}
                        disabled={disabled}
                        onChange={(value) => updateTimelineTrack(timeline, trackIndex, { nodeId: String(value) })}
                      />
                    </Field>
                    <Field label={labels.property}>
                      <Select
                        size='mini'
                        value={track.property}
                        options={propertyOptions}
                        disabled={disabled}
                        onChange={(value) =>
                          updateTimelineTrack(timeline, trackIndex, {
                            property: String(value) as ViuTimelineTrack['property'],
                          })
                        }
                      />
                    </Field>
                    <Button
                      type='text'
                      size='mini'
                      status='danger'
                      aria-label={labels.remove}
                      icon={<Delete size={12} />}
                      disabled={disabled}
                      onClick={() =>
                        updateTimeline(timeline, {
                          tracks: (timeline.tracks ?? []).filter((_, index) => index !== trackIndex),
                        })
                      }
                    />
                  </div>
                  <div className='flex items-center gap-7px'>
                    <span className='min-w-0 flex-1 text-10px font-650 text-t-secondary'>{labels.keyframes}</span>
                    <Button
                      type='text'
                      size='mini'
                      icon={<AddOne size={11} />}
                      disabled={disabled || track.keyframes.length >= 1000}
                      onClick={() =>
                        updateTimelineTrack(timeline, trackIndex, {
                          keyframes: [
                            ...track.keyframes,
                            {
                              offsetMs: track.keyframes.length === 0 ? 0 : timeline.durationMs,
                              value: track.property === 'opacity' ? 1 : 0,
                            },
                          ],
                        })
                      }
                    >
                      {labels.addKeyframe}
                    </Button>
                  </div>
                  {track.keyframes.map((keyframe, keyframeIndex) => (
                    <div
                      key={`${keyframe.offsetMs}-${keyframeIndex}`}
                      className='grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-7px'
                    >
                      <Field label={labels.position}>
                        <InputNumber
                          size='mini'
                          min={0}
                          max={timeline.durationMs}
                          step={50}
                          value={keyframe.offsetMs}
                          disabled={disabled}
                          onChange={(offsetMs) => {
                            if (typeof offsetMs !== 'number') return;
                            const keyframes = [...track.keyframes];
                            keyframes[keyframeIndex] = { ...keyframe, offsetMs };
                            updateTimelineTrack(timeline, trackIndex, { keyframes });
                          }}
                        />
                      </Field>
                      <Field label={labels.value}>
                        <InputNumber
                          size='mini'
                          value={keyframe.value}
                          disabled={disabled}
                          onChange={(value) => {
                            if (typeof value !== 'number') return;
                            const keyframes = [...track.keyframes];
                            keyframes[keyframeIndex] = { ...keyframe, value };
                            updateTimelineTrack(timeline, trackIndex, { keyframes });
                          }}
                        />
                      </Field>
                      <Button
                        type='text'
                        size='mini'
                        status='danger'
                        aria-label={labels.remove}
                        icon={<Delete size={11} />}
                        disabled={disabled}
                        onClick={() =>
                          updateTimelineTrack(timeline, trackIndex, {
                            keyframes: track.keyframes.filter((_, index) => index !== keyframeIndex),
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              ))}

              <Button
                long
                type='text'
                size='mini'
                icon={<AddOne size={12} />}
                disabled={disabled || !selectedNode || (timeline.tracks?.length ?? 0) >= 1000}
                data-testid={`viu-add-track-${timeline.id}`}
                onClick={() => {
                  if (!selectedNode) return;
                  updateTimeline(timeline, {
                    tracks: [
                      ...(timeline.tracks ?? []),
                      {
                        id: nextMotionId('track'),
                        nodeId: selectedNode.id,
                        property: 'opacity',
                        keyframes: [
                          { offsetMs: 0, value: 0 },
                          { offsetMs: timeline.durationMs, value: 1 },
                        ],
                      },
                    ],
                  });
                }}
              >
                {labels.addTrack}
              </Button>
            </div>
          ))}

          <div className='mt-2px flex items-center gap-8px'>
            <span className='min-w-0 flex-1 truncate text-11px font-750 text-t-primary'>{labels.scrollBinding}</span>
            <Tag size='small'>{scrollBindings.length}</Tag>
            <Button
              type='outline'
              size='mini'
              icon={<AddOne size={12} />}
              disabled={disabled || !selectedNode}
              data-testid='viu-add-scroll-binding'
              onClick={() => {
                if (!selectedNode) return;
                onCommit(
                  createUpsertScrollBindingViuBatch(project, {
                    id: nextMotionId('scroll'),
                    nodeId: selectedNode.id,
                    timelineId: timelines[0]?.id,
                    start: 0,
                    end: 1,
                    pin: false,
                    parallax: 0,
                  })
                );
              }}
            >
              {labels.addScrollBinding}
            </Button>
          </div>

          {scrollBindings.map((binding) => (
            <div
              key={binding.id}
              className='rd-10px border border-b-1 bg-fill-1 p-9px flex flex-col gap-8px'
              data-testid={`viu-scroll-binding-${binding.id}`}
            >
              <div className='grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-7px'>
                <Field label={labels.destination}>
                  <Select
                    size='mini'
                    showSearch
                    value={binding.nodeId}
                    options={nodeOptions}
                    disabled={disabled}
                    onChange={(value) => updateScrollBinding(binding, { nodeId: String(value) })}
                  />
                </Field>
                <Field label={labels.timeline}>
                  <Select
                    size='mini'
                    value={binding.timelineId ?? NO_TIMELINE}
                    options={scrollTimelineOptions}
                    disabled={disabled}
                    onChange={(value) =>
                      updateScrollBinding(binding, {
                        timelineId: String(value) === NO_TIMELINE ? undefined : String(value),
                      })
                    }
                  />
                </Field>
                <Button
                  type='text'
                  size='mini'
                  status='danger'
                  aria-label={labels.remove}
                  icon={<Delete size={12} />}
                  disabled={disabled}
                  onClick={() => onCommit(createDeleteScrollBindingViuBatch(project, binding.id))}
                />
              </div>
              <div className='grid grid-cols-2 gap-7px'>
                <Field label={labels.start}>
                  <InputNumber
                    size='mini'
                    min={0}
                    max={Math.max(0, binding.end - 0.01)}
                    step={0.05}
                    precision={2}
                    value={binding.start}
                    disabled={disabled}
                    onChange={(start) =>
                      typeof start === 'number' && start < binding.end && updateScrollBinding(binding, { start })
                    }
                  />
                </Field>
                <Field label={labels.end}>
                  <InputNumber
                    size='mini'
                    min={Math.min(1, binding.start + 0.01)}
                    max={1}
                    step={0.05}
                    precision={2}
                    value={binding.end}
                    disabled={disabled}
                    onChange={(end) =>
                      typeof end === 'number' && end > binding.start && updateScrollBinding(binding, { end })
                    }
                  />
                </Field>
                <Field label={labels.parallax}>
                  <InputNumber
                    size='mini'
                    min={-10_000}
                    max={10_000}
                    step={10}
                    value={binding.parallax}
                    disabled={disabled}
                    onChange={(parallax) => typeof parallax === 'number' && updateScrollBinding(binding, { parallax })}
                  />
                </Field>
                <Field label={labels.pin}>
                  <Switch
                    size='small'
                    checked={binding.pin}
                    disabled={disabled}
                    onChange={(pin) => updateScrollBinding(binding, { pin })}
                  />
                </Field>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PrototypeInspector;
