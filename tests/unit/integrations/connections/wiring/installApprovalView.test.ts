import { describe, expect, it } from 'vitest';
import type { InstallActivationItem } from '@process/integrations/connections/wiring/installActivation';
import {
  buildInstallApprovalGroups,
  buildInstallApprovalRequest,
} from '@process/integrations/connections/wiring/installApprovalView';
import { installReportLines } from '@process/integrations/connections/wiring/installReport';

const hook = (id: string, command: string): InstallActivationItem => ({
  key: `hook:${id}`,
  kind: 'hook',
  subject: {
    kind: 'hook',
    title: 'PostToolUse hook',
    files: [],
    lines: [
      { label: 'Source', value: 'package' },
      { label: 'Event', value: 'PostToolUse' },
      { label: 'Command', value: command },
      { label: 'Outgoing network of the hook', value: 'not restricted in this version' },
    ],
  },
});

const mcp: InstallActivationItem = {
  key: 'mcp:context7',
  kind: 'mcp',
  subject: {
    kind: 'mcp',
    title: 'context7',
    files: [],
    lines: [
      { label: 'Type', value: 'MCP server (stdio, a local program)' },
      { label: 'Command', value: 'npx -y ctx@1.0.0' },
      { label: 'Working folder', value: 'not set' },
      { label: 'Setup commands', value: 'npm install' },
    ],
  },
};

describe('the approval view of one package', () => {
  it('groups by kind with MCP, hooks and CLI first, and merges identical hooks into one row with a count', () => {
    const groups = buildInstallApprovalGroups([
      hook('a', 'node a.js'),
      hook('b', 'node a.js'),
      hook('c', 'node c.js'),
      mcp,
    ]);
    expect(groups.map((group) => [group.kind, group.count])).toEqual([
      ['mcp', 1],
      ['hook', 3],
    ]);
    const hooks = groups[1];
    expect(hooks?.rows.map((row) => row.count)).toEqual([2, 1]);
  });

  it('shows the lines every hook shares once for the group, and keeps the rest per row', () => {
    const [hooks] = buildInstallApprovalGroups([hook('a', 'node a.js'), hook('c', 'node c.js')]);
    expect(hooks?.shared.map((field) => field.label)).toEqual(['Source', 'Event', 'Outgoing network of the hook']);
    expect(hooks?.rows.map((row) => row.fields.map((field) => field.id))).toEqual([['command'], ['command']]);
    expect(hooks?.risks).toEqual(['network-open']);
  });

  it('flags a setup command that installs packages, and classifies the host labels', () => {
    const [mcpGroup] = buildInstallApprovalGroups([mcp]);
    expect(mcpGroup?.rows[0]?.fields.map((field) => field.id)).toEqual(['other', 'command', 'folder', 'setup']);
    expect(mcpGroup?.risks).toEqual(['setup-install']);
  });

  it('keeps a label it does not know as the host wrote it', () => {
    const [group] = buildInstallApprovalGroups([
      {
        key: 'cli:tool',
        kind: 'cli',
        subject: {
          kind: 'cli',
          title: 'Tool',
          files: [],
          lines: [{ label: 'Secrets given to the program', value: 'none' }],
        },
      },
    ]);
    expect(group?.rows[0]?.fields).toEqual([{ id: 'other', label: 'Secrets given to the program', value: 'none' }]);
  });

  it('builds the request with exactly the keys it covers', () => {
    const request = buildInstallApprovalRequest({
      requestId: 'r1',
      packageId: 'pkg.one',
      packageName: 'Pkg',
      items: [mcp, hook('a', 'node a.js')],
    });
    expect(request.keys).toEqual(['mcp:context7', 'hook:a']);
    expect(request).toMatchObject({ requestId: 'r1', packageId: 'pkg.one', packageName: 'Pkg' });
  });
});

describe('the install report', () => {
  it('says per kind what is on, whether it starts again, and what stayed off with the reason', () => {
    const lines = installReportLines({
      connections: [
        { key: 'mcp:context7', status: 'on' },
        { key: 'hook:a', status: 'off' },
        { key: 'hook:b', status: 'off' },
        { key: 'skill:source/skills/a', status: 'on' },
      ],
      activation: {
        enabled: [
          { key: 'mcp:context7', kind: 'mcp', autoStart: true },
          { key: 'skill:source/skills/a', kind: 'skill', autoStart: false },
        ],
        stayedOff: [
          { key: 'hook:a', reason: 'Bạn chưa duyệt, kết nối vẫn tắt.' },
          { key: 'hook:b', reason: 'Bạn chưa duyệt, kết nối vẫn tắt.' },
        ],
      },
    });
    const text = lines.join('\n');
    expect(text).toContain('Đã bật 2 kết nối');
    expect(text).toContain('MCP (1): `mcp:context7` (tự bật khi mở lại ứng dụng; xem và quản lý trong Cài đặt → MCP)');
    expect(text).toContain('Skill (1): `skill:source/skills/a`');
    expect(text).toContain('Còn tắt 2 kết nối');
    expect(text).toContain('Hook (2): `hook:a`, `hook:b` — Bạn chưa duyệt, kết nối vẫn tắt.');
  });

  it('never reports a connection as off when it is on', () => {
    const text = installReportLines({
      connections: [{ key: 'mcp:context7', status: 'on' }],
      activation: { enabled: [{ key: 'mcp:context7', kind: 'mcp', autoStart: false }], stayedOff: [] },
    }).join('\n');
    expect(text).toContain('Đã bật 1 kết nối');
    expect(text).not.toContain('Còn tắt');
    expect(text).toContain('chỉ bật trong phiên này');
  });

  it('says when a package declares no connection', () => {
    expect(installReportLines({ connections: [] })).toEqual(['Gói này không khai báo kết nối nào.']);
  });
});
