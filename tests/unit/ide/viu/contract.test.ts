/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { persistViuContract } from '@/process/ide/viu/contract';
import { createPromptProject } from '@/process/ide/viu/design';

describe('Viu immutable contract persistence', () => {
  it('content-addresses a contract, strips preview bytes, and safely reuses identical content', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'tomny-viu-contract-'));
    try {
      const project = {
        ...createPromptProject({ prompt: 'A traceable product page' }, new Date('2026-07-22T00:00:00.000Z')),
        referencePreviewDataUrl: 'data:image/png;base64,very-large-preview',
      };
      const first = await persistViuContract({ rootPath, project });
      const second = await persistViuContract({ rootPath, project });
      const saved = await readFile(first.path, 'utf8');

      expect(first.sha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(first.path).toContain(join('.viu', 'contracts'));
      expect(second).toEqual(first);
      expect(saved).not.toContain('referencePreviewDataUrl');
      expect(first.agentPrompt).toContain(first.sha256);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('detects tampering at an existing immutable digest path', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'tomny-viu-contract-'));
    try {
      const project = createPromptProject(
        { prompt: 'A protected visual contract' },
        new Date('2026-07-22T00:00:00.000Z')
      );
      const result = await persistViuContract({ rootPath, project });
      await writeFile(result.path, '{"tampered":true}', 'utf8');
      await expect(persistViuContract({ rootPath, project })).rejects.toThrow('already contains different data');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('rejects a relative workspace path', async () => {
    const project = createPromptProject({ prompt: 'A small page' });
    await expect(persistViuContract({ rootPath: 'relative/project', project })).rejects.toThrow(
      'absolute project folder'
    );
  });
});
