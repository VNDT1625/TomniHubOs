/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  applyViuTransaction,
  createPremiumStarterProject,
  resolveViuComponentInstance,
  type ViuCommand,
  type ViuProjectState,
  type ViuTransactionResult,
} from '@/common/viu';
import {
  createAppearanceViuBatch,
  createComponentInstanceViuBatch,
  createComponentSetViuBatch,
  createComponentViuBatch,
  createDetachInstanceViuBatch,
  createInstancePropertyViuBatch,
  createResetInstanceOverridesViuBatch,
  createInstanceVariantViuBatch,
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
    transactionId: `component-system-${sequence++}`,
    documentId: state.projectId,
    baseRevision: state.revision,
    actor: { id: 'component-test', kind: 'user' },
    origin: 'inspector',
    commands: [...commands],
    mode: 'commit',
    summary: 'component system test',
  });

const applyBatch = (state: ViuProjectState, batch: ViuAuthoringBatch): ViuTransactionResult =>
  applyCommands(state, batch.commands);

const acceptedState = (result: ViuTransactionResult): ViuProjectState => {
  expect(result.accepted).toBe(true);
  return result.state;
};

const createTitleComponent = (state: ViuProjectState): ViuProjectState =>
  acceptedState(
    applyBatch(
      state,
      createComponentViuBatch(state, selection('node-home-title'), {
        componentId: 'component-title',
        name: 'Display title',
      })
    )
  );

