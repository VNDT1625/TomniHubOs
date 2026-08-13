/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createPremiumStarterProject } from '@/common/viu';
import { compileViuSite, type ViuRuntimeContract } from '@/common/viu/runtime';

const cloneStarter = () => structuredClone(createPremiumStarterProject());

describe('compileViuSite', () => {
  it('groups screens on the same route into ordered scroll sections', () => {
    const project = cloneStarter();
    project.screens['screen-showcase']!.route = '/';

    const plan = compileViuSite(project);

    expect(plan.routes).toHaveLength(1);
    expect(plan.routes[0]?.screenIds).toEqual(['screen-home', 'screen-showcase']);
    expect(plan.routes[0]?.sections.map((section) => section.screenId)).toEqual(['screen-home', 'screen-showcase']);
  });

  it('resolves button navigation into a route and section anchor', () => {
    const plan = compileViuSite(cloneStarter());

    expect(plan.interactions['interaction-home-showcase']?.action).toEqual({
      type: 'navigate',
      targetScreenId: 'screen-showcase',
      targetRoute: '/collection',
      targetAnchorId: 'viu-screen-showcase',
    });
  });

  it('reports and excludes interactions whose target screen is missing', () => {
    const project = cloneStarter();
    project.interactions['interaction-home-showcase']!.action = {
      type: 'navigate',
      targetScreenId: 'screen-missing',
    };

    const plan = compileViuSite(project);

    expect(plan.interactions['interaction-home-showcase']).toBeUndefined();
    expect(plan.diagnostics.some((diagnostic) => diagnostic.code === 'missing-screen')).toBe(true);
  });

  it('supports declarative overlay, back, motion, and responsive contracts without changing the document schema', () => {
    const project = cloneStarter();
    const contract: ViuRuntimeContract = {
      schemaVersion: 1,
      nodes: {
        'node-home-title': {
          motion: { preset: 'rise', trigger: 'in-view', durationMs: 560 },
          responsive: { mobile: { layout: { width: '100%', minHeight: 180 } } },
        },
      },
      interactions: {
        'interaction-showcase-home': { action: { type: 'back' } },
      },
    };

    const plan = compileViuSite(project, contract);

    expect(plan.contract.nodes?.['node-home-title']?.responsive?.mobile?.layout?.width).toBe('100%');
    expect(plan.interactions['interaction-showcase-home']?.action.type).toBe('back');
  });

  it('uses the explicit preview start screen before the flow start screen', () => {
    const project = cloneStarter();
    project.flows['flow-primary']!.startScreenId = 'screen-showcase';

    const plan = compileViuSite(project, { schemaVersion: 1, defaultScreenId: 'screen-home' });

    expect(plan.initialScreenId).toBe('screen-home');
    expect(plan.initialRoute).toBe('/');
  });

  it('keeps long frame bounds so preview can scroll through the complete page', () => {
    const project = cloneStarter();
    project.nodes['node-home-root']!.size.height = 2680;

    const plan = compileViuSite(project);

    expect(plan.routeByPath['/']?.sections[0]?.contentSize).toEqual({ width: 1440, height: 2680 });
  });
});
