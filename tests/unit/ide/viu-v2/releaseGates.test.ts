/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  applyViuTransaction,
  createPremiumStarterProject,
  createViuNode,
  validateViuProject,
  validateViuProjectStructure,
  type ViuProjectState,
} from '@/common/viu';
import { compileViuSite } from '@/common/viu/runtime';

const reverseRecord = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(record).toReversed());

const createDenseProject = (nodeCount: number): ViuProjectState => {
  const project = createPremiumStarterProject('release-gate-dense');
  const existingCount = Object.keys(project.nodes).length;
  for (let index = 0; index < nodeCount - existingCount; index += 1) {
    const id = `dense-${index}`;
    const parentId = index < 10 ? 'node-home-root' : `dense-${Math.floor((index - 10) / 10)}`;
    project.nodes[id] = createViuNode({
      id,
      name: `Dense node ${index}`,
      type: 'frame',
      parentId,
      width: 1,
      height: 1,
    });
    project.nodes[parentId]!.childIds.push(id);
  }
  return project;
};

describe('VIU v1 independent release gates', () => {
  it('rejects hostile document shapes and keeps failed transactions atomic', () => {
    const unsupported = createPremiumStarterProject('unsupported-schema');
    unsupported.schemaVersion = 999;
    expect(validateViuProjectStructure(unsupported)).toEqual({
      valid: false,
      message: 'VIU document must use schema version 2 or 3.',
    });

    const duplicateGraph = createPremiumStarterProject('duplicate-graph');
    duplicateGraph.nodes['node-home-root']!.childIds.push('node-home-title');
    expect(validateViuProjectStructure(duplicateGraph)).toMatchObject({ valid: false });

    const project = createPremiumStarterProject('atomic-rejection');
    const result = applyViuTransaction(project, {
      transactionId: 'tx-hostile-style',
      documentId: project.projectId,
      baseRevision: project.revision,
      actor: { id: 'release-auditor', kind: 'user' },
      origin: 'inspector',
      mode: 'commit',
      summary: 'Reject a non-finite style value',
      commands: [
        {
          type: 'updateNode',
          nodeId: 'node-home-title',
          patch: { style: { opacity: Number.NaN } },
        },
      ],
    });

    expect(result).toMatchObject({ accepted: false, revision: 0, conflict: { kind: 'validation' } });
    expect(result.state).toBe(project);
  });

  it('treats navigation in ordered action chains as route reachability', () => {
    const project = createPremiumStarterProject('ordered-action-reachability');
    const interaction = project.interactions['interaction-home-showcase']!;
    interaction.action = { type: 'back' };
    interaction.actions = [{ type: 'navigate', targetScreenId: 'screen-showcase' }];

    const diagnostics = validateViuProject(project);

    expect(diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'unreachable-required-screen', entityId: 'screen-showcase' })
    );
    expect(diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'orphan-screen', entityId: 'screen-showcase' })
    );
  });

  it('compiles an equivalent document deterministically despite record insertion order', () => {
    const first = createPremiumStarterProject('deterministic-plan');
    const reordered: ViuProjectState = {
      ...structuredClone(first),
      screens: reverseRecord(first.screens),
      nodes: reverseRecord(first.nodes),
      flows: reverseRecord(first.flows),
      interactions: reverseRecord(first.interactions),
      breakpoints: reverseRecord(first.breakpoints),
      variables: reverseRecord(first.variables),
    };

    expect(compileViuSite(reordered)).toEqual(compileViuSite(first));
  });

  it('keeps validation and pure runtime compilation bounded for a 10,000-node document', () => {
    const project = createDenseProject(10_000);
    const startedAt = performance.now();
    const structural = validateViuProjectStructure(project);
    const plan = compileViuSite(project);
    const elapsedMs = performance.now() - startedAt;

    expect(Object.keys(project.nodes)).toHaveLength(10_000);
    expect(structural).toEqual({ valid: true });
    expect(plan.nodesByScreen['screen-home']).toHaveLength(9_995);
    expect(elapsedMs).toBeLessThan(10_000);
  }, 15_000);
});
