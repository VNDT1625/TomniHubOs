import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PackageConnectionsSection } from '@/renderer/pages/hub/StoreProductDetail/connections/PackageConnectionsSection';

const mock = vi.hoisted(() => {
  return {
    t: (key: string) => key,
    list: vi.fn(),
    describe: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    setAutoStart: vi.fn(),
    setPackageEnabled: vi.fn(),
  };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mock.t }) }));

const pkg = 'user.local.demo';
const skillKey = 'skill:source/skills/demo';
const mcpKey = 'mcp:docs';
const K = 'guid.hubHome.connections.';

const skill = {
  key: skillKey,
  kind: 'skill',
  title: 'Demo skill',
  status: 'off',
  enabled: false,
  runsCode: false,
};
const mcp = {
  key: mcpKey,
  kind: 'mcp',
  title: 'Docs server',
  status: 'on',
  enabled: true,
  runsCode: true,
};
const hooks = ['a', 'b', 'c'].map((id) => ({
  key: `hook:${id}`,
  kind: 'hook',
  title: `Hook ${id.toUpperCase()}`,
  status: 'unsupported',
  enabled: false,
  runsCode: true,
  reason: 'PreCompact is not supported on this version',
}));
const rules = { key: 'rules:team', kind: 'rules', title: 'Team rules', status: 'off', enabled: false, runsCode: false };

/** Row of one connection, by its key. */
const rowOf = (key: string) => screen.getByTestId(`package-connection-${key}`);
/** The collapsible header of one kind. */
const groupToggle = (kind: string) => within(screen.getByTestId(`package-group-${kind}`)).getByRole('button');

