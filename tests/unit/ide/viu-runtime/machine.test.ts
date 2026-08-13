/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createPremiumStarterProject, createViuNode } from '@/common/viu';
import { compileViuSite, createViuRuntimeState, reduceViuRuntime } from '@/common/viu/runtime';

const createRuntime = (reducedMotion = false) => {
  const plan = compileViuSite(structuredClone(createPremiumStarterProject()));
  return { plan, state: createViuRuntimeState(plan, { reducedMotion }) };
};

describe('VIU website runtime machine', () => {
  it('starts at the declared flow screen even when it is a later section on the same route', () => {
    const project = structuredClone(createPremiumStarterProject());
    project.screens['screen-showcase']!.route = '/';
    project.flows['flow-primary']!.startScreenId = 'screen-showcase';
    const plan = compileViuSite(project);

    const state = createViuRuntimeState(plan);

    expect(state.activeScreenId).toBe('screen-showcase');
    expect(state.pendingEffect).toMatchObject({
      type: 'route',
      screenId: 'screen-showcase',
      anchorId: 'viu-screen-showcase',
    });
  });

  it('navigates through a button interaction and records an auditable trace', () => {
    const { plan, state } = createRuntime();

    const next = reduceViuRuntime(plan, state, { type: 'activateNode', nodeId: 'node-home-cta' });

    expect(next.currentRoute).toBe('/collection');
    expect(next.trace.at(-1)).toMatchObject({
      status: 'applied',
      sourceNodeId: 'node-home-cta',
      interactionId: 'interaction-home-showcase',
      actionType: 'navigate',
    });
  });

  it('inherits the main component interaction when an instance is activated', () => {
    const project = createPremiumStarterProject();
    project.components['component-cta'] = {
      id: 'component-cta',
      version: 1,
      name: 'CTA',
      rootNodeId: 'node-home-cta',
      variantProperties: {},
      propertyDefinitions: {},
    };
    const instance = createViuNode({
      id: 'node-home-cta-instance',
      name: 'CTA instance',
      type: 'component-instance',
      parentId: 'node-home-root',
      x: 280,
      y: 620,
      width: project.nodes['node-home-cta']!.size.width,
      height: project.nodes['node-home-cta']!.size.height,
    });
    instance.componentInstance = {
      componentId: 'component-cta',
      variantSelection: {},
      propertyValues: {},
      styleOverrides: {},
    };
    project.nodes[instance.id] = instance;
    project.nodes['node-home-root']!.childIds.push(instance.id);
    const plan = compileViuSite(project);
    const state = createViuRuntimeState(plan);

    const next = reduceViuRuntime(plan, state, {
      type: 'activateNode',
      nodeId: instance.id,
    });

    expect(plan.interactionIdsBySource[instance.id]).toContain('interaction-home-showcase');
    expect(next.currentRoute).toBe('/collection');
    expect(next.trace.at(-1)).toMatchObject({
      status: 'applied',
      sourceNodeId: instance.id,
      interactionId: 'interaction-home-showcase',
    });
  });

  it('closes open overlays when direct navigation changes the website route', () => {
    const { plan, state } = createRuntime();
    const withOverlay = { ...state, overlayNodeIds: ['node-home-spatial'] };

    const next = reduceViuRuntime(plan, withOverlay, { type: 'navigate', route: '/collection' });

    expect(next.currentRoute).toBe('/collection');
    expect(next.overlayNodeIds).toEqual([]);
  });

  it('returns to the prior route with deterministic history', () => {
    const { plan, state } = createRuntime();
    const collection = reduceViuRuntime(plan, state, { type: 'activateNode', nodeId: 'node-home-cta' });

    const home = reduceViuRuntime(plan, collection, { type: 'back' });

    expect(home.currentRoute).toBe('/');
    expect(home.history).toEqual([]);
  });

  it('records an ignored event instead of guessing when a node has no interaction', () => {
    const { plan, state } = createRuntime();

    const next = reduceViuRuntime(plan, state, { type: 'activateNode', nodeId: 'node-home-title' });

    expect(next.currentRoute).toBe('/');
    expect(next.trace.at(-1)).toMatchObject({ status: 'ignored', reason: 'interaction-not-found' });
  });

  it('removes transition duration and preset when reduced motion is requested', () => {
    const { plan, state } = createRuntime(true);

    const next = reduceViuRuntime(plan, state, { type: 'activateNode', nodeId: 'node-home-cta' });

    expect(next.pendingEffect?.transition.durationMs).toBe(0);
    expect(next.pendingEffect?.transition.preset).toBe('none');
  });

  it('selects responsive breakpoints from contract thresholds', () => {
    const { plan, state } = createRuntime();

    const next = reduceViuRuntime(plan, state, { type: 'setViewport', width: 520, height: 800 });

    expect(next.viewport.breakpoint).toBe('mobile');
  });
});
