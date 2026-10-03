/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { ConfigProvider } from '@arco-design/web-react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPremiumStarterProject } from '@/common/viu';
import LayoutInspector from '@package-apps/design/renderer/viu/next/authoring/LayoutInspector';
import type { ViuLayoutInspectorLabels } from '@package-apps/design/renderer/viu/next/authoring/types';

const labels = new Proxy(
  {},
  {
    get: (_target, property) => (property === 'guideCount' ? (count: number) => `${count} guides` : String(property)),
  }
) as ViuLayoutInspectorLabels;

const innerInput = (testId: string): HTMLInputElement => {
  const host = screen.getByTestId(testId);
  if (host instanceof HTMLInputElement) return host;
  const input = host.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`No input found for ${testId}`);
  return input;
};

const selectOption = async (testId: string, label: string): Promise<void> => {
  fireEvent.click(screen.getByTestId(testId));
  const matches = await screen.findAllByText(label);
  const option = matches.find((match) => match.closest('.arco-select-option'));
  if (!option) throw new Error(`No option ${label} found for ${testId}`);
  fireEvent.click(option.closest('.arco-select-option')!);
};

afterEach(cleanup);

describe('VIU responsive precision inspector', () => {
  it('authors a new guide as one precision batch', () => {
    const project = createPremiumStarterProject('layout-inspector-guide');
    const onCommit = vi.fn();

    render(
      <ConfigProvider>
        <LayoutInspector
          project={project}
          selection={{ nodeIds: ['node-home-title'], anchorId: 'node-home-title' }}
          labels={labels}
          onCommit={onCommit}
        />
      </ConfigProvider>
    );
    fireEvent.click(screen.getByTestId('viu-add-horizontal-guide'));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({
      intent: 'precision',
      commands: [{ type: 'setGuides' }],
    });
  });

  it('authors independent object snapping without changing the other precision settings', () => {
    const project = createPremiumStarterProject('layout-inspector-snap');
    project.snapSettings = {
      enabled: true,
      pixelGrid: 8,
      threshold: 4,
      snapToGuides: true,
      snapToObjects: true,
    };
    const onCommit = vi.fn();

    render(
      <ConfigProvider>
        <LayoutInspector
          project={project}
          selection={{ nodeIds: ['node-home-title'], anchorId: 'node-home-title' }}
          labels={labels}
          onCommit={onCommit}
        />
      </ConfigProvider>
    );
    fireEvent.click(screen.getByTestId('viu-snap-objects'));

    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({
      intent: 'precision',
      commands: [
        {
          type: 'setSnapSettings',
          settings: {
            enabled: true,
            pixelGrid: 8,
            threshold: 4,
            snapToGuides: true,
            snapToObjects: false,
          },
        },
      ],
    });
  });

  it('authors breakpoint dimensions and visibility as sparse responsive edits', async () => {
    const project = createPremiumStarterProject('layout-inspector-responsive');
    const onCommit = vi.fn();
    render(
      <ConfigProvider>
        <LayoutInspector
          project={project}
          selection={{ nodeIds: ['node-home-title'], anchorId: 'node-home-title' }}
          labels={labels}
          onCommit={onCommit}
        />
      </ConfigProvider>
    );

    await selectOption('viu-layout-breakpoint', 'Tablet');
    fireEvent.change(innerInput('viu-breakpoint-min-width'), { target: { value: '720' } });
    fireEvent.change(innerInput('viu-breakpoint-max-width'), { target: { value: '1100' } });
    fireEvent.change(innerInput('viu-responsive-width'), { target: { value: '640' } });
    fireEvent.change(innerInput('viu-responsive-height'), { target: { value: '180' } });
    fireEvent.click(screen.getByTestId('viu-responsive-visible'));

    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({
      intent: 'responsive',
      commands: [{ type: 'upsertBreakpoint', breakpoint: { id: 'tablet', minWidth: 720 } }],
    });
    expect(onCommit.mock.calls[2]?.[0]).toMatchObject({
      intent: 'responsive',
      commands: [{ type: 'updateNode', nodeId: 'node-home-title' }],
    });
    expect(onCommit.mock.calls.at(-1)?.[0].commands[0].patch.responsiveOverrides.tablet.visible).toBe(false);
  });

  it('switches design-system modes and binds typed variables from the inspector', async () => {
    const project = createPremiumStarterProject('layout-inspector-variables');
    const onCommit = vi.fn();
    render(
      <ConfigProvider>
        <LayoutInspector
          project={project}
          selection={{ nodeIds: ['node-home-title'], anchorId: 'node-home-title' }}
          labels={labels}
          onCommit={onCommit}
        />
      </ConfigProvider>
    );

    await selectOption('viu-variable-mode-foundation', 'Brand');
    await selectOption('viu-variable-background', 'Color / Accent');
    await selectOption('viu-variable-gap', 'Space / Medium');

    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({
      intent: 'design-system',
      commands: [{ type: 'setVariableMode', collectionId: 'foundation', modeId: 'brand' }],
    });
    expect(onCommit.mock.calls[1]?.[0].commands[0].patch.variableBindings['style.background']).toEqual({
      variableId: 'color-accent',
    });
    expect(onCommit.mock.calls[2]?.[0].commands[0].patch.variableBindings['layout.gap']).toEqual({
      variableId: 'space-md',
    });
  });

  it('authors rotation, corner radii, snapping, and guide lifecycle without losing precision settings', async () => {
    const project = createPremiumStarterProject('layout-inspector-precision');
    project.guides = [{ id: 'guide-horizontal-1', axis: 'horizontal', position: 120 }];
    const onCommit = vi.fn();
    render(
      <ConfigProvider>
        <LayoutInspector
          project={project}
          selection={{ nodeIds: ['node-home-title'], anchorId: 'node-home-title' }}
          labels={labels}
          onCommit={onCommit}
        />
      </ConfigProvider>
    );

    fireEvent.change(innerInput('viu-layout-rotation'), { target: { value: '12' } });
    fireEvent.change(innerInput('viu-corner-radius-2'), { target: { value: '24' } });
    fireEvent.change(innerInput('viu-snap-grid'), { target: { value: '8' } });
    fireEvent.change(innerInput('viu-snap-threshold'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('viu-snap-guides'));
    fireEvent.click(screen.getByTestId('viu-add-vertical-guide'));
    fireEvent.change(innerInput('viu-guide-position-guide-horizontal-1'), { target: { value: '160' } });
    fireEvent.click(screen.getByTestId('viu-remove-guide-guide-horizontal-1'));
    await selectOption('viu-stroke-alignment', 'strokeOutside');

    expect(onCommit.mock.calls[0]?.[0].commands[0].patch.localTransform).toBeDefined();
    expect(onCommit.mock.calls[1]?.[0].commands[0].patch.style.borderRadii).toEqual([0, 0, 24, 0]);
    expect(onCommit.mock.calls.filter(([batch]) => batch.intent === 'precision')).toHaveLength(6);
  });

  it('authors auto-layout spacing and child constraints for a responsive container', async () => {
    const project = createPremiumStarterProject('layout-inspector-auto-layout');
    project.nodes['node-home-title']!.layout = {
      mode: 'horizontal',
      gap: 16,
      padding: [8, 12, 8, 12],
      align: 'start',
      justify: 'start',
      wrap: false,
      columns: 2,
    };
    const onCommit = vi.fn();
    render(
      <ConfigProvider>
        <LayoutInspector
          project={project}
          selection={{ nodeIds: ['node-home-title'], anchorId: 'node-home-title' }}
          labels={labels}
          onCommit={onCommit}
        />
      </ConfigProvider>
    );

    fireEvent.change(innerInput('viu-layout-gap'), { target: { value: '28' } });
    fireEvent.click(screen.getByTestId('viu-layout-wrap'));
    fireEvent.change(innerInput('viu-layout-padding-1'), { target: { value: '20' } });
    fireEvent.change(innerInput('viu-layout-minWidth'), { target: { value: '320' } });
    await selectOption('viu-layout-mode', 'grid');
    await selectOption('viu-layout-position', 'absolute');
    await selectOption('viu-layout-width-sizing', 'fill');
    await selectOption('viu-layout-horizontal-constraint', 'right');

    expect(onCommit.mock.calls[0]?.[0].commands[0].patch.layout.gap).toBe(28);
    expect(onCommit.mock.calls[2]?.[0].commands[0].patch.layout.padding).toEqual([8, 20, 8, 12]);
    expect(onCommit.mock.calls.at(-1)?.[0].commands[0].patch.constraints.horizontal).toBe('right');
  });

  it('renders no editor when the selection has no surviving node', () => {
    const project = createPremiumStarterProject('layout-inspector-empty');
    render(
      <ConfigProvider>
        <LayoutInspector
          project={project}
          selection={{ nodeIds: ['missing-node'], anchorId: 'missing-node' }}
          labels={labels}
          onCommit={vi.fn()}
        />
      </ConfigProvider>
    );

    expect(screen.queryByTestId('viu-layout-inspector')).not.toBeInTheDocument();
  });

  it('disables precision authoring for a locked selection', () => {
    const project = createPremiumStarterProject('layout-inspector-locked');
    project.nodes['node-home-title']!.locked = true;

    render(
      <ConfigProvider>
        <LayoutInspector
          project={project}
          selection={{ nodeIds: ['node-home-title'], anchorId: 'node-home-title' }}
          labels={labels}
          onCommit={vi.fn()}
        />
      </ConfigProvider>
    );

    expect(screen.getByTestId('viu-add-horizontal-guide')).toBeDisabled();
  });
});
