import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserTabInfo, TabUpdate } from '@/common/packages/browserHost';
import { attachBrowserLiveSessions } from '@/process/system/liveSessions/browserSessions';
import { LiveSessionRegistry } from '@/process/system/liveSessions/liveSessionRegistry';
import { attachTerminalLiveSessions } from '@/process/system/liveSessions/terminalSessions';
import type { TerminalSession } from '@/process/ideTerminal/terminalTypes';

const terminal = (patch: Partial<TerminalSession> = {}): TerminalSession => ({
  id: 't1',
  title: 'bash',
  shell: 'bash',
  cwd: '/work',
  status: 'running',
  createdAt: 1_000,
  exitedAt: null,
  exitCode: null,
  pid: 1,
  scheduled: false,
  ...patch,
});

const tab = (id: string, title = id): BrowserTabInfo => ({
  id,
  url: `https://example.com/${id}`,
  title,
  visible: false,
  bounds: { x: 0, y: 0, width: 1, height: 1 },
});

describe('attachTerminalLiveSessions', () => {
  let clock = 10_000;
  let sessions: TerminalSession[];
  let changed: ((s: TerminalSession[]) => void) | undefined;
  let data: ((e: { id: string }) => void) | undefined;
  let registry: LiveSessionRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    clock = 10_000;
    sessions = [terminal()];
    registry = new LiveSessionRegistry({ now: () => clock });
    attachTerminalLiveSessions(
      registry,
      {
        list: () => sessions,
        onSessionsChanged: (listener) => {
          changed = listener;
          return () => undefined;
        },
        onData: (listener) => {
          data = listener;
          return () => undefined;
        },
      },
      () => clock
    );
  });

  afterEach(() => {
    registry.dispose();
    vi.useRealTimers();
  });

  const reported = () => registry.snapshot().apps.find((app) => app.appId === 'terminal')?.sessions ?? [];

  it('reports running sessions only', () => {
    sessions = [terminal(), terminal({ id: 't2', status: 'exited', exitedAt: 5, exitCode: 0 })];
    changed?.(sessions);
    expect(reported().map((session) => session.id)).toEqual(['t1']);
  });

  it('labels scheduled sessions', () => {
    sessions = [terminal({ scheduled: true })];
    changed?.(sessions);
    expect(reported()[0].detail).toBe('theo lịch');
  });

  it('is working while output keeps arriving, then idle after three seconds', () => {
    changed?.(sessions);
    expect(reported()[0].status).toBe('idle');
    data?.({ id: 't1' });
    expect(reported()[0].status).toBe('working');
    clock += 3_001;
    vi.advanceTimersByTime(3_001);
    expect(reported()[0].status).toBe('idle');
    expect(reported()[0].lastActiveAt).toBe(10_000);
  });

  it('removes the app when the last running session goes away', () => {
    changed?.(sessions);
    sessions = [];
    changed?.(sessions);
    expect(registry.snapshot().apps).toEqual([]);
  });
});

describe('live session actions', () => {
  it('announces create and close for the Browser app only', () => {
    vi.useFakeTimers();
    const registry = new LiveSessionRegistry({ now: () => 1 });
    attachBrowserLiveSessions(
      registry,
      { listTabs: () => [tab('a')], onTabUpdate: () => () => undefined },
      { now: () => 1, pollMs: 1_000 }
    );
    attachTerminalLiveSessions(
      registry,
      { list: () => [terminal()], onSessionsChanged: () => () => undefined, onData: () => () => undefined },
      () => 1
    );
    const apps = registry.snapshot().apps;
    expect(apps.find((app) => app.appId === 'com.tomni.browser')?.actions).toEqual({ create: true, close: true });
    const terminalApp = apps.find((app) => app.appId !== 'com.tomni.browser');
    expect(terminalApp).toBeDefined();
    expect(terminalApp).not.toHaveProperty('actions');
    registry.dispose();
    vi.useRealTimers();
  });
});

describe('attachBrowserLiveSessions', () => {
  let tabs: BrowserTabInfo[];
  let update: ((u: TabUpdate) => void) | undefined;
  let clock = 50_000;
  let registry: LiveSessionRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    clock = 50_000;
    tabs = [tab('a', 'Google'), tab('b', 'YouTube')];
    registry = new LiveSessionRegistry({ now: () => clock });
    attachBrowserLiveSessions(
      registry,
      {
        listTabs: () => tabs,
        onTabUpdate: (listener) => {
          update = listener;
          return () => undefined;
        },
      },
      { now: () => clock, pollMs: 1_000 }
    );
  });

  afterEach(() => {
    registry.dispose();
    vi.useRealTimers();
  });

  const reported = () => registry.snapshot().apps.find((app) => app.appId === 'com.tomni.browser')?.sessions ?? [];

  it('maps each tab to an idle session', () => {
    vi.advanceTimersByTime(1_000);
    expect(reported().map((session) => [session.id, session.title, session.status])).toEqual([
      ['a', 'Google', 'idle'],
      ['b', 'YouTube', 'idle'],
    ]);
  });

  it('notices tabs opened or closed outside the bridge handlers', () => {
    vi.advanceTimersByTime(1_000);
    tabs = [tab('a', 'Google'), tab('c', 'GitHub')];
    vi.advanceTimersByTime(1_000);
    expect(reported().map((session) => session.id)).toEqual(['a', 'c']);
  });

  it('removes the app once the last tab closes', () => {
    vi.advanceTimersByTime(1_000);
    tabs = [];
    vi.advanceTimersByTime(1_000);
    expect(registry.snapshot().apps).toEqual([]);
  });

  it('refreshes lastActiveAt and the title when a tab updates', () => {
    vi.advanceTimersByTime(1_000);
    clock = 90_000;
    tabs = [tab('a', 'Google Search'), tab('b', 'YouTube')];
    update?.({ id: 'a', url: 'https://example.com/a', title: 'Google Search' });
    const first = reported().find((session) => session.id === 'a');
    expect(first?.title).toBe('Google Search');
    expect(first?.lastActiveAt).toBe(90_000);
  });

  it('never lists hidden background tabs that agents open for research', () => {
    tabs = [tab('a', 'Google'), { ...tab('bg', 'scrape'), background: true }];
    vi.advanceTimersByTime(1_000);
    expect(reported().map((session) => session.id)).toEqual(['a']);
  });

  it('falls back to the host name, not the full address, for an untitled tab', () => {
    tabs = [{ ...tab('a', ''), url: 'https://example.com/path?token=secret' }];
    vi.advanceTimersByTime(1_000);
    expect(reported()[0].title).toBe('example.com');
  });

  it('survives a failing tab source without touching the last report', () => {
    vi.advanceTimersByTime(1_000);
    const before = reported().length;
    tabs = undefined as unknown as BrowserTabInfo[];
    expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
    expect(reported()).toHaveLength(before);
  });
});
