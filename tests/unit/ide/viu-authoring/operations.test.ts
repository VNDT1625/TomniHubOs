/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { applyViuTransaction, createPremiumStarterProject, createViuNode } from '@/common/viu';
import {
  createAlignViuBatch,
  createAppearanceViuBatch,
  createDeleteViuBatch,
  createDistributeViuBatch,
  createDuplicateViuBatch,
  createGroupViuBatch,
  createLayoutViuBatch,
  createTextContentViuBatch,
  createTypographyViuBatch,
  createUngroupViuBatch,
  createViuMarqueeSelection,
  normalizeViuSelection,
  toggleViuSelectionNode,
  type ViuAuthoringBatch,
  type ViuSelection,
} from '@/common/viu/authoring';
import type { ViuCommand, ViuProjectState, ViuTransactionResult } from '@/common/viu';

let transactionSequence = 0;

const applyCommands = (state: ViuProjectState, commands: readonly ViuCommand[]): ViuTransactionResult =>
  applyViuTransaction(state, {
    transactionId: `authoring-test-${transactionSequence++}`,
    documentId: state.projectId,
    baseRevision: state.revision,
    actor: { id: 'test-user', kind: 'user' },
    origin: 'canvas',
    commands: [...commands],
    mode: 'commit',
    summary: 'authoring test',
  });

const applyBatch = (state: ViuProjectState, batch: ViuAuthoringBatch): ViuTransactionResult =>
  applyCommands(state, batch.commands);

const acceptedState = (result: ViuTransactionResult): ViuProjectState => {
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.conflict?.message);
  return result.state;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
};

const semanticDigest = (state: ViuProjectState): string => {
  const candidate = structuredClone(state);
  candidate.revision = 0;
  Object.values(candidate.nodes).forEach((node) => {
    node.version = 0;
  });
  Object.values(candidate.interactions).forEach((interaction) => {
    interaction.version = 0;
  });
  Object.values(candidate.flows).forEach((flow) => {
    flow.interactionIds = flow.interactionIds.toSorted();
  });
  return JSON.stringify(canonicalize(candidate));
};

const selection = (...nodeIds: string[]): ViuSelection => ({ nodeIds, anchorId: nodeIds.at(-1) ?? null });

const addDistributionFixture = (state: ViuProjectState): ViuProjectState => {
  const candidate = structuredClone(state);
  const root = candidate.nodes['node-home-root']!;
  for (const [id, x] of [
    ['fixture-a', 0],
    ['fixture-b', 30],
    ['fixture-c', 100],
  ] as const) {
    candidate.nodes[id] = createViuNode({
      id,
      name: id,
      type: 'frame',
      parentId: root.id,
      x,
      y: x / 10,
      width: 10,
      height: 10,
    });
    root.childIds.push(id);
  }
  return candidate;
};

describe('VIU authoring selection', () => {
  it('toggles a stable multi-selection without duplicate IDs', () => {
    const state = createPremiumStarterProject();
    const first = normalizeViuSelection(state, ['node-home-title', 'node-home-title']);
    const second = toggleViuSelectionNode(state, first, 'node-home-copy');
    const third = toggleViuSelectionNode(state, second, 'node-home-title');

    expect(first.nodeIds).toEqual(['node-home-title']);
    expect(second.nodeIds).toEqual(['node-home-title', 'node-home-copy']);
    expect(third).toEqual({ nodeIds: ['node-home-copy'], anchorId: 'node-home-copy' });
  });

  it('uses contains/intersects marquee policies and excludes locked nodes', () => {
    const state = createPremiumStarterProject();
    state.nodes['node-home-kicker']!.locked = true;

    const result = createViuMarqueeSelection(
      state,
      { x: 80, y: 100, width: 820, height: 340 },
      { mode: 'contains', scopeId: 'node-home-root' }
    );

    expect(result.nodeIds).toContain('node-home-title');
    expect(result.nodeIds).not.toContain('node-home-kicker');
  });
});

