import { describe, expect, it } from 'vitest';

import {
  auditViuProjectQuality,
  calculateViuContrastRatio,
  compileViuPaintStyle,
  compileViuStrokeStyle,
  createPremiumStarterProject,
  createViuNode,
  validateViuNodeStyle,
  validateViuProject,
  type ViuStroke,
} from '@/common/viu';

const stroke = (id: string, patch: Partial<ViuStroke> = {}): ViuStroke => ({
  id,
  visible: true,
  opacity: 1,
  color: '#112233',
  width: 2,
  alignment: 'inside',
  cap: 'round',
  join: 'miter',
  miterLimit: 4,
  dashPattern: [],
  dashOffset: 0,
  ...patch,
});

describe('VIU advanced strokes', () => {
  it('preserves ordered multi-stroke semantics and compiles an outside top stroke', () => {
    const style = {
      opacity: 1,
      strokes: [stroke('inner', { width: 3 }), stroke('outer', { width: 6, alignment: 'outside', opacity: 0.5 })],
    };

    expect(compileViuStrokeStyle(style)).toMatchObject({ borderStyle: 'none', borderWidth: 0, outlineOffset: 0 });
    expect(compileViuPaintStyle(style).boxShadow).toContain('inset 0 0 0 3px');
  });

  it('rejects all-zero dash patterns before a transaction can commit', () => {
    const style = { opacity: 1, strokes: [stroke('broken', { dashPattern: [0, 0] })] };

    expect(validateViuNodeStyle(style)).toContain('only zeroes');
  });
});

describe('VIU accessibility and design lint', () => {
  it('calculates WCAG contrast only when both colors are computable', () => {
    expect(calculateViuContrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 4);
    expect(calculateViuContrastRatio('var(--text)', '#ffffff')).toBeUndefined();
  });

  it('reports labels, heading hierarchy, keyboard access, contrast and overflow together', () => {
    const project = createPremiumStarterProject('quality-test');
    project.nodes['node-home-cta']!.semantics.label = '';
    project.nodes['node-home-cta']!.semantics.role = 'region';
    project.nodes['node-home-cta']!.type = 'frame';
    project.nodes['node-home-title']!.semantics.headingLevel = 3;
    project.nodes['node-home-title']!.style.background = '#ffffff';
    project.nodes['node-home-title']!.style.color = '#eeeeee';
    project.nodes['node-home-orb']!.localTransform[4] = 1_420;

    const codes = new Set(auditViuProjectQuality(project).map((item) => item.code));

    expect(codes.has('missing-interactive-label')).toBe(true);
    expect(codes.has('keyboard-inaccessible-interaction')).toBe(true);
    expect(codes.has('low-text-contrast')).toBe(true);
    expect(codes.has('clipped-content')).toBe(true);
  });

  it('uses every ordered action when calculating reachable screens', () => {
    const project = createPremiumStarterProject('ordered-reachability-test');
    project.interactions['interaction-home-showcase']!.action = { type: 'back' };
    project.interactions['interaction-home-showcase']!.actions = [
      { type: 'setVariable', variableId: 'space-md', value: 32 },
      { type: 'navigate', targetScreenId: 'screen-showcase' },
    ];

    expect(validateViuProject(project).some((item) => item.code === 'unreachable-required-screen')).toBe(false);
  });

  it('identifies the exact ordered action with a missing target', () => {
    const project = createPremiumStarterProject('ordered-target-test');
    project.interactions['interaction-home-showcase']!.actions = [
      { type: 'setVariable', variableId: 'space-md', value: 32 },
      { type: 'navigate', targetScreenId: 'missing-screen' },
    ];

    expect(validateViuProject(project)).toContainEqual(
      expect.objectContaining({
        code: 'missing-interaction-target',
        entityId: 'interaction-home-showcase',
        actionIndex: 1,
      })
    );
  });

  it('includes quality findings in the canonical project diagnostics used by agents and editor gates', () => {
    const project = createPremiumStarterProject('quality-gate-test');
    const image = createViuNode({
      id: 'image-unlabelled',
      name: 'Decorative import',
      type: 'image',
      parentId: 'node-home-root',
      semantics: { role: 'image', label: '' },
    });
    project.nodes[image.id] = image;
    project.nodes['node-home-root']!.childIds.push(image.id);

    expect(validateViuProject(project)).toContainEqual(
      expect.objectContaining({ code: 'missing-image-label', entityId: image.id })
    );
  });
});
