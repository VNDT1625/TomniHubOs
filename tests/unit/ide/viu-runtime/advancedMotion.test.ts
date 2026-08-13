/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createPremiumStarterProject } from '@/common/viu/starter';
import {
  compileViuSite,
  createViuRuntimeState,
  reduceViuRuntime,
  resolveViuRuntimeNodeMotion,
  type ViuRuntimeContract,
} from '@/common/viu/runtime';

function motionContract(): ViuRuntimeContract {
  return {
    schemaVersion: 1,
    timelines: {
      hero: {
        name: 'Hero entrance',
        durationMs: 1_000,
        tracks: [
          {
            id: 'hero-x',
            nodeId: 'node-home-title',
            property: 'x',
            keyframes: [
              { offsetMs: 0, value: 0 },
              { offsetMs: 1_000, value: 100, easing: 'linear' },
            ],
          },
          {
            id: 'hero-opacity',
            nodeId: 'node-home-title',
            property: 'opacity',
            keyframes: [
              { offsetMs: 0, value: 0 },
              { offsetMs: 1_000, value: 1 },
            ],
          },
        ],
      },
    },
  };
}

describe('VIU advanced motion runtime', () => {
  it('applies ordered conditional actions against state produced by earlier actions', () => {
    const project = createPremiumStarterProject();
    project.variables.flag = { id: 'flag', name: 'Flag', type: 'boolean', value: false };
    project.variables.count = { id: 'count', name: 'Count', type: 'number', value: 0 };
    const contract: ViuRuntimeContract = {
      schemaVersion: 1,
      interactions: {
        'interaction-home-showcase': {
          actions: [
            { action: { type: 'setVariable', variableId: 'flag', value: true } },
            { action: { type: 'toggleVariable', variableId: 'flag' } },
            {
              action: { type: 'setVariable', variableId: 'count', value: 2 },
              condition: { variableId: 'flag', operator: 'falsy' },
            },
            { action: { type: 'navigate', targetScreenId: 'screen-showcase' } },
          ],
        },
      },
    };
    const plan = compileViuSite(project, contract);
    const initial = reduceViuRuntime(plan, createViuRuntimeState(plan), { type: 'consumeEffect' });

    const next = reduceViuRuntime(plan, initial, { type: 'activateNode', nodeId: 'node-home-cta' });

    expect(next.variables).toMatchObject({ flag: false, count: 2 });
    expect(next.currentRoute).toBe('/collection');
    expect(next.trace.at(-1)?.actionTypes).toEqual(['setVariable', 'toggleVariable', 'setVariable', 'navigate']);
  });

  it('records a deterministic ignored trace when an interaction condition is false', () => {
    const project = createPremiumStarterProject();
    project.variables.flag = { id: 'flag', name: 'Flag', type: 'boolean', value: false };
    const plan = compileViuSite(project, {
      schemaVersion: 1,
      interactions: {
        'interaction-home-showcase': {
          action: { type: 'navigate', targetScreenId: 'screen-showcase' },
          condition: { variableId: 'flag', operator: 'truthy' },
        },
      },
    });
    const state = createViuRuntimeState(plan);

    const next = reduceViuRuntime(plan, state, { type: 'activateNode', nodeId: 'node-home-cta' });

    expect(next.currentRoute).toBe('/');
    expect(next.trace.at(-1)?.reason).toBe('condition-false');
  });

  it('plays, samples, pauses, and seeks timeline keyframes', () => {
    const plan = compileViuSite(createPremiumStarterProject(), motionContract());
    let state = reduceViuRuntime(plan, createViuRuntimeState(plan), { type: 'consumeEffect' });

    state = reduceViuRuntime(plan, state, { type: 'playTimeline', timelineId: 'hero' });
    state = reduceViuRuntime(plan, state, { type: 'tickTimeline', timelineId: 'hero', deltaMs: 500 });

    expect(resolveViuRuntimeNodeMotion(plan, state, 'node-home-title')).toMatchObject({ x: 50, opacity: 0.5 });
    state = reduceViuRuntime(plan, state, { type: 'pauseTimeline', timelineId: 'hero' });
    expect(state.timelines.hero).toEqual({ status: 'paused', currentMs: 500 });

    state = reduceViuRuntime(plan, state, { type: 'seekTimeline', timelineId: 'hero', offsetMs: 900 });
    expect(state.timelines.hero?.currentMs).toBe(900);
  });

  it('jumps timeline playback to the stable end state when reduced motion is enabled', () => {
    const plan = compileViuSite(createPremiumStarterProject(), motionContract());
    let state = createViuRuntimeState(plan, { reducedMotion: true });
    state = reduceViuRuntime(plan, state, { type: 'consumeEffect' });

    state = reduceViuRuntime(plan, state, { type: 'playTimeline', timelineId: 'hero' });

    expect(state.timelines.hero).toEqual({ status: 'finished', currentMs: 1_000 });
    expect(state.pendingEffect?.transition.durationMs).toBe(0);
  });

  it('links scroll progress to timeline position, pinning, and parallax checkpoints', () => {
    const contract = motionContract();
    contract.scrollBindings = {
      story: {
        nodeId: 'node-home-title',
        timelineId: 'hero',
        start: 0,
        end: 1,
        pin: true,
        parallax: 100,
      },
    };
    const plan = compileViuSite(createPremiumStarterProject(), contract);
    const state = reduceViuRuntime(plan, createViuRuntimeState(plan), {
      type: 'setScrollProgress',
      bindingId: 'story',
      progress: 0.75,
    });

    expect(state.timelines.hero?.currentMs).toBe(750);
    expect(resolveViuRuntimeNodeMotion(plan, state, 'node-home-title')).toMatchObject({
      x: 75,
      opacity: 0.75,
      pinned: true,
      parallaxY: 25,
      scrollProgress: 0.75,
    });
  });

  it('compiles authored scroll bindings by default and lets explicit runtime contracts override them', () => {
    const project = createPremiumStarterProject('authored-scroll');
    const authoredTimeline = motionContract().timelines!.hero!;
    project.timelines.hero = {
      id: 'hero',
      name: authoredTimeline.name,
      durationMs: authoredTimeline.durationMs,
      loop: authoredTimeline.loop,
      tracks: authoredTimeline.tracks,
    };
    project.scrollBindings = {
      story: {
        id: 'story',
        nodeId: 'node-home-title',
        timelineId: 'hero',
        start: 0,
        end: 1,
        pin: true,
        parallax: 100,
      },
    };

    const authoredPlan = compileViuSite(project);
    expect(authoredPlan.scrollBindings.story).toMatchObject({
      nodeId: 'node-home-title',
      timelineId: 'hero',
      pin: true,
      parallax: 100,
    });

    const overriddenPlan = compileViuSite(project, {
      schemaVersion: 1,
      scrollBindings: {
        story: {
          nodeId: 'node-home-title',
          timelineId: 'hero',
          start: 0.2,
          end: 0.8,
          pin: false,
          parallax: 40,
        },
      },
    });
    expect(overriddenPlan.scrollBindings.story).toMatchObject({
      start: 0.2,
      end: 0.8,
      pin: false,
      parallax: 40,
    });
  });

  it('matches smart-animate elements by stable authored keys across screens', () => {
    const plan = compileViuSite(createPremiumStarterProject(), {
      schemaVersion: 1,
      nodes: {
        'node-home-title': { smartAnimateKey: 'hero-title' },
        'node-showcase-title': { smartAnimateKey: 'hero-title' },
      },
      routeTransition: {
        preset: 'smart-animate',
        trigger: 'click',
        durationMs: 400,
        easing: 'ease-out',
      },
    });
    const initial = reduceViuRuntime(plan, createViuRuntimeState(plan), { type: 'consumeEffect' });

    const next = reduceViuRuntime(plan, initial, { type: 'activateNode', nodeId: 'node-home-cta' });

    expect(next.pendingEffect?.type).toBe('route');
    expect(next.pendingEffect?.type === 'route' ? next.pendingEffect.smartAnimateMatches : []).toEqual([
      {
        key: 'hero-title',
        fromNodeId: 'node-home-title',
        toNodeId: 'node-showcase-title',
      },
    ]);
  });

  it('reports invalid timeline and scroll references instead of executing them', () => {
    const plan = compileViuSite(createPremiumStarterProject(), {
      schemaVersion: 1,
      timelines: {
        broken: {
          name: 'Broken',
          durationMs: 1_000,
          tracks: [
            {
              id: 'missing-track',
              nodeId: 'missing-node',
              property: 'x',
              keyframes: [{ offsetMs: 0, value: 0 }],
            },
          ],
        },
      },
      scrollBindings: {
        broken: { nodeId: 'missing-node', timelineId: 'missing-timeline' },
      },
    });

    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['invalid-timeline', 'invalid-scroll-binding'])
    );
  });
});
