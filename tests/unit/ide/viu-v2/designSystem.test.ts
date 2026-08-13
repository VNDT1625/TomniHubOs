/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { applyViuTransaction, createPremiumStarterProject, validateViuProjectStructure } from '@/common/viu';
import { createResponsiveViuBatch, createSnapSettingsViuBatch } from '@/common/viu/authoring';
import {
  getViuRotation,
  normalizeViuDesignSystem,
  resolveViuNode,
  resolveViuVariable,
  snapViuPoint,
  validateViuDesignSystem,
  withViuRotation,
} from '@/common/viu/runtime/designSystem';
import type { ViuProjectState, ViuTransaction, ViuVariable } from '@/common/viu';

const transaction = (
  project: ViuProjectState,
  commands: ViuTransaction['commands'],
  id = 'design-system-test'
): ViuTransaction => ({
  transactionId: id,
  documentId: project.projectId,
  baseRevision: project.revision,
  actor: { id: 'tester', kind: 'user' },
  origin: 'inspector',
  commands,
  mode: 'commit',
  summary: id,
});

describe('VIU design-system normalization and resolution', () => {
  it('upgrades legacy variables and fills precision defaults without mutating the source', () => {
    const project = createPremiumStarterProject('migration');
    const legacy = structuredClone(project);
    legacy.schemaVersion = 2;
    legacy.variableCollections = undefined;
    legacy.activeVariableModes = undefined;
    legacy.breakpoints = undefined;
    legacy.guides = undefined;
    legacy.snapSettings = undefined;
    legacy.variables = {
      greeting: { id: 'greeting', name: 'Greeting', type: 'string', value: 'Hello' },
    };

    const normalized = normalizeViuDesignSystem(legacy);

    expect(normalized.schemaVersion).toBe(3);
    expect(resolveViuVariable(normalized, 'greeting').value).toBe('Hello');
    expect(legacy.schemaVersion).toBe(2);
  });

  it('resolves aliases through active light and dark modes deterministically', () => {
    const project = createPremiumStarterProject('aliases');
    const alias: ViuVariable = {
      id: 'color-action',
      name: 'Color / Action',
      collectionId: 'foundation',
      type: 'color',
      valuesByMode: {
        light: { type: 'alias', variableId: 'color-accent' },
        dark: { type: 'alias', variableId: 'color-accent' },
        brand: { type: 'alias', variableId: 'color-accent' },
      },
    };
    project.variables[alias.id] = alias;

    const dark = resolveViuVariable(project, alias.id);
    project.activeVariableModes = { foundation: 'light' };
    const light = resolveViuVariable(project, alias.id);

    expect(dark.value).toBe('#c8ffe3');
    expect(light.value).toBe('#86e8ba');
    expect(dark.aliasPath).toEqual(['color-action', 'color-accent']);
  });

  it('keeps explicit source mode when an alias targets a variable in the same collection', () => {
    const project = createPremiumStarterProject('alias-explicit-mode');
    project.activeVariableModes = { foundation: 'dark' };
    project.variables['color-action'] = {
      id: 'color-action',
      name: 'Color / Action',
      collectionId: 'foundation',
      type: 'color',
      valuesByMode: {
        light: { type: 'alias', variableId: 'color-accent' },
        dark: { type: 'alias', variableId: 'color-accent' },
        brand: { type: 'alias', variableId: 'color-accent' },
      },
    };

    expect(resolveViuVariable(project, 'color-action', 'light').value).toBe('#86e8ba');
  });

  it('rejects alias cycles and incompatible aliases', () => {
    const project = createPremiumStarterProject('invalid-alias');
    project.variables.a = {
      id: 'a',
      name: 'A',
      collectionId: 'foundation',
      type: 'number',
      valuesByMode: { light: { type: 'alias', variableId: 'b' }, dark: 1, brand: 1 },
    };
    project.variables.b = {
      id: 'b',
      name: 'B',
      collectionId: 'foundation',
      type: 'number',
      valuesByMode: { light: { type: 'alias', variableId: 'a' }, dark: 2, brand: 2 },
    };
    project.activeVariableModes = { foundation: 'light' };

    expect(() => resolveViuVariable(project, 'a')).toThrow(/cycle/i);
    expect(validateViuDesignSystem(project).some((error) => /cycle/i.test(error))).toBe(true);
  });

  it('applies sparse breakpoint data before a mode-aware binding and explains both sources', () => {
    const project = createPremiumStarterProject('responsive');
    const node = project.nodes['node-home-title']!;
    node.responsiveOverrides = {
      mobile: {
        size: { width: 280 },
        style: { fontSize: 42 },
      },
    };
    node.variableBindings = {
      'style.color': { variableId: 'color-accent' },
    };

    const resolved = resolveViuNode(project, node.id, 390);

    expect(resolved.node.size.width).toBe(280);
    expect(resolved.node.style.color).toBe('#c8ffe3');
    expect(resolved.breakpoint?.id).toBe('mobile');
  });

  it('reports an incompatible property binding instead of silently coercing it', () => {
    const project = createPremiumStarterProject('binding-type');
    project.nodes['node-home-title']!.variableBindings = {
      'style.opacity': { variableId: 'color-accent' },
    };

    expect(() => resolveViuNode(project, 'node-home-title', 1440)).toThrow(/requires number/i);
    expect(validateViuDesignSystem(project)[0]).toMatch(/requires number/i);
  });
});

