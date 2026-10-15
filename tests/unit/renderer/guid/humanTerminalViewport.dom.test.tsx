import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HumanTerminalViewport } from '@/renderer/pages/guid/HubHome/terminal/HumanTerminalViewport';

const terminalTest = vi.hoisted(() => ({
  resize: vi.fn(),
  write: vi.fn(),
  onData: vi.fn(),
  latestData: null as ((data: string) => void) | null,
  stdinDisabled: false,
  dispose: vi.fn(),
}));

vi.mock('@/renderer/pages/guid/HubHome/terminal/HumanTerminalContext', () => ({
  useHumanTerminals: () => ({
    buffers: { human1: 'ready> ' },
    write: terminalTest.write,
    resize: terminalTest.resize,
  }),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 90;
    rows = 24;
    constructor(options: { disableStdin: boolean }) {
      terminalTest.stdinDisabled = options.disableStdin;
    }
    loadAddon(): void {}
    open(): void {}
    reset(): void {}
    write(): void {}
    dispose(): void {
      terminalTest.dispose();
    }
    onData(callback: (data: string) => void) {
      terminalTest.latestData = callback;
      terminalTest.onData(callback);
      return { dispose: vi.fn() };
    }
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit(): void {}
  },
}));

beforeEach(() => {
  terminalTest.write.mockClear();
  terminalTest.resize.mockClear();
  terminalTest.onData.mockClear();
  terminalTest.dispose.mockClear();
  terminalTest.latestData = null;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(480);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(230);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Human Terminal xterm input/resize ownership', () => {
  it('allows the Console rail to type into one selected PTY in Chat Mode', () => {
    render(<HumanTerminalViewport sessionId='human1' inRail />);
    expect(screen.getByTestId('hub-console-output')).toHaveAttribute('aria-label', 'Interactive Console terminal');
    expect(terminalTest.stdinDisabled).toBe(false);
    expect(terminalTest.resize).toHaveBeenCalledWith('human1', 90, 24);
    act(() => {
      terminalTest.latestData?.('echo hello\r');
    });
    expect(terminalTest.write).toHaveBeenCalledWith('human1', 'echo hello\r');
  });

  it('keeps the rail read-only and never resizes the main PTY during Terminal Mode', () => {
    render(<HumanTerminalViewport sessionId='human1' inRail readOnly noResize />);
    expect(screen.getByTestId('hub-console-output')).toBeInTheDocument();
    expect(terminalTest.stdinDisabled).toBe(true);
    expect(terminalTest.resize).not.toHaveBeenCalled();
    expect(terminalTest.onData).not.toHaveBeenCalled();
  });

  it('allows the active main Terminal to own its PTY dimensions', () => {
    render(<HumanTerminalViewport sessionId='human1' />);
    expect(screen.getByTestId('hub-active-terminal')).toBeInTheDocument();
    expect(terminalTest.resize).toHaveBeenCalledWith('human1', 90, 24);
  });
});
