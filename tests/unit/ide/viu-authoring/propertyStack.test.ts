/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  applyViuTransaction,
  compileViuPaintStyle,
  createPremiumStarterProject,
  validateViuNodeStyle,
  type ViuEffect,
  type ViuFill,
} from '@/common/viu';
import { createAppearanceViuBatch } from '@/common/viu/authoring';

const fills: ViuFill[] = [
  {
    id: 'gradient',
    type: 'linear',
    visible: true,
    opacity: 1,
    angle: 90,
    stops: [
      { color: '#000000', position: 0 },
      { color: '#ffffff', position: 1 },
    ],
  },
  { id: 'accent', type: 'solid', visible: true, opacity: 0.5, color: '#ff0000' },
];

const effects: ViuEffect[] = [
  {
    id: 'drop',
    type: 'drop-shadow',
    visible: true,
    x: 2,
    y: 4,
    blur: 12,
    spread: 1,
    color: 'rgba(0, 0, 0, 0.3)',
  },
  {
    id: 'inner',
    type: 'inner-shadow',
    visible: true,
    x: 0,
    y: 1,
    blur: 3,
    spread: 0,
    color: '#ffffff',
  },
  { id: 'layer-blur', type: 'layer-blur', visible: true, radius: 6 },
  { id: 'backdrop-blur', type: 'backdrop-blur', visible: true, radius: 10 },
];

describe('VIU structured property stacks', () => {
  it('compiles ordered fills and effects without losing raw CSS fallback', () => {
    const compiled = compileViuPaintStyle({
      opacity: 1,
      background: 'conic-gradient(red, blue)',
      shadow: 'none',
      fills,
      effects,
    });

    expect(compiled.background).toContain('linear-gradient(90deg');
    expect(compiled.background?.indexOf('linear-gradient(90deg')).toBeLessThan(
      compiled.background?.indexOf('color-mix') ?? Number.MAX_SAFE_INTEGER
    );
    expect(compiled.boxShadow).toBe('2px 4px 12px 1px rgba(0, 0, 0, 0.3), inset 0px 1px 3px 0px #ffffff');
    expect(compiled.filter).toBe('blur(6px)');
    expect(compiled.backdropFilter).toBe('blur(10px)');
    expect(compileViuPaintStyle({ opacity: 1, background: 'conic-gradient(red, blue)' }).background).toBe(
      'conic-gradient(red, blue)'
    );
  });

  it('rejects duplicate layer ids and unordered gradient stops', () => {
    expect(validateViuNodeStyle({ fills: [fills[0]!, { ...fills[1]!, id: 'gradient' }] }, true)).toContain(
      'duplicate fill ids'
    );
    expect(
      validateViuNodeStyle(
        {
          fills: [
            {
              ...fills[0]!,
              stops: [
                { color: '#ffffff', position: 1 },
                { color: '#000000', position: 0 },
              ],
            },
          ],
        },
        true
      )
    ).toContain('gradient stops must be ordered');
  });

  it('preserves stack ordering through an atomic authoring transaction and undo', () => {
    const project = createPremiumStarterProject();
    const batch = createAppearanceViuBatch(
      project,
      { nodeIds: ['node-home-title'], anchorId: 'node-home-title' },
      { fills, effects }
    );
    const applied = applyViuTransaction(project, {
      transactionId: 'property-stack-apply',
      documentId: project.projectId,
      baseRevision: project.revision,
      actor: { id: 'property-stack-test', kind: 'user' },
      origin: 'inspector',
      commands: batch.commands,
      mode: 'commit',
      summary: 'Apply property stacks',
    });

    expect(applied.accepted).toBe(true);
    if (!applied.accepted) throw new Error(applied.conflict?.message);
    expect(applied.state.nodes['node-home-title']!.style.fills?.map((fill) => fill.id)).toEqual(['gradient', 'accent']);

    const undone = applyViuTransaction(applied.state, {
      transactionId: 'property-stack-undo',
      documentId: project.projectId,
      baseRevision: applied.state.revision,
      actor: { id: 'property-stack-test', kind: 'user' },
      origin: 'history',
      commands: applied.inverseCommands,
      mode: 'commit',
      summary: 'Undo property stacks',
    });
    expect(undone.accepted).toBe(true);
    if (!undone.accepted) throw new Error(undone.conflict?.message);
    expect(undone.state.nodes['node-home-title']!.style.fills).toBeUndefined();
  });
});