describe('VIU precision helpers', () => {
  it('preserves translation and scale magnitude while replacing rotation', () => {
    const rotated = withViuRotation([2, 0, 0, 3, 14, 28], 90);

    expect(getViuRotation(rotated)).toBe(90);
    expect(rotated[4]).toBe(14);
    expect(rotated[5]).toBe(28);
  });

  it('snaps independently to the closest guide and object coordinate', () => {
    const project = createPremiumStarterProject('snap');
    project.guides = [
      { id: 'guide-x', axis: 'vertical', position: 100 },
      { id: 'guide-y', axis: 'horizontal', position: 200 },
    ];

    const result = snapViuPoint(project, { x: 96, y: 204 }, { x: [300], y: [400] });

    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
    expect(result.matches.map((match) => match.source)).toEqual(['guide', 'guide']);
  });

  it('prefers the closest object coordinate over a farther guide inside the threshold', () => {
    const project = createPremiumStarterProject('snap-distance');
    project.guides = [{ id: 'guide-x', axis: 'vertical', position: 100 }];

    const result = snapViuPoint(project, { x: 103, y: 20 }, { x: [103] });

    expect(result.x).toBe(103);
    expect(result.matches[0]?.source).toBe('object');
  });

  it('rejects malformed snap settings before they enter a transaction', () => {
    expect(() =>
      createSnapSettingsViuBatch({
        enabled: true,
        pixelGrid: -1,
        threshold: 6,
        snapToGuides: true,
        snapToObjects: true,
      })
    ).toThrow(/non-negative/i);
  });

  it('leaves coordinates untouched when snapping is disabled', () => {
    const project = createPremiumStarterProject('snap-off');
    project.snapSettings = {
      enabled: false,
      pixelGrid: 8,
      threshold: 10,
      snapToGuides: true,
      snapToObjects: true,
    };

    expect(snapViuPoint(project, { x: 13, y: 17 })).toEqual({ x: 13, y: 17, matches: [] });
  });
});

describe('VIU design-system transactions', () => {
  it('commits mode and variable changes atomically with inverse commands', () => {
    const project = createPremiumStarterProject('transaction');
    const variable: ViuVariable = {
      id: 'radius-card',
      name: 'Radius / Card',
      collectionId: 'foundation',
      type: 'number',
      valuesByMode: { light: 20, dark: 24, brand: 28 },
    };

    const committed = applyViuTransaction(
      project,
      transaction(project, [
        { type: 'upsertVariable', variable },
        { type: 'setVariableMode', collectionId: 'foundation', modeId: 'brand' },
      ])
    );

    expect(committed.accepted).toBe(true);
    expect(committed.inverseCommands.length).toBe(2);
    expect(committed.state.activeVariableModes?.foundation).toBe('brand');
  });

  it('rolls back the entire transaction when a later command is invalid', () => {
    const project = createPremiumStarterProject('rollback');
    const variable: ViuVariable = {
      id: 'space-xl2',
      name: 'Space / XL2',
      collectionId: 'foundation',
      type: 'number',
      valuesByMode: { light: 128, dark: 128, brand: 128 },
    };

    const result = applyViuTransaction(
      project,
      transaction(project, [
        { type: 'upsertVariable', variable },
        { type: 'setVariableMode', collectionId: 'foundation', modeId: 'missing' },
      ])
    );

    expect(result.accepted).toBe(false);
    expect(result.state.variables['space-xl2']).toBeUndefined();
    expect(result.conflict?.kind).toBe('command');
  });

  it('preserves existing nested responsive fields while authoring a sparse patch', () => {
    const project = createPremiumStarterProject('responsive-merge');
    const nodeId = 'node-home-title';
    project.nodes[nodeId]!.responsiveOverrides = {
      mobile: {
        size: { height: 120 },
        style: { color: '#ffffff' },
        content: { text: 'Existing' },
      },
    };
    const batch = createResponsiveViuBatch(project, { nodeIds: [nodeId], anchorId: nodeId }, 'mobile', {
      size: { width: 280 },
      style: { opacity: 0.6 },
      content: { placeholder: 'New' },
    });

    const result = applyViuTransaction(project, transaction(project, batch.commands, 'responsive-merge'));

    expect(result.accepted).toBe(true);
    expect(result.state.nodes[nodeId]?.responsiveOverrides?.mobile).toMatchObject({
      size: { width: 280, height: 120 },
      style: { color: '#ffffff', opacity: 0.6 },
      content: { text: 'Existing', placeholder: 'New' },
    });
  });

  it('rejects malformed mode registries, guides and empty responsive overrides', () => {
    const project = createPremiumStarterProject('invalid-design-system');
    project.variableCollections!.foundation.modeIds.push('dark');
    project.guides = [
      { id: 'duplicate', axis: 'vertical', position: 10 },
      { id: 'duplicate', axis: 'horizontal', position: Number.NaN },
    ];
    project.nodes['node-home-title']!.responsiveOverrides = { mobile: {} };

    const errors = validateViuDesignSystem(project);

    expect(errors.some((error) => /duplicate mode/i.test(error))).toBe(true);
    expect(errors.some((error) => /Guide duplicate is duplicated/i.test(error))).toBe(true);
    expect(errors.some((error) => /empty override/i.test(error))).toBe(true);
  });

  it('rejects a breakpoint that has an inverted range', () => {
    const project = createPremiumStarterProject('breakpoint-invalid');
    project.breakpoints!.broken = {
      id: 'broken',
      name: 'Broken',
      preset: 'custom',
      minWidth: 900,
      maxWidth: 600,
    };

    const structural = validateViuProjectStructure(project);

    expect(structural.valid).toBe(false);
    expect('message' in structural ? structural.message : '').toMatch(/invalid width range/i);
  });
});
