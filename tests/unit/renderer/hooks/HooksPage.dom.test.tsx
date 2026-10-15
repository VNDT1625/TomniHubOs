import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HookSettingsAuditLine,
  HookSettingsCoverageRow,
  HookSettingsRow,
  HookSettingsSwitches,
} from '@/common/integrations/hooks/hookSettings';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options === undefined ? key : `${key}|${JSON.stringify(options)}`,
  }),
}));

import HooksPage from '@/renderer/pages/integrations/hooks/HooksPage';

const ID = (char: string): string => char.repeat(64);
const HASH = `sha256-${'b'.repeat(64)}`;

const row = (id: string, over: Partial<HookSettingsRow> = {}): HookSettingsRow => ({
  id,
  source: 'user',
  event: 'PreToolUse',
  form: 'exec',
  command: 'node',
  args: ['${PLUGIN_ROOT}/guard.js', '--strict'],
  timeoutSec: 10,
  status: 'needs-approval',
  approved: false,
  active: false,
  ...over,
});

const DEFAULT_SWITCHES: HookSettingsSwitches = {
  disableAll: false,
  sources: { package: true, user: true, workspace: true },
};

const COVERAGE: HookSettingsCoverageRow[] = [
  { agent: 'tomny', preToolUse: 'all-tools', postToolUse: 'result-text' },
  { agent: 'acpAsk', preToolUse: 'permission-requests-only', postToolUse: 'metadata-only' },
  { agent: 'acpAuto', preToolUse: 'none', postToolUse: 'metadata-only' },
  { agent: 'codex', preToolUse: 'none', postToolUse: 'metadata-only' },
  { agent: 'remote', preToolUse: 'permission-requests-only', postToolUse: 'metadata-only' },
];

const api = vi.hoisted(() => ({
  list: vi.fn(),
  describe: vi.fn(),
  approve: vi.fn(),
  setEnabled: vi.fn(),
  setDisableAll: vi.fn(),
  setSourceEnabled: vi.fn(),
  createUser: vi.fn(),
  removeUser: vi.fn(),
  audit: vi.fn(),
  coverage: vi.fn(),
}));

let hooks: HookSettingsRow[];
let switches: HookSettingsSwitches;
let audit: HookSettingsAuditLine[];