describe('Store detail package cluster T2.6', () => {
  beforeEach(() => {
    mock.list.mockReset().mockResolvedValue({ ok: true, data: [skill, mcp, ...hooks, rules] });
    mock.describe.mockReset().mockResolvedValue({
      ok: true,
      data: {
        kind: 'mcp',
        title: 'Docs server',
        approvalHash: 'sha256-' + 'a'.repeat(64),
        lines: [{ label: 'Lệnh', value: 'npx docs-mcp' }],
        files: ['source/mcp/docs.json'],
      },
    });
    mock.enable.mockReset().mockResolvedValue({ ok: true, data: { ...mcp, status: 'on', enabled: true } });
    mock.disable.mockReset().mockResolvedValue({ ok: true, data: { ...mcp, status: 'off', enabled: false } });
    mock.setAutoStart.mockReset().mockResolvedValue({ ok: true, data: { ...mcp, autoStart: true } });
    mock.setPackageEnabled.mockReset().mockResolvedValue({ ok: true, data: { enabled: [], stayedOff: [] } });
    vi.stubGlobal('electronAPI', { packageConnections: mock });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows one summary line and one master switch, and groups rows by kind with the attention groups open', async () => {
    render(<PackageConnectionsSection packageId={pkg} />);
    expect(await screen.findByTestId('package-summary')).toHaveTextContent('1 MCP · 3 hook · 1 skill · 1 rules');
    expect(screen.getByRole('switch', { name: K + 'masterSwitch' })).toBeChecked();

    // Hooks are off with a reason, so their group opens and states the reason once for all three.
    expect(document.querySelectorAll('.hub-package-connection-note')).toHaveLength(1);
    expect(screen.queryByTestId('package-connection-hook:a')).toBeNull();

    // A skill group is collapsed by default and opens on a click; a data row has no switch.
    expect(screen.queryByTestId(`package-connection-${skillKey}`)).toBeNull();
    fireEvent.click(groupToggle('skill'));
    expect(within(rowOf(skillKey)).queryByRole('switch')).toBeNull();
  });

  it('gives a code-running row its own switch, and asks for approval before enabling it', async () => {
    mock.list.mockResolvedValue({ ok: true, data: [{ ...mcp, enabled: false, status: 'off' }] });
    render(<PackageConnectionsSection packageId={pkg} />);
    fireEvent.click(await waitFor(() => groupToggle('mcp')));
    const row = rowOf(mcpKey);
    fireEvent.click(within(row).getByRole('switch'));
    expect(await screen.findByText('npx docs-mcp')).toBeInTheDocument();
    expect(screen.getByText('source/mcp/docs.json')).toBeInTheDocument();
    expect(mock.describe).toHaveBeenCalledWith({ packageId: pkg, connectionKey: mcpKey });
    expect(mock.enable).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: K + 'confirm' }));
    await waitFor(() =>
      expect(mock.enable).toHaveBeenCalledWith({
        packageId: pkg,
        connectionKey: mcpKey,
        approvalHash: 'sha256-' + 'a'.repeat(64),
      })
    );
  });

  it('turns the whole package on through one call and reports the connections that stayed off', async () => {
    mock.list.mockResolvedValue({ ok: true, data: [skill, { ...mcp, enabled: false, status: 'off' }] });
    mock.setPackageEnabled.mockResolvedValue({
      ok: true,
      data: {
        enabled: [{ key: skillKey, kind: 'skill', autoStart: false }],
        stayedOff: [{ key: mcpKey, reason: 'x' }],
      },
    });
    render(<PackageConnectionsSection packageId={pkg} />);
    const master = await screen.findByRole('switch', { name: K + 'masterSwitch' });
    expect(master).not.toBeChecked();
    fireEvent.click(master);
    await waitFor(() => expect(mock.setPackageEnabled).toHaveBeenCalledWith({ packageId: pkg, enabled: true }));
    expect(await screen.findByText(K + 'stayedOff')).toBeInTheDocument();
  });

  it('turns the whole package off through one call', async () => {
    render(<PackageConnectionsSection packageId={pkg} />);
    fireEvent.click(await screen.findByRole('switch', { name: K + 'masterSwitch' }));
    await waitFor(() => expect(mock.setPackageEnabled).toHaveBeenCalledWith({ packageId: pkg, enabled: false }));
  });

  it('applies the package-level start-again choice to code rows, and keeps one per-row choice on code rows only', async () => {
    mock.list.mockResolvedValue({ ok: true, data: [skill, { ...mcp, autoStart: false }] });
    render(<PackageConnectionsSection packageId={pkg} />);
    expect(await screen.findByTestId('package-summary')).toHaveTextContent('1 MCP · 1 skill');
    fireEvent.click(groupToggle('mcp'));
    // Exactly one per-row checkbox: the code-running row. A data row never offers it.
    expect(screen.getAllByLabelText(K + 'autoStart')).toHaveLength(1);
    fireEvent.click(screen.getByLabelText(K + 'masterAutoStart'));
    await waitFor(() =>
      expect(mock.setAutoStart).toHaveBeenCalledWith({ packageId: pkg, connectionKey: mcpKey, autoStart: true })
    );
    expect(mock.enable).not.toHaveBeenCalled();
    expect(mock.describe).not.toHaveBeenCalled();
  });

  it('reports required variables and never enables a connection still needing input', async () => {
    const needsInput = {
      ...mcp,
      key: 'mcp:secret',
      title: 'Secret server',
      enabled: false,
      status: 'needs-input',
      requiredEnv: ['MY_TOKEN'],
      reason: 'MY_TOKEN is required',
    };
    mock.list.mockResolvedValueOnce({ ok: true, data: [needsInput] });
    const onSecrets = vi.fn();
    render(<PackageConnectionsSection packageId={pkg} onSecrets={onSecrets} />);
    expect(await screen.findByText('MY_TOKEN')).toBeInTheDocument();
    expect(within(rowOf('mcp:secret')).getByRole('switch')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: K + 'fillSecret' }));
    expect(onSecrets).toHaveBeenCalledOnce();
    expect(mock.enable).not.toHaveBeenCalled();
  });

  it('shows the View action on skill rows only when the host supplies the skill viewer', async () => {
    const onOpenSkill = vi.fn();
    const view = render(<PackageConnectionsSection packageId={pkg} onOpenSkill={onOpenSkill} />);
    fireEvent.click(await waitFor(() => groupToggle('skill')));
    fireEvent.click(screen.getByRole('button', { name: K + 'openSkill' }));
    expect(onOpenSkill).toHaveBeenCalledWith(skillKey);
    view.unmount();

    render(<PackageConnectionsSection packageId={pkg} />);
    fireEvent.click(await waitFor(() => groupToggle('skill')));
    expect(screen.queryByRole('button', { name: K + 'openSkill' })).toBeNull();
  });

  it('exposes launcher file selection and explicit open using only connection ids', async () => {
    const launcher = {
      key: 'launcher:desktop',
      kind: 'launcher',
      title: 'Desktop app',
      enabled: false,
      status: 'needs-input',
      runsCode: true,
      reason: 'Choose an executable',
    };
    mock.list.mockResolvedValue({ ok: true, data: [launcher] });
    const link = vi.fn().mockResolvedValue({ ok: true });
    const download = vi.fn().mockResolvedValue({ ok: true });
    const open = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('electronAPI', {
      packageConnections: mock,
      launcher: { link, download, open },
    });
    const view = render(<PackageConnectionsSection packageId={pkg} />);
    expect(await screen.findByText('Desktop app')).toBeInTheDocument();
    expect(within(rowOf('launcher:desktop')).getByRole('switch')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: K + 'chooseExecutable' }));
    await waitFor(() => expect(link).toHaveBeenCalledWith({ packageId: pkg, connectionId: 'desktop' }));
    await waitFor(() => expect(mock.list).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: K + 'downloadApp' }));
    await waitFor(() => expect(download).toHaveBeenCalledWith({ packageId: pkg, connectionId: 'desktop' }));
    mock.list.mockResolvedValue({ ok: true, data: [{ ...launcher, enabled: true, status: 'on' }] });
    view.rerender(<PackageConnectionsSection packageId={pkg} />);
    window.dispatchEvent(new CustomEvent('tomni-packages-changed'));
    fireEvent.click(await screen.findByRole('button', { name: K + 'openApp' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith({ packageId: pkg, connectionId: 'desktop' }));
    expect(mock.enable).not.toHaveBeenCalled();
  });
});
