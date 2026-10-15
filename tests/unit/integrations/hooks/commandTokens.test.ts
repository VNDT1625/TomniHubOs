import { describe, expect, it } from 'vitest';
import { commandToExecForm } from '@/common/integrations/hooks';

describe('commandToExecForm', () => {
  it('turns a plain Claude hook command into program and arguments', () => {
    expect(commandToExecForm('node "${CLAUDE_PLUGIN_ROOT}/hooks/posttooluse.mjs"')).toEqual({
      ok: true,
      program: 'node',
      args: ['${CLAUDE_PLUGIN_ROOT}/hooks/posttooluse.mjs'],
    });
    expect(commandToExecForm('python3 -u ${CLAUDE_PROJECT_DIR}/tools/check.py')).toEqual({
      ok: true,
      program: 'python3',
      args: ['-u', '${CLAUDE_PROJECT_DIR}/tools/check.py'],
    });
    expect(commandToExecForm("echo 'a b' \"c d\" ''")).toEqual({ ok: true, program: 'echo', args: ['a b', 'c d', ''] });
    expect(commandToExecForm('context-mode hook')).toEqual({ ok: true, program: 'context-mode', args: ['hook'] });
  });

  it.each([
    ['a pipe', 'node a.js | tee out.txt'],
    ['a list', 'node a.js && node b.js'],
    ['a semicolon', 'node a.js; rm -rf x'],
    ['command substitution', 'echo $(whoami)'],
    ['backticks', 'echo `whoami`'],
    ['a redirect', 'node a.js > out.txt'],
    ['an environment assignment', 'FOO=1 node a.js'],
    ['a glob', 'node *.js'],
    ['an unknown variable', 'node ${HOME}/a.js'],
    ['a placeholder inside single quotes', "node '${CLAUDE_PLUGIN_ROOT}/a.js'"],
    ['a tilde', 'node ~/a.js'],
    ['a backslash', 'node a\b.js'],
    ['a newline', 'node a.js\nnode b.js'],
    ['an unterminated quote', "echo 'a"],
    ['an empty line', '   '],
  ])('needs a shell for %s', (_label, command) => {
    expect(commandToExecForm(command).ok).toBe(false);
  });
});
