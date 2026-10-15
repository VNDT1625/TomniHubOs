/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The run identity of a send carries the enabled package plugins in every capability mode (2026-10-16). Manual sends keep
 * their snapshot servers unchanged; auto sends keep their narrowed snapshot. In both, a package server joins the MCP list
 * by name (the snapshot keeps priority), and its name becomes a tool pattern, so its tools are allowed to run.
 */
import { describe, expect, it } from 'vitest';
import { resolveCoreToolCatalogPolicy } from '@process/experimentalCore/experimentalCoreRuntime';
import type { CapabilityTurn, PackageAttachmentTurn } from '@process/services/chatPipeline/stages/capabilitySelect';
import { contextIdentityFor } from '@process/services/database/nativeConversation/service';
import type { TChatConversation } from '@/common/config/storage';

const conversation = (extra: Record<string, unknown>): TChatConversation =>
  ({ id: 'conv-identity', type: 'acp', extra }) as unknown as TChatConversation;

const snapshot = {
  id: 'snap-1',
  name: 'snap-server',
  transport: { type: 'stdio', command: 'node', args: ['snap.js'] },
};

const packageSession = {
  id: 'pkgconn:context-mode:source',
  name: 'context-mode-source',
  transport: { type: 'stdio', command: 'npx', args: ['-y', 'context-mode'] },
};

const packageTurn: PackageAttachmentTurn = {
  mcpServers: [packageSession],
  attachedServerIds: [packageSession.id],
  hint: 'Enabled plugins are attached.',
};

const autoTurn: CapabilityTurn = {
  mode: 'auto',
  mcpServerIds: [],
  mcpServers: [],
  skillNames: [],
  hookIds: [],
  method: 'keyword',
  unusable: 0,
  hint: '',
};

describe('the run identity carries enabled package plugins in every mode', () => {
  it('manual send: the package server joins the snapshot servers, snapshot first', () => {
    const identity = contextIdentityFor(
      conversation({ capabilityMode: 'manual', session_mcp_servers: [snapshot] }),
      '',
      undefined,
      undefined,
      packageTurn
    );
    expect((identity.mcpServers ?? []).map((item) => item.name)).toEqual(['snap-server', 'context-mode-source']);
  });

  it('manual send without a package plugin keeps the snapshot servers unchanged', () => {
    const identity = contextIdentityFor(
      conversation({ capabilityMode: 'manual', session_mcp_servers: [snapshot] }),
      '',
      undefined,
      undefined,
      undefined
    );
    expect((identity.mcpServers ?? []).map((item) => item.name)).toEqual(['snap-server']);
  });

  it('auto send: the snapshot stays narrowed to the auto choice, and the package server is still added', () => {
    const identity = contextIdentityFor(
      conversation({ capabilityMode: 'auto', session_mcp_servers: [snapshot] }),
      '',
      undefined,
      autoTurn,
      packageTurn
    );
    expect((identity.mcpServers ?? []).map((item) => item.name)).toEqual(['context-mode-source']);
  });

  it('the package server name becomes a tool pattern of the run, so its MCP tools are allowed', () => {
    const identity = contextIdentityFor(
      conversation({ capabilityMode: 'manual' }),
      '',
      undefined,
      undefined,
      packageTurn
    );
    const policy = resolveCoreToolCatalogPolicy(undefined, false, identity.mcpServers ?? []);
    expect(policy.patterns).toContain('mcp__context-mode-source__*');
  });
});
