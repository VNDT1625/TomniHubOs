import { describe, expect, it } from 'vitest';
import { createInventory } from '@/common/integrations/detectors';
import { hooks } from '@/common/integrations/detectors/agent';

const hooksFile = (command: string): string =>
  JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command }] }] } });

describe('hook command that needs a shell', () => {
  it('is not turned into a connection, and says so once', () => {
    const inventory = createInventory({
      files: ['hooks/hooks.json', '.claude-plugin/plugin.json'],
      readText: (file) => (file === 'hooks/hooks.json' ? hooksFile('node a.js | tee log.txt') : '{"name":"p"}'),
    });
    const result = hooks.detect(inventory);

    expect(result.connections).toEqual([]);
    expect(result.openItems).toEqual([
      expect.objectContaining({ kind: 'needs-runtime', note: expect.stringContaining('cần shell') }),
    ]);
  });
});
