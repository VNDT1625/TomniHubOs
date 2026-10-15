import { describe, expect, it } from 'vitest';
import { commandsAgents } from '@/common/integrations/detectors/agent/commandsAgents';
import { inventoryOf } from './mcpFixtures';

describe('commands-agents detector', () => {
  it('turns a Claude command and agent into source-backed connections', () => {
    const result = commandsAgents.detect(
      inventoryOf({
        '.claude/commands/deploy.md':
          '---\ndescription: Deploy a release\nargument-hint: environment\n---\nDeploy $ARGUMENTS',
        '.claude/agents/reviewer.md':
          '---\nname: Reviewer\ndescription: Review code\ntools: Read, Grep\nmodel: sonnet\n---\nReview the patch.',
      })
    );

    expect(result.connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'command',
          id: 'deploy',
          path: 'source/.claude/commands/deploy.md',
          format: 'markdown',
          argumentHint: 'environment',
        }),
        expect.objectContaining({
          kind: 'agent',
          id: 'reviewer',
          path: 'source/.claude/agents/reviewer.md',
          format: 'claude-md',
          tools: ['Read', 'Grep'],
          model: 'sonnet',
        }),
      ])
    );
    expect(result.claimed).toEqual(['.claude/agents/reviewer.md', '.claude/commands/deploy.md']);
  });

  it('turns Gemini commands and context into command and rules connections without reading any non-declaration file', () => {
    const result = commandsAgents.detect(
      inventoryOf({
        'gemini-extension.json': JSON.stringify({ contextFileName: 'GEMINI.md' }),
        'GEMINI.md': 'Use concise answers.',
        '.gemini/commands/release.toml': 'description = "Release notes"\nprompt = "Write release notes for {{args}}"',
        'README.md': 'do not read me',
      })
    );

    expect(result.connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'rules', id: 'gemini', path: 'source/GEMINI.md', format: 'gemini-md' }),
        expect.objectContaining({
          kind: 'command',
          id: 'release',
          path: 'source/.gemini/commands/release.toml',
          format: 'gemini-toml',
          description: 'Release notes',
        }),
      ])
    );
    expect(result.claimed).toEqual(['.gemini/commands/release.toml', 'GEMINI.md', 'gemini-extension.json']);
  });
});
