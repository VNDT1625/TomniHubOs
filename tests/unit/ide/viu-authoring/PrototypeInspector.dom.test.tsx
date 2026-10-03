/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigProvider } from '@arco-design/web-react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPremiumStarterProject } from '@/common/viu';
import PrototypeInspector from '@package-apps/design/renderer/viu/next/authoring/PrototypeInspector';
import type { ViuPrototypeInspectorLabels } from '@package-apps/design/renderer/viu/next/authoring/types';

const labels: ViuPrototypeInspectorLabels = {
  section: 'Prototype',
  bindings: 'Interaction',
  addInteraction: 'Add interaction',
  noSelection: 'Select one object',
  noFlow: 'Create a flow',
  trigger: 'Trigger',
  click: 'Click',
  hover: 'Hover',
  focus: 'Focus',
  submit: 'Submit',
  scroll: 'Scroll',
  load: 'Load',
  action: 'Action',
  navigate: 'Navigate',
  openOverlay: 'Open overlay',
  closeOverlay: 'Close overlay',
  back: 'Back',
  scrollTo: 'Scroll to',
  setVariable: 'Set variable',
  toggleVariable: 'Toggle variable',
  playTimeline: 'Play timeline',
  pauseTimeline: 'Pause timeline',
  seekTimeline: 'Seek timeline',
  destination: 'Destination',
  value: 'Value',
  condition: 'Condition',
  conditionNone: 'Always',
  conditionTruthy: 'Truthy',
  conditionFalsy: 'Falsy',
  conditionEq: 'Equals',
  conditionNeq: 'Not equal',
  conditionGt: 'Greater',
  conditionGte: 'Greater or equal',
  conditionLt: 'Less',
  conditionLte: 'Less or equal',
  addAction: 'Add action',
  moveUp: 'Move up',
  moveDown: 'Move down',
  timeline: 'Timeline',
  createTimeline: 'Create timeline',
  addTrack: 'Add track',
  addKeyframe: 'Add keyframe',
  loop: 'Loop',
  property: 'Property',
  start: 'Start',
  end: 'End',
  pin: 'Pin',
  parallax: 'Parallax',
  scrollBinding: 'Scroll binding',
  addScrollBinding: 'Add scroll binding',
  noTimeline: 'No timeline',
  x: 'X',
  y: 'Y',
  opacity: 'Opacity',
  scale: 'Scale',
  rotate: 'Rotate',
  blur: 'Blur',
  keyframes: 'Keyframes',
  position: 'Position',
  transition: 'Transition',
  presetNone: 'Instant',
  presetFade: 'Fade',
  presetRise: 'Rise',
  presetScale: 'Scale',
  presetSlideLeft: 'Slide left',
  presetSlideRight: 'Slide right',
  presetBlur: 'Blur in',
  presetReveal: 'Reveal',
  presetSmartAnimate: 'Smart animate',
  duration: 'Duration',
  easing: 'Easing',
  easingLinear: 'Linear',
  easingEase: 'Ease',
  easingIn: 'Ease in',
  easingOut: 'Ease out',
  easingInOut: 'Ease in-out',
  easingSpring: 'Soft spring',
  remove: 'Remove interaction',
  disconnectedScreens: (count) => `${count} disconnected screen(s)`,
};

afterEach(cleanup);

const selectOptionAt = async (container: HTMLElement, index: number, label: string): Promise<void> => {
  const select = container.querySelectorAll<HTMLElement>('.arco-select')[index];
  if (!select) throw new Error(`No select at index ${index}`);
  fireEvent.click(select);
  const matches = await screen.findAllByText(label);
  const option = matches.find((match) => match.closest('.arco-select-option'));
  if (!option) throw new Error(`No option ${label} found`);
  fireEvent.click(option.closest('.arco-select-option')!);
};

