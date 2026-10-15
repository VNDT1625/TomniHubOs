/** Human PTY viewport. Chat Console and main Terminal never both own the PTY
 * dimensions: the visible interactive viewport alone can fit/resize it.
 */
import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useHumanTerminals } from './HumanTerminalContext';

type Props = {
  sessionId: string;
    readOnly?: boolean;
    noResize?: boolean;
  /** Distinct placement regardless of whether this rail viewport may own resize. */
  inRail?: boolean;
  onFocus?: () => void;
};

export const HumanTerminalViewport: React.FC<Props> = ({ sessionId, readOnly = false, noResize = false, inRail = false, onFocus }) => {
  const state = useHumanTerminals();
  const ref = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const written = useRef('');
  const writeRef = useRef(state.write);
  const resizeRef = useRef(state.resize);
  writeRef.current = state.write;
  resizeRef.current = state.resize;

  useEffect(() => {
    const host = ref.current;
    if (!host) return undefined;
    const instance = new Terminal({
      cursorBlink: !readOnly,
      disableStdin: readOnly,
      convertEol: false,
      fontFamily: 'Cascadia Code, Consolas, Menlo, monospace',
      fontSize: 12,
      scrollback: 3000,
      theme: { background: '#10151d', foreground: '#dce4ee', cursor: '#8bdcb0' },
    });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    instance.open(host);
    terminal.current = instance;
    written.current = '';
    const doFit = (): void => {
      if (!host.clientWidth || !host.clientHeight) return;
      try {
        fit.fit();
        if (!readOnly && !noResize) resizeRef.current(sessionId, instance.cols, instance.rows);
      } catch {
        // A hidden panel can temporarily have no valid xterm dimensions.
      }
    };
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(doFit);
    resizeObserver?.observe(host);
    const input = readOnly ? null : instance.onData((data) => writeRef.current(sessionId, data));
    doFit();
    return () => {
      input?.dispose();
      resizeObserver?.disconnect();
      terminal.current = null;
      instance.dispose();
    };
  }, [sessionId, readOnly, noResize]);

  const buffer = state.buffers[sessionId] ?? '';
  useEffect(() => {
    const instance = terminal.current;
    if (!instance) return;
    if (!buffer.startsWith(written.current)) {
      instance.reset();
      written.current = '';
    }
    const delta = buffer.slice(written.current.length);
    if (delta) instance.write(delta);
    written.current = buffer;
  }, [buffer, sessionId, readOnly]);

  return (
    <div
      className={`hub-human-terminal-viewport ${inRail ? 'hub-human-terminal-mirror' : ''}`}
      data-testid={inRail ? 'hub-console-output' : 'hub-active-terminal'}
      ref={ref}
      onFocus={onFocus}
      aria-label={readOnly ? 'Terminal output' : inRail ? 'Interactive Console terminal' : 'Interactive terminal'}
    />
  );
};