describe('VIU authoring structural operations', () => {
  it('duplicates a subtree and remaps its source interaction atomically', () => {
    const state = createPremiumStarterProject();
    const batch = createDuplicateViuBatch(state, selection('node-home-cta'), {
      idFactory: (_kind, sourceId) => `${sourceId}-copy`,
    });
    const result = applyBatch(state, batch);
    const next = acceptedState(result);

    expect(next.nodes['node-home-cta-copy']?.localTransform[4]).toBe(112);
    expect(next.interactions['interaction-home-showcase-copy']?.sourceNodeId).toBe('node-home-cta-copy');
    expect(batch.nextSelection?.nodeIds).toEqual(['node-home-cta-copy']);
  });

  it('restores the semantic project after undoing a duplicate', () => {
    const state = createPremiumStarterProject();
    const result = applyBatch(
      state,
      createDuplicateViuBatch(state, selection('node-home-cta'), {
        idFactory: (_kind, sourceId) => `${sourceId}-copy`,
      })
    );
    const undo = applyCommands(acceptedState(result), result.inverseCommands);

    expect(semanticDigest(acceptedState(undo))).toBe(semanticDigest(state));
  });

  it('groups and ungroups siblings without changing semantic geometry', () => {
    const state = createPremiumStarterProject();
    const grouped = acceptedState(
      applyBatch(
        state,
        createGroupViuBatch(state, selection('node-home-kicker', 'node-home-title'), {
          groupId: 'group-hero-type',
          groupName: 'Hero type',
        })
      )
    );
    const restored = acceptedState(applyBatch(grouped, createUngroupViuBatch(grouped, selection('group-hero-type'))));

    expect(grouped.nodes['group-hero-type']?.childIds).toEqual(['node-home-kicker', 'node-home-title']);
    expect(semanticDigest(restored)).toBe(semanticDigest(state));
  });

  it('rejects grouping nodes from different parents before producing partial commands', () => {
    const state = createPremiumStarterProject();

    expect(() =>
      createGroupViuBatch(state, selection('node-home-title', 'node-showcase-copy'), {
        groupId: 'invalid-group',
        groupName: 'Invalid group',
      })
    ).toThrow('share a non-root parent');
  });

  it('aligns siblings to a key object', () => {
    const state = addDistributionFixture(createPremiumStarterProject());
    const result = applyBatch(
      state,
      createAlignViuBatch(state, selection('fixture-a', 'fixture-b', 'fixture-c'), 'top', 'fixture-a')
    );
    const next = acceptedState(result);

    expect(next.nodes['fixture-b']?.localTransform[5]).toBe(0);
    expect(next.nodes['fixture-c']?.localTransform[5]).toBe(0);
  });

  it('distributes siblings with equal edge spacing while fixing endpoints', () => {
    const state = addDistributionFixture(createPremiumStarterProject());
    const result = applyBatch(
      state,
      createDistributeViuBatch(state, selection('fixture-a', 'fixture-b', 'fixture-c'), 'horizontal')
    );
    const next = acceptedState(result);

    expect(next.nodes['fixture-a']?.localTransform[4]).toBe(0);
    expect(next.nodes['fixture-b']?.localTransform[4]).toBe(50);
    expect(next.nodes['fixture-c']?.localTransform[4]).toBe(100);
  });

  it('deletes multiple subtrees and one inverse batch restores the semantic digest', () => {
    const state = createPremiumStarterProject();
    const result = applyBatch(state, createDeleteViuBatch(state, selection('node-home-kicker', 'node-home-cta')));
    const undo = applyCommands(acceptedState(result), result.inverseCommands);

    expect(semanticDigest(acceptedState(undo))).toBe(semanticDigest(state));
  });
});

