/** Projection of the optional shell-integration OSC 633 markers.
 * No percentage or "waiting for input" state is guessed from arbitrary output.
 */
export type HumanTerminalSignal = {
  phase: 'ready' | 'running' | 'error';
  lastCommand?: string;
  exitCode?: number;
};

export const terminalSignalFromOutput = (
  previous: HumanTerminalSignal | undefined,
  output: string
): HumanTerminalSignal | undefined => {
  // OSC 633 is emitted by integrated shells; missing markers leave status unknown.
  // eslint-disable-next-line no-control-regex
  const marker = /\u001b\]633;([CDE])(?:;([^\u0007\u001b]*))?(?:\u0007|\u001b\\)/g;
    const next: HumanTerminalSignal = previous ? { ...previous } : { phase: 'ready' };
  let changed = false;
  for (const match of output.matchAll(marker)) {
    if (match[1] === 'E') {
      next.lastCommand = match[2] ?? '';
      changed = true;
    }
    if (match[1] === 'C') {
      next.phase = 'running';
      delete next.exitCode;
      changed = true;
    }
    if (match[1] === 'D') {
      const raw = Number.parseInt(match[2] ?? '0', 10);
      next.exitCode = Number.isFinite(raw) ? raw : 0;
      next.phase = next.exitCode === 0 ? 'ready' : 'error';
      changed = true;
    }
  }
  return changed ? next : previous;
};