beforeEach(() => {
  hooks = [
    row(ID('a'), {
      source: 'package',
      pluginId: 'com.x.guard',
      status: 'ready',
      approved: true,
      approvedAt: 1_700_000_000_000,
      active: true,
    }),
    row(ID('b'), { status: 'needs-approval' }),
    row(ID('c'), { status: 'stale', statusReason: 'content-changed' }),
    row(ID('d'), {
      form: 'shell',
      command: 'echo "$HOME" | tee /tmp/x',
      args: undefined,
      status: 'disabled',
      approved: true,
    }),
    row(ID('e'), { source: 'package', pluginId: 'com.x.shell', form: 'shell', status: 'forbidden' }),
  ];
  switches = { ...DEFAULT_SWITCHES, sources: { ...DEFAULT_SWITCHES.sources } };
  audit = [];
  api.list.mockImplementation(async () => ({ ok: true, data: { hooks, switches } }));
  api.coverage.mockResolvedValue({ ok: true, data: COVERAGE });
  api.audit.mockImplementation(async () => ({ ok: true, data: audit }));
  api.describe.mockResolvedValue({
    ok: true,
    data: {
      hookId: ID('b'),
      approvalHash: HASH,
      lines: [
        { key: 'source', value: 'user' },
        { key: 'event', value: 'PreToolUse' },
        { key: 'matcher', value: '*' },
        { key: 'form', value: 'exec' },
        { key: 'command', value: 'node' },
        { key: 'args', value: '${PLUGIN_ROOT}/guard.js' },
        { key: 'timeout', value: '10' },
        { key: 'file', value: 'guard.js' },
        { key: 'network', value: 'unrestricted' },
      ],
    },
  });
  api.approve.mockResolvedValue({ ok: true, data: row(ID('b'), { status: 'ready', approved: true, active: true }) });
  api.setEnabled.mockResolvedValue({ ok: true, data: row(ID('a')) });
  api.setDisableAll.mockResolvedValue({ ok: true, data: DEFAULT_SWITCHES });
  api.setSourceEnabled.mockResolvedValue({ ok: true, data: DEFAULT_SWITCHES });
  api.createUser.mockResolvedValue({ ok: true, data: row(ID('f')) });
  api.removeUser.mockResolvedValue({ ok: true, data: { removed: true } });
  (window as unknown as { electronAPI: unknown }).electronAPI = { hookSettings: api };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

const renderPage = async () => {
  render(
    <MemoryRouter>
      <HooksPage />
    </MemoryRouter>
  );
  await screen.findByTestId('hooks-page');
  await waitFor(() => expect(screen.getAllByTestId('hook-row').length).toBeGreaterThan(0));
};

const rowOf = (id: string): HTMLElement => {
  const found = screen.getAllByTestId('hook-row').find((element) => element.getAttribute('data-hook-id') === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
};

describe('Settings > Hooks page (design S10)', () => {
  it('says so when this window has no hook controls', () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    render(
      <MemoryRouter>
        <HooksPage />
      </MemoryRouter>
    );
    expect(screen.getByText('settings.hooks.unavailable')).toBeTruthy();
    expect(api.list).not.toHaveBeenCalled();
  });

  it('groups hooks by source and shows an empty state for a source without hooks', async () => {
    await renderPage();
    expect(within(screen.getByTestId('hook-source-package')).getAllByTestId('hook-row')).toHaveLength(2);
    expect(within(screen.getByTestId('hook-source-user')).getAllByTestId('hook-row')).toHaveLength(3);
    expect(within(screen.getByTestId('hook-source-workspace')).queryAllByTestId('hook-row')).toHaveLength(0);
    expect(within(screen.getByTestId('hook-source-workspace')).getByText('settings.hooks.sourceEmpty')).toBeTruthy();
  });

  it('shows the exact command, each argument, and what would run', async () => {
    await renderPage();
    const exec = rowOf(ID('b'));
    expect(within(exec).getByTestId('hook-command').textContent).toBe('node');
    expect(
      within(exec)
        .getAllByTestId('hook-arg')
        .map((element) => element.textContent)
    ).toEqual(['${PLUGIN_ROOT}/guard.js', '--strict']);
    const runs = within(exec).getByTestId('hook-what-runs').textContent ?? '';
    expect(runs).toContain('settings.hooks.row.runsExec');
    expect(runs).toContain('"program":"node"');
    expect(runs).toContain('"count":2');

    const shell = rowOf(ID('d'));
    expect(within(shell).getByTestId('hook-command').textContent).toBe('echo "$HOME" | tee /tmp/x');
    expect(within(shell).getByTestId('hook-what-runs').textContent).toBe('settings.hooks.row.runsShell');
  });

  it('labels every state with a word and explains the ones that need attention', async () => {
    await renderPage();
    const statusOf = (id: string) => within(rowOf(id)).getByTestId('hook-status').textContent;
    expect(statusOf(ID('a'))).toBe('settings.hooks.status.ready');
    expect(statusOf(ID('b'))).toBe('settings.hooks.status.needs-approval');
    expect(statusOf(ID('c'))).toBe('settings.hooks.status.stale');
    expect(statusOf(ID('e'))).toBe('settings.hooks.status.forbidden');
    expect(within(rowOf(ID('c'))).getByText('settings.hooks.statusHint.stale')).toBeTruthy();
    expect(within(rowOf(ID('e'))).getByText('settings.hooks.statusHint.forbidden')).toBeTruthy();
    // A package hook follows its plugin: the row offers no action, and the plugin group links to the package page.
    expect(within(rowOf(ID('e'))).queryAllByRole('button')).toHaveLength(0);
    expect(
      within(screen.getByTestId('hook-plugin-group-com.x.shell')).getByText('settings.capabilitiesTab.manageInPlugin')
    ).toBeTruthy();
  });

  it('states honestly which agents tool hooks can block', async () => {
    await renderPage();
    await screen.findByTestId('hook-coverage');
    const pre = (agent: string) =>
      screen.getByTestId('hook-coverage').querySelector(`[data-agent="${agent}"]`)?.getAttribute('data-pre');
    expect(pre('tomny')).toBe('all-tools');
    expect(pre('acpAsk')).toBe('permission-requests-only');
    expect(pre('acpAuto')).toBe('none');
    expect(pre('codex')).toBe('none');
    expect(within(screen.getByTestId('hook-coverage')).getByText('settings.hooks.coverage.summary')).toBeTruthy();
  });

  it('approves only the hash it was shown, after showing the describe lines', async () => {
    await renderPage();
    fireEvent.click(within(rowOf(ID('b'))).getByText('settings.hooks.action.review'));
    const lines = await screen.findByTestId('hook-approval-lines');
    expect(api.describe).toHaveBeenCalledWith({ hookId: ID('b') });
    expect(within(lines).getByText('settings.hooks.line.command')).toBeTruthy();
    expect(within(lines).getByText('node')).toBeTruthy();
    expect(within(lines).getByText('settings.hooks.networkUnrestricted')).toBeTruthy();
    expect(within(lines).getByText('settings.hooks.source.user')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('settings.hooks.dialog.approve'));
    });
    expect(api.approve).toHaveBeenCalledWith({ hookId: ID('b'), approvalHash: HASH });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.list.mock.calls.length).toBeGreaterThan(1);
  });

  it('keeps the dialog open and reads the hook again when Main says it changed', async () => {
    api.approve.mockResolvedValueOnce({ ok: false, error: 'HASH_MISMATCH' });
    await renderPage();
    fireEvent.click(within(rowOf(ID('b'))).getByText('settings.hooks.action.review'));
    await screen.findByTestId('hook-approval-lines');
    await act(async () => {
      fireEvent.click(screen.getByText('settings.hooks.dialog.approve'));
    });
    expect(await screen.findByText('settings.hooks.error.HASH_MISMATCH', { selector: 'p[role="alert"]' })).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(api.describe).toHaveBeenCalledTimes(2));
  });

  it('closes the dialog with Escape and with Cancel without approving', async () => {
    await renderPage();
    fireEvent.click(within(rowOf(ID('b'))).getByText('settings.hooks.action.review'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(rowOf(ID('c'))).getByText('settings.hooks.action.reapprove'));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByText('settings.hooks.dialog.cancel'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.approve).not.toHaveBeenCalled();
  });

  it('gives package hooks no switch of their own and still turns a user-level disabled hook back on', async () => {
    await renderPage();
    expect(within(rowOf(ID('a'))).queryByText('settings.hooks.action.disable')).toBeNull();
    expect(within(rowOf(ID('a'))).queryByRole('switch')).toBeNull();
    await act(async () => {
      fireEvent.click(within(rowOf(ID('d'))).getByText('settings.hooks.action.enable'));
    });
    expect(api.setEnabled).toHaveBeenCalledWith({ hookId: ID('d'), enabled: true });
  });

  it('drives the global and per-source switches', async () => {
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByTestId('hooks-master-switch'));
    });
    expect(api.setDisableAll).toHaveBeenCalledWith({ disabled: true });
    const userSwitch = within(screen.getByTestId('hook-source-user')).getByRole('switch');
    await act(async () => {
      fireEvent.click(userSwitch);
    });
    expect(api.setSourceEnabled).toHaveBeenCalledWith({ source: 'user', enabled: false });
  });

  it('warns when everything is off and says which approved hooks will not run', async () => {
    switches = { disableAll: true, sources: { package: true, user: true, workspace: true } };
    hooks = [row(ID('a'), { status: 'ready', approved: true, active: false })];
    await renderPage();
    expect(screen.getByTestId('hooks-all-off').textContent).toBe('settings.hooks.allOffNote');
    expect((screen.getByTestId('hooks-master-switch') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('settings.hooks.inactiveBySwitch')).toBeTruthy();
  });

  it('shows a translated error when Main refuses an action', async () => {
    api.setEnabled.mockResolvedValueOnce({ ok: false, error: 'APPROVAL_REQUIRED' });
    await renderPage();
    await act(async () => {
      fireEvent.click(within(rowOf(ID('d'))).getByText('settings.hooks.action.enable'));
    });
    expect((await screen.findByTestId('hooks-notice')).textContent).toContain('settings.hooks.error.APPROVAL_REQUIRED');
  });

  it('lists recent runs with lengths and codes only', async () => {
    audit = [
      {
        ts: '2026-10-15T00:00:00.000Z',
        event: 'PreToolUse',
        hookId: ID('a'),
        source: 'package',
        durationMs: 1500,
        exitCode: 2,
        timedOut: false,
        decision: 'deny',
        stdoutLength: 12,
        stderrLength: 0,
      },
      {
        ts: '2026-10-15T00:00:01.000Z',
        event: 'PostToolUse',
        hookId: ID('c'),
        source: 'user',
        durationMs: 0,
        exitCode: null,
        timedOut: false,
        decision: 'none',
        stdoutLength: 0,
        stderrLength: 0,
        errorCode: 'approval-stale',
      },
    ];
    await renderPage();
    const lines = await screen.findAllByTestId('hook-audit-line');
    expect(lines).toHaveLength(2);
    // Newest first.
    expect(within(lines[0] as HTMLElement).getByText('settings.hooks.audit.stale')).toBeTruthy();
    expect(within(lines[1] as HTMLElement).getByText('settings.hooks.audit.decision.deny')).toBeTruthy();
    expect(within(lines[1] as HTMLElement).getByText('aaaaaaaa')).toBeTruthy();
  });

  it('shows an empty state when nothing has run', async () => {
    await renderPage();
    expect(within(screen.getByTestId('hook-audit')).getByText('settings.hooks.audit.empty')).toBeTruthy();
  });

  it('adds a hook of your own: arguments mean a program, no arguments mean a shell line', async () => {
    await renderPage();
    const form = screen.getByTestId('hook-create');
    const textboxes = within(form).getAllByRole('textbox');
    // matcher, command, arguments
    fireEvent.change(textboxes[1] as HTMLElement, { target: { value: 'node' } });
    fireEvent.change(textboxes[2] as HTMLElement, { target: { value: 'guard.js\n\n--strict \n' } });
    await act(async () => {
      fireEvent.click(within(form).getByText('settings.hooks.create.submit'));
    });
    expect(api.createUser).toHaveBeenCalledWith({
      event: 'SessionStart',
      command: 'node',
      args: ['guard.js', '--strict'],
      timeoutSec: 30,
    });

    fireEvent.change(within(form).getAllByRole('textbox')[1] as HTMLElement, { target: { value: 'echo hi' } });
    await act(async () => {
      fireEvent.click(within(form).getByText('settings.hooks.create.submit'));
    });
    expect(api.createUser).toHaveBeenLastCalledWith({ event: 'SessionStart', command: 'echo hi', timeoutSec: 30 });
  });

  it('removes only your own hooks, and only after confirming', async () => {
    await renderPage();
    expect(within(rowOf(ID('a'))).queryByText('settings.hooks.action.remove')).toBeNull();
    fireEvent.click(within(rowOf(ID('b'))).getByText('settings.hooks.action.remove'));
    expect(api.removeUser).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByTestId('btn-confirm-remove'));
    });
    expect(api.removeUser).toHaveBeenCalledWith({ hookId: ID('b') });
  });

  it('does not remove a user hook when the confirmation is cancelled', async () => {
    await renderPage();
    fireEvent.click(within(rowOf(ID('b'))).getByText('settings.hooks.action.remove'));
    await act(async () => {
      fireEvent.click(screen.getByText(/^common\.cancel/));
    });
    expect(api.removeUser).not.toHaveBeenCalled();
  });

  it('manages package hooks from their plugin page, never from the hook row', async () => {
    render(
      <MemoryRouter initialEntries={['/settings/capabilities?tab=hooks']}>
        <Routes>
          <Route path='/settings/capabilities' element={<HooksPage />} />
          <Route path='/store/package/:packageId' element={<div data-testid='store-page'>store</div>} />
        </Routes>
      </MemoryRouter>
    );
    await screen.findByTestId('hooks-page');
    await waitFor(() => expect(screen.getAllByTestId('hook-row').length).toBeGreaterThan(0));
    expect(within(rowOf(ID('e'))).queryByRole('button')).toBeNull();
    const group = screen.getByTestId('hook-plugin-group-com.x.shell');
    expect((group as HTMLDetailsElement).open).toBe(false);
    fireEvent.click(within(group).getByText('settings.capabilitiesTab.manageInPlugin'));
    expect(await screen.findByTestId('store-page')).toBeTruthy();
    expect(api.removeUser).not.toHaveBeenCalled();
  });
});