describe('VIU authoring text operations', () => {
  it('commits Unicode content as one existing atomic update command', () => {
    const state = createPremiumStarterProject();
    const vietnamese = 'Ti\u1ebfng Vi\u1ec7t ho\u00e0n ch\u1ec9nh';
    const batch = createTextContentViuBatch(state, selection('node-home-title'), vietnamese);
    const next = acceptedState(applyBatch(state, batch));

    expect(batch.commands).toHaveLength(1);
    expect(next.nodes['node-home-title']?.content?.text).toBe(vietnamese);
  });

  it('applies Figma-style auto layout, sizing and constraints atomically', () => {
    const state = createPremiumStarterProject();
    const rootId = state.screens['screen-home']!.rootNodeId;
    const next = acceptedState(
      applyBatch(
        state,
        createLayoutViuBatch(state, selection(rootId), {
          layout: {
            mode: 'horizontal',
            gap: 24,
            padding: [16, 24, 16, 24],
            align: 'center',
            justify: 'space-between',
            wrap: true,
          },
          sizing: { horizontal: 'fill', vertical: 'hug', minWidth: 320, maxWidth: 1440 },
          constraints: { horizontal: 'stretch', vertical: 'top' },
          positionMode: 'flow',
        })
      )
    );

    expect(next.nodes[rootId]).toMatchObject({
      positionMode: 'flow',
      sizing: { horizontal: 'fill', vertical: 'hug', minWidth: 320, maxWidth: 1440 },
      constraints: { horizontal: 'stretch', vertical: 'top' },
      layout: {
        mode: 'horizontal',
        gap: 24,
        padding: [16, 24, 16, 24],
        align: 'center',
        justify: 'space-between',
        wrap: true,
      },
    });
  });

  it('rejects invalid grid tracks before creating a transaction', () => {
    const state = createPremiumStarterProject();
    const rootId = state.screens['screen-home']!.rootNodeId;

    expect(() => createLayoutViuBatch(state, selection(rootId), { layout: { columns: 0 } })).toThrow(
      'Grid columns must be between 1 and 64.'
    );
  });

  it('applies stroke and overflow appearance without discarding existing style', () => {
    const state = createPremiumStarterProject();
    const next = acceptedState(
      applyBatch(
        state,
        createAppearanceViuBatch(state, selection('node-home-title'), {
          borderColor: '#ff0000',
          borderWidth: 3,
          overflow: 'hidden',
        })
      )
    );

    expect(next.nodes['node-home-title']?.style).toMatchObject({
      borderColor: '#ff0000',
      borderWidth: 3,
      overflow: 'hidden',
      fontSize: state.nodes['node-home-title']?.style.fontSize,
    });
  });

  it('applies CSS-faithful gradients, stroke styles, shadows, and blur effects', () => {
    const state = createPremiumStarterProject();
    const next = acceptedState(
      applyBatch(
        state,
        createAppearanceViuBatch(state, selection('node-home-title'), {
          background: 'linear-gradient(120deg, #112233 0%, rgba(44, 55, 66, 0.4) 100%)',
          borderStyle: 'dashed',
          shadow: '4px 8px 24px 2px rgba(0, 0, 0, 0.28)',
          blur: 3,
          backdropBlur: 16,
        })
      )
    );

    expect(next.nodes['node-home-title']?.style).toMatchObject({
      background: 'linear-gradient(120deg, #112233 0%, rgba(44, 55, 66, 0.4) 100%)',
      borderStyle: 'dashed',
      shadow: '4px 8px 24px 2px rgba(0, 0, 0, 0.28)',
      blur: 3,
      backdropBlur: 16,
    });
  });

  it('rejects invalid visual effect ranges before creating a transaction', () => {
    const state = createPremiumStarterProject();

    expect(() => createAppearanceViuBatch(state, selection('node-home-title'), { blur: 201 })).toThrow(
      'Blur must be between 0 and 200.'
    );
    expect(() => createAppearanceViuBatch(state, selection('node-home-title'), { background: ' ' })).toThrow(
      'Background must be a non-empty CSS value shorter than 10,000 characters.'
    );
  });

  it('retains unrelated appearance while applying full typography controls', () => {
    const state = createPremiumStarterProject();
    const originalColor = state.nodes['node-home-title']!.style.color;
    const next = acceptedState(
      applyBatch(
        state,
        createTypographyViuBatch(state, selection('node-home-title'), {
          fontFamily: 'Noto Sans',
          fontSize: 72,
          fontWeight: 700,
          fontStyle: 'italic',
          lineHeight: 1.15,
          letterSpacing: -1,
          textDecoration: 'underline',
          textTransform: 'uppercase',
          textAlign: 'center',
          verticalAlign: 'middle',
        })
      )
    );

    expect(next.nodes['node-home-title']?.style.color).toBe(originalColor);
    expect(next.nodes['node-home-title']?.style).toMatchObject({
      fontFamily: 'Noto Sans',
      fontSize: 72,
      fontWeight: 700,
      fontStyle: 'italic',
      lineHeight: 1.15,
      letterSpacing: -1,
      textDecoration: 'underline',
      textTransform: 'uppercase',
      textAlign: 'center',
      verticalAlign: 'middle',
    });
  });

  it('stores typography from a text component instance as sparse overrides', () => {
    const state = createPremiumStarterProject();
    state.components['component-title'] = {
      id: 'component-title',
      version: 1,
      name: 'Reusable title',
      rootNodeId: 'node-home-title',
      variantProperties: {},
      propertyDefinitions: {},
    };
    const instance = createViuNode({
      id: 'instance-title',
      name: 'Title instance',
      type: 'component-instance',
      parentId: 'node-home-root',
      width: 790,
      height: 260,
    });
    instance.componentInstance = {
      componentId: 'component-title',
      variantSelection: {},
      propertyValues: {},
    };
    state.nodes[instance.id] = instance;
    state.nodes['node-home-root']!.childIds.push(instance.id);

    const batch = createTypographyViuBatch(state, selection(instance.id), {
      fontStyle: 'oblique',
      textDecoration: 'line-through',
      textTransform: 'capitalize',
    });
    const next = acceptedState(applyBatch(state, batch));

    expect(batch.commands[0]).toMatchObject({
      type: 'updateNode',
      nodeId: instance.id,
      patch: {
        componentInstance: {
          styleOverrides: {
            fontStyle: 'oblique',
            textDecoration: 'line-through',
            textTransform: 'capitalize',
          },
        },
      },
    });
    expect(next.nodes[instance.id]?.style.fontStyle).toBeUndefined();
    expect(next.nodes[instance.id]?.componentInstance?.styleOverrides).toMatchObject({
      fontStyle: 'oblique',
      textDecoration: 'line-through',
      textTransform: 'capitalize',
    });
  });
});
