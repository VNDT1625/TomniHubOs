/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createPromptProject } from '@/process/ide/viu/design';
import {
  activeViuDocument,
  deterministicPromptUpgrade,
  setActiveViuDocument,
  updateViuNode,
  visualEvidenceSummary,
} from '@/renderer/pages/studio/ide/Viu/viuState';

describe('Viu editor state', () => {
  it('updates a layer immutably and preserves its source trace', () => {
    const project = createPromptProject({ prompt: 'A product landing page' });
    const document = activeViuDocument(project);
    const target = document?.nodes.find((node) => node.id === 'hero-title');
    expect(target).toBeDefined();

    const next = updateViuNode(project, document?.id ?? '', target?.id ?? '', {
      rect: { ...(target?.rect ?? { x: 0, y: 0, width: 1, height: 1 }), x: 144 },
    });
    const updated = activeViuDocument(next)?.nodes.find((node) => node.id === 'hero-title');

    expect(updated?.rect.x).toBe(144);
    expect(updated?.sourceTrace.originalRect?.x).toBe(target?.sourceTrace.originalRect?.x);
    expect(activeViuDocument(project)?.nodes.find((node) => node.id === 'hero-title')?.rect.x).not.toBe(144);
  });

  it('summarizes evidence and feeds it into deterministic prompt improvement', () => {
    const project = createPromptProject({ prompt: 'An accessible dashboard', mode: 'professional' });
    expect(visualEvidenceSummary(project)).toContain('Layers:');
    expect(deterministicPromptUpgrade(project, 'faithful')).toContain('Prioritize measured fidelity');
  });

  it('ignores an unknown document instead of corrupting active selection', () => {
    const project = createPromptProject({ prompt: 'A small landing page' });
    expect(setActiveViuDocument(project, 'missing-document')).toBe(project);
  });
});