describe('VIU component authoring system', () => {
  it('renders a typed text override from one reusable instance', () => {
    const componentState = createTitleComponent(createPremiumStarterProject());
    const instanceState = acceptedState(
      applyBatch(
        componentState,
        createComponentInstanceViuBatch(componentState, selection('node-home-title'), { instanceId: 'instance-title' })
      )
    );
    const propertyId = 'component-title:text:node-home-title';
    const overridden = acceptedState(
      applyBatch(
        instanceState,
        createInstancePropertyViuBatch(instanceState, 'instance-title', propertyId, 'A reusable Vietnamese-ready title')
      )
    );
    const resolved = resolveViuComponentInstance(overridden, 'instance-title');

    expect(resolved?.nodes['instance-title']?.content?.text).toBe('A reusable Vietnamese-ready title');
    expect(overridden.nodes['instance-title']?.childIds).toEqual([]);
    expect(overridden.components['component-title']?.rootNodeId).toBe('node-home-title');
  });

  it('switches a variant axis to another component source', () => {
    const titleState = createTitleComponent(createPremiumStarterProject());
    const componentState = acceptedState(
      applyBatch(
        titleState,
        createComponentViuBatch(titleState, selection('node-home-copy'), {
          componentId: 'component-copy',
          name: 'Body copy',
        })
      )
    );
    const setState = acceptedState(
      applyBatch(
        componentState,
        createComponentSetViuBatch(componentState, selection('node-home-title', 'node-home-copy'), {
          componentSetId: 'set-copy',
          name: 'Copy variants',
          axisName: 'State',
        })
      )
    );
    const instanceState = acceptedState(
      applyBatch(
        setState,
        createComponentInstanceViuBatch(setState, selection('node-home-title'), {
          instanceId: 'instance-copy',
        })
      )
    );
    const switched = acceptedState(
      applyBatch(instanceState, createInstanceVariantViuBatch(instanceState, 'instance-copy', 'State', 'Body copy'))
    );

    expect(resolveViuComponentInstance(switched, 'instance-copy')?.component.id).toBe('component-copy');
    expect(switched.nodes['instance-copy']?.componentInstance?.variantSelection).toEqual({
      State: 'Body copy',
    });
  });

  it('detaches the visual result into real nodes and restores the instance on undo', () => {
    const componentState = createTitleComponent(createPremiumStarterProject());
    const instanceState = acceptedState(
      applyBatch(
        componentState,
        createComponentInstanceViuBatch(componentState, selection('node-home-title'), { instanceId: 'instance-detach' })
      )
    );
    const overridden = acceptedState(
      applyBatch(
        instanceState,
        createInstancePropertyViuBatch(
          instanceState,
          'instance-detach',
          'component-title:text:node-home-title',
          'Detached result'
        )
      )
    );
    const detachedResult = applyBatch(
      overridden,
      createDetachInstanceViuBatch(overridden, 'instance-detach', {
        idFactory: (kind, sourceId) => `detached-${kind}-${sourceId}`,
      })
    );
    const detached = acceptedState(detachedResult);

    expect(detached.nodes['instance-detach']).toBeUndefined();
    expect(detached.nodes['detached-node-node-home-title']?.content?.text).toBe('Detached result');
    expect(detached.nodes['detached-node-node-home-title']?.componentInstance).toBeUndefined();

    const undone = acceptedState(applyCommands(detached, detachedResult.inverseCommands));
    expect(undone.nodes['instance-detach']?.componentInstance?.componentId).toBe('component-title');
    expect(undone.nodes['detached-node-node-home-title']).toBeUndefined();
  });

  it('inherits main-component appearance and records only explicit instance style overrides', () => {
    const base = createPremiumStarterProject();
    base.nodes['node-home-title']!.style.opacity = 0.35;
    const componentState = createTitleComponent(base);
    const instanceState = acceptedState(
      applyBatch(
        componentState,
        createComponentInstanceViuBatch(componentState, selection('node-home-title'), { instanceId: 'instance-style' })
      )
    );

    expect(resolveViuComponentInstance(instanceState, 'instance-style')?.nodes['instance-style']?.style.opacity).toBe(
      0.35
    );

    const overridden = acceptedState(
      applyBatch(
        instanceState,
        createAppearanceViuBatch(instanceState, selection('instance-style'), {
          opacity: 0.72,
          background: 'radial-gradient(circle, #ffffff 0%, #111111 100%)',
          borderStyle: 'dotted',
          shadow: '0px 8px 24px 0px rgba(0, 0, 0, 0.3)',
          blur: 2,
        })
      )
    );
    expect(overridden.nodes['instance-style']?.componentInstance?.styleOverrides).toEqual({
      opacity: 0.72,
      background: 'radial-gradient(circle, #ffffff 0%, #111111 100%)',
      borderStyle: 'dotted',
      shadow: '0px 8px 24px 0px rgba(0, 0, 0, 0.3)',
      blur: 2,
    });
    expect(resolveViuComponentInstance(overridden, 'instance-style')?.nodes['instance-style']?.style.opacity).toBe(
      0.72
    );

    const reset = acceptedState(
      applyBatch(overridden, createResetInstanceOverridesViuBatch(overridden, 'instance-style'))
    );
    expect(resolveViuComponentInstance(reset, 'instance-style')?.nodes['instance-style']?.style.opacity).toBe(0.35);
  });

  it('places a library instance absolutely in a regular screen even when its main component used flow', () => {
    const project = createPremiumStarterProject();
    project.nodes['node-home-title']!.positionMode = 'flow';
    const componentState = createTitleComponent(project);
    const batch = createComponentInstanceViuBatch(componentState, selection('node-home-title'), {
      instanceId: 'instance-showcase-title',
      targetParentId: 'node-showcase-root',
      position: { x: 144, y: 208 },
    });
    const inserted = acceptedState(applyBatch(componentState, batch));

    expect(inserted.nodes['instance-showcase-title']).toMatchObject({
      parentId: 'node-showcase-root',
      localTransform: [1, 0, 0, 1, 144, 208],
      positionMode: 'absolute',
    });
    expect(inserted.nodes['node-showcase-root']?.childIds.at(-1)).toBe('instance-showcase-title');
  });

  it('places a library instance in flow when the target screen uses auto layout', () => {
    const project = createPremiumStarterProject();
    project.nodes['node-showcase-root']!.layout = {
      mode: 'horizontal',
      gap: 16,
      padding: [24, 24, 24, 24],
      align: 'center',
      justify: 'start',
      wrap: false,
    };
    const componentState = createTitleComponent(project);
    const batch = createComponentInstanceViuBatch(componentState, selection('node-home-title'), {
      instanceId: 'instance-showcase-flow',
      targetParentId: 'node-showcase-root',
    });
    const inserted = acceptedState(applyBatch(componentState, batch));

    expect(inserted.nodes['instance-showcase-flow']?.positionMode).toBe('flow');
  });

  it('rejects inserting a library instance into an unknown target container', () => {
    const componentState = createTitleComponent(createPremiumStarterProject());

    expect(() =>
      createComponentInstanceViuBatch(componentState, selection('node-home-title'), {
        instanceId: 'instance-without-target',
        targetParentId: 'missing-root',
      })
    ).toThrow('Target parent missing-root does not exist');
  });

  it('rejects corrupting a main component and wrong-typed overrides', () => {
    const componentState = createTitleComponent(createPremiumStarterProject());
    const deletion = applyCommands(componentState, [{ type: 'deleteNode', nodeId: 'node-home-title' }]);

    expect(deletion.accepted).toBe(false);
    expect(deletion.conflict?.message).toContain('must be removed');

    const instanceState = acceptedState(
      applyBatch(
        componentState,
        createComponentInstanceViuBatch(componentState, selection('node-home-title'), {
          instanceId: 'instance-invalid',
        })
      )
    );
    expect(() =>
      createInstancePropertyViuBatch(instanceState, 'instance-invalid', 'component-title:text:node-home-title', false)
    ).toThrow('wrong value type');
  });
});
