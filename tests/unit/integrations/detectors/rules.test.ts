import { describe, expect, it } from 'vitest';
import { rules } from '@/common/integrations/detectors/agent/rules';
import { inventoryOf } from './mcpFixtures';

describe('rules detector', () => {
  it('turns supported standalone rule conventions into source-backed rules connections', () => {
    const result = rules.detect(
      inventoryOf({
        'AGENTS.md': 'Repository rules.',
        '.cursorrules': 'Cursor rules.',
        '.github/copilot-instructions.md': 'Copilot instructions.',
        '.kiro/steering/security.md': 'Security rules.',
      })
    );

    expect(result.connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'rules', id: 'agents', path: 'source/AGENTS.md', format: 'agents-md' }),
        expect.objectContaining({
          kind: 'rules',
          id: 'cursorrules',
          path: 'source/.cursorrules',
          format: 'cursor-mdc',
        }),
        expect.objectContaining({
          kind: 'rules',
          id: 'copilot-instructions',
          path: 'source/.github/copilot-instructions.md',
          format: 'copilot',
        }),
        expect.objectContaining({
          kind: 'rules',
          id: 'security',
          path: 'source/.kiro/steering/security.md',
          format: 'kiro',
        }),
      ])
    );
    expect(result.claimed).toEqual([
      '.cursorrules',
      '.github/copilot-instructions.md',
      '.kiro/steering/security.md',
      'AGENTS.md',
    ]);
  });
});
