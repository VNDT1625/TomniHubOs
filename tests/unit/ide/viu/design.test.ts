/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildViuAgentPrompt,
  canonicalProjectJson,
  createPromptProject,
  projectDigest,
} from '@/process/ide/viu/design';

describe('Viu prompt design contract', () => {
  it('creates an editable visual hierarchy with design and interaction evidence', () => {
    const project = createPromptProject(
      {
        prompt: 'A premium asymmetric landing page with a spatial product hero',
        mode: 'creative',
        viewport: { width: 1280, height: 800 },
      },
      new Date('2026-07-22T00:00:00.000Z')
    );

    const document = project.documents[0];
    expect(project.sourceKind).toBe('prompt');
    expect(document?.viewport).toEqual({ width: 1280, height: 800 });
    expect(document?.nodes.some((node) => node.parentId !== null)).toBe(true);
    expect(document?.nodes.some((node) => node.zIndex > 0)).toBe(true);
    expect(document?.interactions).not.toHaveLength(0);
    expect(document?.motion).not.toHaveLength(0);
    expect(project.improvedPrompt).toContain('Viu direction: creative');
  });

  it('produces stable canonical JSON and a traceable agent handoff', () => {
    const project = createPromptProject(
      { prompt: 'A clear professional SaaS homepage' },
      new Date('2026-07-22T00:00:00.000Z')
    );
    const reordered = Object.fromEntries(Object.entries(project).toReversed()) as typeof project;

    expect(canonicalProjectJson(reordered)).toBe(canonicalProjectJson(project));
    expect(projectDigest(project)).toMatch(/^[a-f0-9]{64}$/u);
    expect(projectDigest(reordered)).toBe(projectDigest(project));
    expect(buildViuAgentPrompt(project, 'C:\\workspace\\.viu\\contract.json', projectDigest(project))).toContain(
      'Read the contract before editing code.'
    );
  });

  it('rejects an empty prompt instead of inventing a design', () => {
    expect(() => createPromptProject({ prompt: '   ' })).toThrow('A Viu prompt is required.');
  });
});
