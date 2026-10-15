import { describe, expect, it } from 'vitest';
import { terminalSignalFromOutput } from '../../../packages/desktop/src/renderer/pages/guid/HubHome/terminal/terminalSignal';

const OSC = (payload: string): string => `\u001b]633;${payload}\u0007`;

describe('Human Terminal Overview signals', () => {
  it('does not invent progress or busy status for ordinary output', () => {
    expect(terminalSignalFromOutput(undefined, 'Compiling 68%...')).toBeUndefined();
  });

  it('tracks command start, success and failure from shell integration', () => {
    const entered = terminalSignalFromOutput(undefined, OSC('E;pnpm test'));
    expect(entered).toEqual({ phase: 'ready', lastCommand: 'pnpm test' });
    const running = terminalSignalFromOutput(entered, OSC('C'));
    expect(running).toEqual({ phase: 'running', lastCommand: 'pnpm test', exitCode: undefined });
    expect(terminalSignalFromOutput(running, OSC('D;0'))).toMatchObject({ phase: 'ready', exitCode: 0 });
    expect(terminalSignalFromOutput(running, OSC('D;1'))).toMatchObject({ phase: 'error', exitCode: 1 });
  });

  it('supports the ST terminator and preserves command metadata', () => {
    const withLine = terminalSignalFromOutput(undefined, `\u001b]633;E;git status\u001b\\`);
    expect(withLine?.lastCommand).toBe('git status');
    expect(terminalSignalFromOutput(withLine, OSC('D;not-a-number'))?.exitCode).toBe(0);
  });
});