describe('VIU PrototypeInspector', () => {
  it('emits a typed create batch for the selected node', () => {
    const project = createPremiumStarterProject('prototype-dom-create');
    const onCommit = vi.fn();
    render(
      <ConfigProvider>
        <PrototypeInspector
          project={project}
          selection={{ nodeIds: ['node-home-title'], anchorId: 'node-home-title' }}
          labels={labels}
          onCommit={onCommit}
        />
      </ConfigProvider>
    );

    fireEvent.click(screen.getByTestId('viu-add-prototype-binding'));

    const batch = onCommit.mock.calls[0]?.[0];
    expect(batch.intent).toBe('interaction-create');
    expect(batch.commands[0]).toMatchObject({
      type: 'connectInteraction',
      interaction: { sourceNodeId: 'node-home-title', trigger: 'click', transition: { preset: 'fade' } },
    });
  });

  it('offers edit controls and emits a delete batch for an existing binding', () => {
    const project = createPremiumStarterProject('prototype-dom-delete');
    const onCommit = vi.fn();
    render(
      <ConfigProvider>
        <PrototypeInspector
          project={project}
          selection={{ nodeIds: ['node-home-cta'], anchorId: 'node-home-cta' }}
          labels={labels}
          onCommit={onCommit}
        />
      </ConfigProvider>
    );

    expect(screen.getByTestId('viu-prototype-binding-interaction-home-showcase')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove interaction' }));

    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({
      intent: 'interaction-delete',
      commands: [{ type: 'disconnectInteraction', interactionId: 'interaction-home-showcase' }],
    });
  });

  it('adds an ordered action to an existing binding through a transaction batch', () => {
    const project = createPremiumStarterProject('prototype-dom-actions');
    const onCommit = vi.fn();
    render(
      <ConfigProvider>
        <PrototypeInspector
          project={project}
          selection={{ nodeIds: ['node-home-cta'], anchorId: 'node-home-cta' }}
          labels={labels}
          onCommit={onCommit}
        />
      </ConfigProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add action' }));

    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({
      intent: 'interaction-update',
      commands: [
        { type: 'disconnectInteraction', interactionId: 'interaction-home-showcase' },
        {
          type: 'connectInteraction',
          interaction: {
            actions: [
              { type: 'navigate', targetScreenId: 'screen-showcase' },
              { type: 'navigate', targetScreenId: 'screen-showcase' },
            ],
          },
        },
      ],
    });
  });

  it('emits a typed timeline creation batch', () => {
    const project = createPremiumStarterProject('prototype-dom-timeline-create');
    const onCommit = vi.fn();
    render(
      <ConfigProvider>
        <PrototypeInspector
          project={project}
          selection={{ nodeIds: ['node-home-title'], anchorId: 'node-home-title' }}
          labels={labels}
          onCommit={onCommit}
        />
      </ConfigProvider>
    );

    fireEvent.click(screen.getByTestId('viu-create-timeline'));

    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({
      intent: 'timeline-create',
      commands: [{ type: 'createTimeline', timeline: { durationMs: 1000, tracks: [] } }],
    });
  });

  it('authors tracks, keyframes, and scroll bindings from the selected node', () => {
    const project = createPremiumStarterProject('prototype-dom-motion');
    project.timelines['timeline-motion'] = {
      id: 'timeline-motion',
      name: 'Motion',
      durationMs: 1000,
      tracks: [
        {
          id: 'track-motion',
          nodeId: 'node-home-title',
          property: 'opacity',
          keyframes: [{ offsetMs: 0, value: 0 }],
        },
      ],
    };
    const onCommit = vi.fn();
    render(
      <ConfigProvider>
        <PrototypeInspector
          project={project}
          selection={{ nodeIds: ['node-home-title'], anchorId: 'node-home-title' }}
          labels={labels}
          onCommit={onCommit}
        />
      </ConfigProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add keyframe' }));
    fireEvent.click(screen.getByTestId('viu-add-track-timeline-motion'));
    fireEvent.click(screen.getByTestId('viu-add-scroll-binding'));

    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({
      intent: 'timeline-update',
      commands: [
        {
          type: 'updateTimeline',
          timelineId: 'timeline-motion',
          patch: {
            tracks: [
              {
                keyframes: [
                  { offsetMs: 0, value: 0 },
                  { offsetMs: 1000, value: 1 },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(onCommit.mock.calls[1]?.[0]).toMatchObject({
      intent: 'timeline-update',
      commands: [{ type: 'updateTimeline', timelineId: 'timeline-motion' }],
    });
    expect(onCommit.mock.calls[2]?.[0]).toMatchObject({
      intent: 'scroll-binding',
      commands: [
        {
          type: 'upsertScrollBinding',
          binding: {
            nodeId: 'node-home-title',
            timelineId: 'timeline-motion',
            start: 0,
            end: 1,
            pin: false,
            parallax: 0,
          },
        },
      ],
    });
  });

  it('edits timeline metadata and keyframes through atomic timeline batches', () => {
    const project = createPremiumStarterProject('prototype-dom-timeline-edit');
    project.timelines['timeline-motion'] = {
      id: 'timeline-motion',
      name: 'Motion',
      durationMs: 1000,
      loop: false,
      tracks: [
        {
          id: 'track-motion',
          nodeId: 'node-home-title',
          property: 'opacity',
          keyframes: [{ offsetMs: 0, value: 0 }],
        },
      ],
    };
    const onCommit = vi.fn();
    render(
      <ConfigProvider>
        <PrototypeInspector
          project={project}
          selection={{ nodeIds: ['node-home-title'], anchorId: 'node-home-title' }}
          labels={labels}
          onCommit={onCommit}
        />
      </ConfigProvider>
    );

    const timeline = screen.getByTestId('viu-timeline-timeline-motion');
    fireEvent.change(within(timeline).getByDisplayValue('Motion'), { target: { value: 'Hero reveal' } });
    const timelineNumbers = within(timeline).getAllByRole('spinbutton');
    fireEvent.change(timelineNumbers[0]!, { target: { value: '1400' } });
    fireEvent.click(within(timeline).getByRole('switch'));
    fireEvent.change(timelineNumbers[1]!, { target: { value: '250' } });
    fireEvent.change(timelineNumbers[2]!, { target: { value: '0.6' } });

    expect(onCommit.mock.calls[0]?.[0].commands[0].patch.name).toBe('Hero reveal');
    expect(onCommit.mock.calls[1]?.[0].commands[0].patch.durationMs).toBe(1400);
    expect(onCommit.mock.calls[2]?.[0].commands[0].patch.loop).toBe(true);
    expect(onCommit.mock.calls.at(-1)?.[0].commands[0].patch.tracks[0].keyframes[0].value).toBe(0.6);
  });

  it('removes keyframes and tracks independently without deleting the timeline', () => {
    const project = createPremiumStarterProject('prototype-dom-timeline-remove');
    project.timelines['timeline-motion'] = {
      id: 'timeline-motion',
      name: 'Motion',
      durationMs: 1000,
      tracks: [
        {
          id: 'track-motion',
          nodeId: 'node-home-title',
          property: 'opacity',
          keyframes: [{ offsetMs: 0, value: 0 }],
        },
      ],
    };
    const onCommit = vi.fn();
    render(
      <ConfigProvider>
        <PrototypeInspector
          project={project}
          selection={{ nodeIds: ['node-home-title'], anchorId: 'node-home-title' }}
          labels={labels}
          onCommit={onCommit}
        />
      </ConfigProvider>
    );

    const track = screen.getByTestId('viu-timeline-track-track-motion');
    const removeButtons = within(track).getAllByRole('button', { name: 'Remove interaction' });
    fireEvent.click(removeButtons[1]!);
    fireEvent.click(removeButtons[0]!);

    expect(onCommit.mock.calls[0]?.[0].commands[0].patch.tracks[0].keyframes).toEqual([]);
    expect(onCommit.mock.calls[1]?.[0].commands[0].patch.tracks).toEqual([]);
  });

  it('clamps inverted scroll ranges before authoring progress, parallax and pinning', () => {
    const project = createPremiumStarterProject('prototype-dom-scroll-edit');
    project.scrollBindings = {
      'scroll-hero': {
        id: 'scroll-hero',
        nodeId: 'node-home-title',
        start: 0.1,
        end: 0.9,
        pin: false,
        parallax: 0,
      },
    };
    const onCommit = vi.fn();
    render(
      <ConfigProvider>
        <PrototypeInspector
          project={project}
          selection={{ nodeIds: ['node-home-title'], anchorId: 'node-home-title' }}
          labels={labels}
          onCommit={onCommit}
        />
      </ConfigProvider>
    );

    const binding = screen.getByTestId('viu-scroll-binding-scroll-hero');
    const numbers = within(binding).getAllByRole('spinbutton');
    fireEvent.change(numbers[0]!, { target: { value: '0.95' } });
    expect(onCommit.mock.calls[0]?.[0].commands[0].binding.start).toBe(0.89);
    fireEvent.change(numbers[0]!, { target: { value: '0.2' } });
    fireEvent.change(numbers[1]!, { target: { value: '0.8' } });
    fireEvent.change(numbers[2]!, { target: { value: '120' } });
    fireEvent.click(within(binding).getByRole('switch'));
    fireEvent.click(within(binding).getByRole('button', { name: 'Remove interaction' }));

    expect(onCommit.mock.calls[1]?.[0].commands[0].binding.start).toBe(0.2);
    expect(onCommit.mock.calls[3]?.[0].commands[0].binding.parallax).toBe(120);
    expect(onCommit.mock.calls[4]?.[0].commands[0].binding.pin).toBe(true);
    expect(onCommit.mock.calls[5]?.[0]).toMatchObject({
      intent: 'scroll-binding',
      commands: [{ type: 'deleteScrollBinding', bindingId: 'scroll-hero' }],
    });
  });

  it('reorders and removes ordered interaction actions without collapsing the binding', () => {
    const project = createPremiumStarterProject('prototype-dom-action-order');
    project.interactions['interaction-home-showcase']!.actions = [
      { type: 'navigate', targetScreenId: 'screen-showcase' },
      { type: 'back' },
    ];
    const onCommit = vi.fn();
    render(
      <ConfigProvider>
        <PrototypeInspector
          project={project}
          selection={{ nodeIds: ['node-home-cta'], anchorId: 'node-home-cta' }}
          labels={labels}
          onCommit={onCommit}
        />
      </ConfigProvider>
    );

    const binding = screen.getByTestId('viu-prototype-binding-interaction-home-showcase');
    fireEvent.click(within(binding).getAllByRole('button', { name: 'Move down' })[0]!);
    fireEvent.click(within(binding).getAllByRole('button', { name: 'Remove interaction Action 2' })[0]!);
    fireEvent.change(within(binding).getByRole('spinbutton'), { target: { value: '720' } });

    expect(
      onCommit.mock.calls[0]?.[0].commands[1].interaction.actions.map((action: { type: string }) => action.type)
    ).toEqual(['back', 'navigate']);
    expect(onCommit.mock.calls[1]?.[0].commands[1].interaction.actions).toHaveLength(1);
    expect(onCommit.mock.calls[2]?.[0].commands[1].interaction.transition.durationMs).toBe(720);
  });

  it('authors variable, timeline, condition and transition variants for ordered actions', async () => {
    const project = createPremiumStarterProject('prototype-dom-advanced-actions');
    project.timelines['timeline-motion'] = {
      id: 'timeline-motion',
      name: 'Motion',
      durationMs: 1000,
      tracks: [],
    };
    project.interactions['interaction-home-showcase']!.actions = [
      { type: 'setVariable', variableId: 'space-md', value: 24 },
      { type: 'seekTimeline', timelineId: 'timeline-motion', offsetMs: 100 },
    ];
    project.interactions['interaction-home-showcase']!.condition = {
      variableId: 'space-md',
      operator: 'gt',
      value: 20,
    };
    const onCommit = vi.fn();
    render(
      <ConfigProvider>
        <PrototypeInspector
          project={project}
          selection={{ nodeIds: ['node-home-cta'], anchorId: 'node-home-cta' }}
          labels={labels}
          onCommit={onCommit}
        />
      </ConfigProvider>
    );

    const binding = screen.getByTestId('viu-prototype-binding-interaction-home-showcase');
    const variableAction = screen.getByTestId('viu-prototype-action-interaction-home-showcase-0');
    const timelineAction = screen.getByTestId('viu-prototype-action-interaction-home-showcase-1');

    fireEvent.change(within(variableAction).getByRole('spinbutton'), { target: { value: '48' } });
    await selectOptionAt(variableAction, 0, 'Toggle variable');
    await selectOptionAt(variableAction, 1, 'Space / Medium');
    fireEvent.change(within(timelineAction).getByRole('spinbutton'), { target: { value: '650' } });
    await selectOptionAt(timelineAction, 0, 'Pause timeline');
    await selectOptionAt(binding, 0, 'Hover');
    await selectOptionAt(binding, 5, 'Equals');
    await selectOptionAt(binding, 6, 'Space / Medium');
    await selectOptionAt(binding, 7, 'Smart animate');
    await selectOptionAt(binding, 8, 'Soft spring');

    const batches = onCommit.mock.calls.map((call) => call[0]);
    expect(batches.some((batch) => batch.commands[1]?.interaction.trigger === 'hover')).toBe(true);
    expect(batches.some((batch) => batch.commands[1]?.interaction.condition?.operator === 'eq')).toBe(true);
    expect(batches.some((batch) => batch.commands[1]?.interaction.transition?.preset === 'smart-animate')).toBe(true);
    expect(batches.some((batch) => batch.commands[1]?.interaction.transition?.easing === 'spring-soft')).toBe(true);
    expect(
      batches.some((batch) =>
        batch.commands[1]?.interaction.actions?.some(
          (action: { type: string; offsetMs?: number }) => action.type === 'seekTimeline' && action.offsetMs === 650
        )
      )
    ).toBe(true);
  });

  it('blocks every motion mutation when the inspector is read-only', () => {
    const project = createPremiumStarterProject('prototype-dom-disabled');
    const onCommit = vi.fn();
    render(
      <ConfigProvider>
        <PrototypeInspector
          project={project}
          selection={{ nodeIds: ['node-home-title'], anchorId: 'node-home-title' }}
          labels={labels}
          disabled
          onCommit={onCommit}
        />
      </ConfigProvider>
    );

    expect(screen.getByTestId('viu-create-timeline')).toBeDisabled();
    expect(screen.getByTestId('viu-add-scroll-binding')).toBeDisabled();
    fireEvent.click(screen.getByTestId('viu-create-timeline'));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('surfaces disconnected screens before Preview', () => {
    const project = createPremiumStarterProject('prototype-dom-warning');
    project.interactions = {};
    project.flows['flow-primary']!.interactionIds = [];
    Object.values(project.nodes).forEach((node) => {
      node.behaviorBindings = [];
    });

    render(
      <ConfigProvider>
        <PrototypeInspector
          project={project}
          selection={{ nodeIds: ['node-home-title'], anchorId: 'node-home-title' }}
          labels={labels}
          onCommit={vi.fn()}
        />
      </ConfigProvider>
    );

    expect(screen.getByText('1 disconnected screen(s)')).toBeInTheDocument();
    expect(screen.getByText('Collection')).toBeInTheDocument();
  });
});
