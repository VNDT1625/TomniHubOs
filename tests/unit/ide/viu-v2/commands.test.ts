/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  applyViuTransaction,
  createPremiumStarterProject,
  createViuNode,
  validateViuProject,
  type ViuCommand,
  type ViuProjectState,
  type ViuTransaction,
} from '@/common/viu';

function transaction(
  state: ViuProjectState,
  commands: ViuCommand[],
  mode: ViuTransaction['mode'] = 'commit',
  overrides: Partial<ViuTransaction> = {}
): ViuTransaction {
  return {
    transactionId: 'transaction-test',
    documentId: state.projectId,
    baseRevision: state.revision,
    actor: { id: 'user-test', kind: 'user' },
    origin: 'canvas',
    commands,
    mode,
    summary: 'Test edit',
    ...overrides,
  };
}

describe('VIU V2 command document engine', () => {
  it('opens a premium normalized starter with two reachable screens', () => {
    const state = createPremiumStarterProject('project-test');

    expect(state.schemaVersion).toBe(3);
    expect(state.screenOrder).toEqual(['screen-home', 'screen-showcase']);
    expect(validateViuProject(state)).toEqual([]);
  });

  it('previews edits without advancing or mutating the authoritative state', () => {
    const state = createPremiumStarterProject();
    const result = applyViuTransaction(
      state,
      transaction(
        state,
        [{ type: 'updateNode', nodeId: 'node-home-title', patch: { content: { text: 'Preview only' } } }],
        'preview'
      )
    );

    expect(result.state.nodes['node-home-title']?.content?.text).toBe('Preview only');
    expect(result.revision).toBe(0);
    expect(state.nodes['node-home-title']?.content?.text).toBe('Matter, made\nimpossible.');
  });

  it('commits atomically and applies inverse commands as one undo', () => {
    const state = createPremiumStarterProject();
    const committed = applyViuTransaction(
      state,
      transaction(state, [
        { type: 'updateNode', nodeId: 'node-home-title', patch: { content: { text: 'A changed title' } } },
        { type: 'reorderNode', nodeId: 'node-home-cta', index: 0 },
      ])
    );
    const undone = applyViuTransaction(
      committed.state,
      transaction(committed.state, committed.inverseCommands, 'commit', { transactionId: 'transaction-undo' })
    );

    expect(committed.revision).toBe(1);
    expect(undone.state.nodes['node-home-title']?.content?.text).toBe('Matter, made\nimpossible.');
    expect(undone.state.nodes['node-home-root']?.childIds.indexOf('node-home-cta')).toBe(3);
  });

  it('rejects a stale base revision without producing partial output', () => {
    const state = createPremiumStarterProject();
    const result = applyViuTransaction(
      state,
      transaction(state, [{ type: 'updateNode', nodeId: 'node-home-title', patch: { name: 'Stale edit' } }], 'commit', {
        baseRevision: 12,
      })
    );

    expect(result.accepted).toBe(false);
    expect(result.state).toBe(state);
    expect(result.conflict?.kind).toBe('revision');
  });

  it('rejects every command when a later command is invalid', () => {
    const state = createPremiumStarterProject();
    const result = applyViuTransaction(
      state,
      transaction(state, [
        { type: 'updateNode', nodeId: 'node-home-title', patch: { name: 'Must roll back' } },
        { type: 'deleteNode', nodeId: 'node-does-not-exist' },
      ])
    );

    expect(result.accepted).toBe(false);
    expect(result.state.nodes['node-home-title']?.name).toBe('Hero title');
    expect(result.normalizedCommands).toEqual([]);
  });

  it('rejects a node-version precondition conflict', () => {
    const state = createPremiumStarterProject();
    const result = applyViuTransaction(
      state,
      transaction(state, [{ type: 'updateNode', nodeId: 'node-home-title', patch: { name: 'Blocked' } }], 'commit', {
        preconditions: [{ nodeId: 'node-home-title', expectedVersion: 999 }],
      })
    );

    expect(result.accepted).toBe(false);
    expect(result.conflict?.kind).toBe('precondition');
  });

  it('preserves stable identity while reparenting and undoing a node', () => {
    const state = createPremiumStarterProject();
    const moved = applyViuTransaction(
      state,
      transaction(state, [
        {
          type: 'reparentNode',
          nodeId: 'node-home-copy',
          parentId: 'node-showcase-root',
          index: 1,
        },
      ])
    );
    const restored = applyViuTransaction(
      moved.state,
      transaction(moved.state, moved.inverseCommands, 'commit', { transactionId: 'transaction-reparent-undo' })
    );

    expect(moved.state.nodes['node-home-copy']?.id).toBe('node-home-copy');
    expect(moved.state.nodes['node-home-copy']?.parentId).toBe('node-showcase-root');
    expect(restored.state.nodes['node-home-copy']?.parentId).toBe('node-home-root');
  });

  it('restores a deleted subtree and its original order through inverse commands', () => {
    const state = createPremiumStarterProject();
    const deleted = applyViuTransaction(
      state,
      transaction(state, [{ type: 'deleteNode', nodeId: 'node-showcase-card' }])
    );
    const restored = applyViuTransaction(
      deleted.state,
      transaction(deleted.state, deleted.inverseCommands, 'commit', { transactionId: 'transaction-restore' })
    );

    expect(deleted.state.nodes['node-showcase-card']).toBeUndefined();
    expect(restored.state.nodes['node-showcase-copy']?.parentId).toBe('node-showcase-card');
    expect(restored.state.nodes['node-showcase-root']?.childIds).toContain('node-showcase-card');
  });

  it('inserts a user node and removes it with the generated inverse', () => {
    const state = createPremiumStarterProject();
    const node = createViuNode({
      id: 'node-user-note',
      name: 'User note',
      type: 'text',
      parentId: 'node-home-root',
      text: 'Direct canvas content',
    });
    const inserted = applyViuTransaction(
      state,
      transaction(state, [{ type: 'insertNode', node, parentId: 'node-home-root', index: 2 }])
    );
    const undone = applyViuTransaction(
      inserted.state,
      transaction(inserted.state, inserted.inverseCommands, 'commit', { transactionId: 'transaction-insert-undo' })
    );

    expect(inserted.accepted).toBe(true);
    expect(inserted.state.nodes['node-user-note']?.content?.text).toBe('Direct canvas content');
    expect(undone.state.nodes['node-user-note']).toBeUndefined();
  });

  it('reports an interaction whose target screen is missing', () => {
    const state = createPremiumStarterProject();
    const result = applyViuTransaction(
      state,
      transaction(state, [
        {
          type: 'connectInteraction',
          interaction: {
            id: 'interaction-broken',
            version: 1,
            flowId: 'flow-primary',
            sourceNodeId: 'node-home-title',
            trigger: 'click',
            action: { type: 'navigate', targetScreenId: 'screen-missing' },
          },
        },
      ])
    );

    expect(result.accepted).toBe(false);
    expect(result.conflict).toMatchObject({ kind: 'validation' });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing-interaction-target', severity: 'error', actionIndex: 0 })
    );
    expect(result.state.interactions['interaction-broken']).toBeUndefined();
  });

  it('reports a required screen that becomes unreachable', () => {
    const state = createPremiumStarterProject();
    const result = applyViuTransaction(
      state,
      transaction(state, [{ type: 'disconnectInteraction', interactionId: 'interaction-home-showcase' }])
    );

    expect(result.accepted).toBe(true);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === 'unreachable-required-screen' && diagnostic.entityId === 'screen-showcase'
      )
    ).toBe(true);
  });

  it('restores a deleted interactive node without duplicating its binding', () => {
    const state = createPremiumStarterProject();
    const deleted = applyViuTransaction(state, transaction(state, [{ type: 'deleteNode', nodeId: 'node-home-cta' }]));
    const restored = applyViuTransaction(
      deleted.state,
      transaction(deleted.state, deleted.inverseCommands, 'commit', { transactionId: 'transaction-restore-control' })
    );

    expect(restored.state.nodes['node-home-cta']?.behaviorBindings).toEqual(['interaction-home-showcase']);
    expect(
      restored.state.flows['flow-primary']?.interactionIds.filter((id) => id === 'interaction-home-showcase')
    ).toHaveLength(1);
    expect(restored.diagnostics).toEqual([]);
  });

  it('creates and undoes a timeline with an authored scroll binding atomically', () => {
    const state = createPremiumStarterProject('motion-command');
    const created = applyViuTransaction(
      state,
      transaction(state, [
        {
          type: 'createTimeline',
          timeline: {
            id: 'timeline-command',
            name: 'Command motion',
            durationMs: 900,
            tracks: [
              {
                id: 'track-command',
                nodeId: 'node-home-title',
                property: 'blur',
                keyframes: [
                  { offsetMs: 0, value: 16 },
                  { offsetMs: 900, value: 0 },
                ],
              },
            ],
          },
        },
        {
          type: 'upsertScrollBinding',
          binding: {
            id: 'scroll-command',
            nodeId: 'node-home-title',
            timelineId: 'timeline-command',
            start: 0,
            end: 1,
            pin: false,
            parallax: 80,
          },
        },
      ])
    );
    expect(created.accepted).toBe(true);
    expect(created.state.scrollBindings?.['scroll-command']?.timelineId).toBe('timeline-command');

    const undone = applyViuTransaction(
      created.state,
      transaction(created.state, created.inverseCommands, 'commit', { transactionId: 'transaction-motion-undo' })
    );
    expect(undone.accepted).toBe(true);
    expect(undone.state.timelines['timeline-command']).toBeUndefined();
    expect(undone.state.scrollBindings?.['scroll-command']).toBeUndefined();
  });

  it('removes and restores node-owned motion when deleting a subtree', () => {
    const state = createPremiumStarterProject('motion-node-delete');
    state.timelines['timeline-node'] = {
      id: 'timeline-node',
      name: 'Node motion',
      durationMs: 800,
      tracks: [
        {
          id: 'track-node',
          nodeId: 'node-showcase-card',
          property: 'y',
          keyframes: [
            { offsetMs: 0, value: 20 },
            { offsetMs: 800, value: 0 },
          ],
        },
      ],
    };
    state.scrollBindings = {
      'scroll-node': {
        id: 'scroll-node',
        nodeId: 'node-showcase-card',
        timelineId: 'timeline-node',
        start: 0,
        end: 1,
        pin: true,
        parallax: 40,
      },
    };

    const deleted = applyViuTransaction(
      state,
      transaction(state, [{ type: 'deleteNode', nodeId: 'node-showcase-card' }])
    );
    expect(deleted.accepted).toBe(true);
    expect(deleted.state.timelines['timeline-node']?.tracks).toEqual([]);
    expect(deleted.state.scrollBindings?.['scroll-node']).toBeUndefined();

    const restored = applyViuTransaction(
      deleted.state,
      transaction(deleted.state, deleted.inverseCommands, 'commit', {
        transactionId: 'transaction-motion-node-restore',
      })
    );
    expect(restored.accepted).toBe(true);
    expect(restored.state.timelines['timeline-node']?.tracks?.[0]?.nodeId).toBe('node-showcase-card');
    expect(restored.state.scrollBindings?.['scroll-node']?.nodeId).toBe('node-showcase-card');
  });

  it('rejects a reparent that would create a node cycle', () => {
    const state = createPremiumStarterProject();
    const result = applyViuTransaction(
      state,
      transaction(state, [
        {
          type: 'reparentNode',
          nodeId: 'node-showcase-card',
          parentId: 'node-showcase-copy',
        },
      ])
    );

    expect(result.accepted).toBe(false);
    expect(result.conflict?.kind).toBe('command');
    expect(result.state).toBe(state);
  });
});
