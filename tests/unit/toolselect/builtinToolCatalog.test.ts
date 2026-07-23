import { describe, expect, it } from 'vitest';
import { listBuiltinMcpToolCatalog } from '@/process/toolselect/builtinToolCatalog';
import { keywordFilter } from '@/process/toolselect/keywordFilter';

describe('built-in MCP tool catalog', () => {
  it('makes child-agent orchestration discoverable through tools_search metadata', () => {
    const matches = keywordFilter(
      'Spawn a Team of agents in parallel, delegate work and collect their reports',
      listBuiltinMcpToolCatalog(),
      { limit: 5 }
    );

    expect(matches.map((match) => match.entry.name)).toContain('agent_spawn');

    const resultMatches = keywordFilter(
      'Collect the result report and output from a child agent',
      listBuiltinMcpToolCatalog(),
      {
        limit: 5,
      }
    );
    expect(resultMatches.map((match) => match.entry.name)).toContain('agent_result');
  });

  it('makes required repository inspection and command tools discoverable', () => {
    const matches = keywordFilter(
      'Read and search source code in the repository then run tests in the terminal',
      listBuiltinMcpToolCatalog(),
      { limit: 10 }
    );
    const names = matches.map((match) => match.entry.name);

    expect(names).toContain('tomny_read');
    expect(names).toContain('tomny_search');
    expect(names).toContain('tomny_command');
  });

  it('makes the bounded repository research tool discoverable for supported question types', () => {
    for (const query of [
      'Diagnose this bug and find the root cause',
      'Trace the message flow through the repository',
      'Explain the logic in this subsystem',
      'What is this file used for?',
    ]) {
      const names = keywordFilter(query, listBuiltinMcpToolCatalog(), { limit: 5 }).map((match) => match.entry.name);
      expect(names, query).toContain('ide_research');
    }
  });
});
