/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { applyViuTransaction, createPremiumStarterProject, validateViuProject } from '@/common/viu';
import { compileViuSite } from '@/common/viu/runtime';
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
} from '@/common/viu/authoring';
import type { ViuProjectState } from '@/common/viu';

const applyBatch = (state: ViuProjectState, batch: ViuAuthoringBatch): ViuProjectState => {
  const result = applyViuTransaction(state, {
    transactionId: `prototype-${state.revision}`,
    documentId: state.projectId,
    baseRevision: state.revision,
    actor: { id: 'prototype-test', kind: 'user' },
    origin: 'inspector',
    commands: [...batch.commands],
    mode: 'commit',
    summary: batch.intent,
  });
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.conflict?.message);
  return result.state;
};

describe('VIU prototype authoring operations', () => {
  it('creates, edits, previews, and removes one interaction atomically', () => {
    const initial = createPremiumStarterProject('prototype-project');
    const created = applyBatch(
      initial,
      createInteractionViuBatch(initial, {
        id: 'interaction-focus-overlay',
        flowId: 'flow-primary',
        sourceNodeId: 'node-home-title',
        trigger: 'focus',
        action: { type: 'openOverlay', targetNodeId: 'node-showcase-card' },
        transition: { preset: 'scale', durationMs: 420, easing: 'spring-soft' },
      })
    );

    expect(created.nodes['node-home-title']?.behaviorBindings).toContain('interaction-focus-overlay');
    const updated = applyBatch(
      created,
      createUpdateInteractionViuBatch(created, 'interaction-focus-overlay', {
        trigger: 'click',
        action: { type: 'navigate', targetScreenId: 'screen-showcase' },
        transition: { preset: 'slide-left', durationMs: 360, easing: 'ease-in-out' },
      })
    );
    expect(updated.interactions['interaction-focus-overlay']?.version).toBe(2);

    const compiled = compileViuSite(updated);
    expect(compiled.interactions['interaction-focus-overlay']?.transition).toMatchObject({
      preset: 'slide-left',
      durationMs: 360,
      easing: 'ease-in-out',
    });

    const removed = applyBatch(updated, createDeleteInteractionViuBatch(updated, 'interaction-focus-overlay'));
    expect(removed.interactions['interaction-focus-overlay']).toBeUndefined();
  });

  it('authors ordered variable and timeline actions with a shared condition', () => {
    const initial = createPremiumStarterProject('prototype-ordered-actions');
    initial.variables.ready = { id: 'ready', name: 'Ready', type: 'boolean', value: false };
    initial.timelines.hero = { id: 'hero', name: 'Hero', durationMs: 800, tracks: [] };

    const batch = createInteractionViuBatch(initial, {
      id: 'interaction-ordered',
      flowId: 'flow-primary',
      sourceNodeId: 'node-home-title',
      trigger: 'submit',
      action: { type: 'navigate', targetScreenId: 'screen-showcase' },
      actions: [
        { type: 'toggleVariable', variableId: 'ready' },
        { type: 'playTimeline', timelineId: 'hero' },
        { type: 'navigate', targetScreenId: 'screen-showcase' },
      ],
      condition: { variableId: 'ready', operator: 'falsy' },
      transition: { preset: 'smart-animate', durationMs: 360, easing: 'ease-out' },
    });
    const created = applyBatch(initial, batch);
    const authored = created.interactions['interaction-ordered']!;

    expect(authored.action).toEqual({ type: 'toggleVariable', variableId: 'ready' });
    expect(compileViuSite(created).interactions['interaction-ordered']?.actions).toMatchObject([
      { action: { type: 'toggleVariable' }, condition: { operator: 'falsy' } },
      { action: { type: 'playTimeline' }, condition: { operator: 'falsy' } },
      { action: { type: 'navigate' }, condition: { operator: 'falsy' } },
    ]);
  });

  it('rejects an invalid target in any ordered action', () => {
    const state = createPremiumStarterProject('prototype-invalid-ordered');
    expect(() =>
      createInteractionViuBatch(state, {
        id: 'interaction-invalid-ordered',
        flowId: 'flow-primary',
        sourceNodeId: 'node-home-title',
        trigger: 'click',
        action: { type: 'navigate', targetScreenId: 'screen-showcase' },
        actions: [
          { type: 'navigate', targetScreenId: 'screen-showcase' },
          { type: 'toggleVariable', variableId: 'missing-variable' },
        ],
        transition: { preset: 'fade', durationMs: 280, easing: 'ease-out' },
      })
    ).toThrow('Variable missing-variable does not exist');
  });

  it('rejects missing targets before producing a transaction batch', () => {
    const state = createPremiumStarterProject('prototype-invalid');
    expect(() =>
      createInteractionViuBatch(state, {
        id: 'interaction-missing',
        flowId: 'flow-primary',
        sourceNodeId: 'node-home-title',
        trigger: 'click',
        action: { type: 'navigate', targetScreenId: 'screen-missing' },
        transition: { preset: 'fade', durationMs: 280, easing: 'ease-out' },
      })
    ).toThrow('Target screen screen-missing does not exist.');
  });

  it('authors timeline tracks and scroll bindings through atomic command batches', () => {
    const initial = createPremiumStarterProject('prototype-motion');
    const withTimeline = applyBatch(
      initial,
      createTimelineViuBatch(initial, {
        id: 'timeline-hero',
        name: 'Hero reveal',
        durationMs: 1200,
        loop: false,
        tracks: [
          {
            id: 'track-title-opacity',
            nodeId: 'node-home-title',
            property: 'opacity',
            keyframes: [
              { offsetMs: 0, value: 0 },
              { offsetMs: 1200, value: 1, easing: 'ease-out' },
            ],
          },
        ],
      })
    );
    const updated = applyBatch(
      withTimeline,
      createUpdateTimelineViuBatch(withTimeline, 'timeline-hero', { durationMs: 1400, loop: true })
    );
    const withScroll = applyBatch(
      updated,
      createUpsertScrollBindingViuBatch(updated, {
        id: 'scroll-title',
        nodeId: 'node-home-title',
        timelineId: 'timeline-hero',
        start: 0.1,
        end: 0.8,
        pin: true,
        parallax: 120,
      })
    );

    expect(withScroll.timelines['timeline-hero']).toMatchObject({ durationMs: 1400, loop: true });
    expect(withScroll.scrollBindings?.['scroll-title']).toMatchObject({ pin: true, parallax: 120 });

    const withoutScroll = applyBatch(withScroll, createDeleteScrollBindingViuBatch(withScroll, 'scroll-title'));
    const withoutTimeline = applyBatch(withoutScroll, createDeleteTimelineViuBatch(withoutScroll, 'timeline-hero'));
    expect(withoutTimeline.timelines['timeline-hero']).toBeUndefined();
  });

  it('reports screens that Preview cannot reach from any flow', () => {
    const state = createPremiumStarterProject('prototype-orphan');
    state.interactions = {};
    state.flows['flow-primary']!.interactionIds = [];
    Object.values(state.nodes).forEach((node) => {
      node.behaviorBindings = [];
    });

    expect(validateViuProject(state)).toContainEqual(
      expect.objectContaining({ code: 'orphan-screen', entityId: 'screen-showcase', severity: 'warning' })
    );
  });
});
