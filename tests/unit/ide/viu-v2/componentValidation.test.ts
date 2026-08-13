/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  applyViuTransaction,
  createPremiumStarterProject,
  validateViuProjectStructure,
  type ViuCommand,
  type ViuProjectState,
  type ViuTransactionResult,
} from '@/common/viu';
import {
  createComponentInstanceViuBatch,
  createComponentSetViuBatch,
  createComponentViuBatch,
  createDetachInstanceViuBatch,
  type ViuAuthoringBatch,
  type ViuSelection,
} from '@/common/viu/authoring';

let sequence = 0;

const selection = (...nodeIds: string[]): ViuSelection => ({
  nodeIds,
  anchorId: nodeIds.at(-1) ?? null,
});

const applyCommands = (state: ViuProjectState, commands: readonly ViuCommand[]): ViuTransactionResult =>
  applyViuTransaction(state, {
    transactionId: `component-validation-${sequence++}`,
    documentId: state.projectId,
    baseRevision: state.revision,
    actor: { id: 'component-validation-test', kind: 'user' },
    origin: 'inspector',
    commands: [...commands],
    mode: 'commit',
    summary: 'component validation test',
  });

const acceptedState = (result: ViuTransactionResult): ViuProjectState => {
  if (!result.accepted) throw new Error(result.conflict?.message ?? 'Component setup failed.');
  return result.state;
};

const applyBatch = (state: ViuProjectState, batch: ViuAuthoringBatch): ViuTransactionResult =>
  applyCommands(state, batch.commands);

const createVariantInstanceProject = (): ViuProjectState => {
  let state = createPremiumStarterProject('component-validation-project');
  state = acceptedState(
    applyBatch(
      state,
      createComponentViuBatch(state, selection('node-home-title'), {
        componentId: 'component-title',
        name: 'Title',
      })
    )
  );
  state = acceptedState(
    applyBatch(
      state,
      createComponentViuBatch(state, selection('node-home-copy'), {
        componentId: 'component-copy',
        name: 'Copy',
      })
    )
  );
  state = acceptedState(
    applyBatch(
      state,
      createComponentSetViuBatch(state, selection('node-home-title', 'node-home-copy'), {
        componentSetId: 'component-set-copy',
        name: 'Copy variants',
        axisName: 'State',
      })
    )
  );
  return acceptedState(
    applyBatch(
      state,
      createComponentInstanceViuBatch(state, selection('node-home-title'), {
        instanceId: 'component-instance-copy',
      })
    )
  );
};

const cloneProject = (state: ViuProjectState): ViuProjectState => structuredClone(state);

describe('VIU component structural validation', () => {
  it('rejects an instance selection that omits an axis required by its component set', () => {
    const state = cloneProject(createVariantInstanceProject());
    state.nodes['component-instance-copy']!.componentInstance!.variantSelection = {};

    expect(validateViuProjectStructure(state)).toEqual({
      valid: false,
      message: expect.stringContaining('missing variant'),
    });
  });

  it('rejects an allowed axis value when no component implements the selected combination', () => {
    const state = cloneProject(createVariantInstanceProject());
    state.componentSets['component-set-copy']!.variantAxes.State!.push('Ghost');
    state.nodes['component-instance-copy']!.componentInstance!.variantSelection = { State: 'Ghost' };

    expect(validateViuProjectStructure(state)).toEqual({
      valid: false,
      message: expect.stringContaining('does not resolve'),
    });
  });

  it('rejects duplicate component variant combinations that make resolution ambiguous', () => {
    const state = cloneProject(createVariantInstanceProject());
    state.components['component-copy']!.variantProperties = { State: 'Title' };

    expect(validateViuProjectStructure(state)).toEqual({
      valid: false,
      message: expect.stringContaining('duplicate variant'),
    });
  });

  it('atomically rejects an unknown instance property override', () => {
    const state = createVariantInstanceProject();
    const instance = state.nodes['component-instance-copy']!.componentInstance!;
    const result = applyCommands(state, [
      {
        type: 'updateNode',
        nodeId: 'component-instance-copy',
        patch: {
          componentInstance: {
            ...structuredClone(instance),
            propertyValues: { ...structuredClone(instance.propertyValues), unknown: 'value' },
          },
        },
      },
    ]);

    expect(result.accepted).toBe(false);
    expect(result.conflict?.kind).toBe('validation');
    expect(result.state).toBe(state);
  });

  it('preserves and remaps incoming interactions when an instance is detached', () => {
    const state = createVariantInstanceProject();
    const withIncoming = acceptedState(
      applyCommands(state, [
        {
          type: 'connectInteraction',
          interaction: {
            id: 'interaction-incoming-instance',
            version: 1,
            flowId: 'flow-primary',
            sourceNodeId: 'node-home-cta',
            trigger: 'click',
            action: { type: 'scrollTo', targetNodeId: 'component-instance-copy' },
          },
        },
      ])
    );
    const detached = acceptedState(
      applyBatch(
        withIncoming,
        createDetachInstanceViuBatch(withIncoming, 'component-instance-copy', {
          idFactory: (kind, sourceId) => `detached-${kind}-${sourceId}`,
        })
      )
    );

    expect(detached.interactions['interaction-incoming-instance']?.action).toEqual({
      type: 'scrollTo',
      targetNodeId: 'detached-node-node-home-title',
    });
    expect(detached.nodes['node-home-cta']?.behaviorBindings).toContain('interaction-incoming-instance');
  });
});
