/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildAttachMenuModel,
  installedPluginsOf,
  pendingPluginEntries,
  pluginEnableOutcome,
} from '@/renderer/components/media/attachMenu/attachMenuModel';

const PACKAGE = 'com.community.context-mode';
const SERVER = `pkgconn:${PACKAGE}:context-mode-source`;

describe('installed plugins of the attach menu', () => {
  it('lists one plugin per MCP connection, on or off, with the server id the connection host registers', () => {
    expect(
      installedPluginsOf(PACKAGE, [
        { key: 'mcp:context-mode-source', kind: 'mcp', title: 'context-mode' },
        { key: 'skill:source/skills/ctx', kind: 'skill', title: 'ctx' },
        { key: 'hook:posttooluse-0-e0ced60c', kind: 'hook', title: 'PostToolUse' },
      ])
    ).toEqual([{ packageId: PACKAGE, title: 'context-mode', serverId: SERVER }]);
  });

  it('a package without an MCP connection is not a plugin row', () => {
    expect(installedPluginsOf(PACKAGE, [{ key: 'skill:source/skills/ctx', kind: 'skill', title: 'ctx' }])).toEqual([]);
  });

  it('an off plugin (no server in the catalog) is a pending entry of its package; an on one is not', () => {
    const plugins = installedPluginsOf(PACKAGE, [
      { key: 'mcp:context-mode-source', kind: 'mcp', title: 'context-mode' },
    ]);
    expect(pendingPluginEntries(plugins, new Set())).toEqual([
      { item: { id: SERVER, name: 'context-mode', status: 'unsupported' }, packageId: PACKAGE, pending: true },
    ]);
    expect(pendingPluginEntries(plugins, new Set([SERVER]))).toEqual([]);
  });

  it('clusters a pending plugin under its package name, and never lists it as standalone', () => {
    const pending = pendingPluginEntries(
      installedPluginsOf(PACKAGE, [{ key: 'mcp:context-mode-source', kind: 'mcp', title: 'context-mode' }]),
      new Set()
    );
    const model = buildAttachMenuModel(pending, [], new Map([[PACKAGE, 'Context Mode']]));
    expect(model.standalone.mcp).toEqual([]);
    expect(model.packages).toHaveLength(1);
    expect(model.packages[0]).toMatchObject({ packageId: PACKAGE, name: 'Context Mode' });
    expect(model.packages[0]?.mcp.map((entry) => entry.item.id)).toEqual([SERVER]);
  });
});

describe('the outcome of picking an off plugin', () => {
  it('is on when the MCP connection came on, even if another connection of the package stayed off', () => {
    expect(
      pluginEnableOutcome({
        ok: true,
        data: {
          enabled: [{ key: 'mcp:context-mode-source', kind: 'mcp', autoStart: false }],
          stayedOff: [{ key: 'hook:precompact-1', reason: 'The event "PreCompact" is not supported yet.' }],
        },
      })
    ).toEqual({ kind: 'on' });
  });

  it('shows the reason when the MCP connection stayed off (a cancelled approval says so)', () => {
    expect(
      pluginEnableOutcome({
        ok: true,
        data: { enabled: [], stayedOff: [{ key: 'mcp:context-mode-source', reason: 'Bạn chưa duyệt.' }] },
      })
    ).toEqual({ kind: 'stayed-off', reason: 'Bạn chưa duyệt.' });
  });

  it('reports a failed request with its stable code', () => {
    expect(pluginEnableOutcome({ ok: false, error: 'DENIED' })).toEqual({ kind: 'failed', code: 'DENIED' });
  });
});
