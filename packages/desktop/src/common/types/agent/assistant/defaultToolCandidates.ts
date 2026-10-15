/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IMcpServer } from '@/common/config/storage';
import {
  defaultToolId,
  estimateToolSchemaBytes,
  isDefaultToolId,
  type DefaultToolCandidate,
} from './assistantDefaultTools';

/**
 * Every tool of every MCP server, as candidates for an assistant's default tools. A tool is `approved` when its server
 * is built in or last connected successfully; `serverEnabled` is the person's own switch. Tools whose names cannot form
 * a valid id are left out. Nothing here enables anything.
 */
export const buildDefaultToolCandidates = (servers: readonly IMcpServer[]): DefaultToolCandidate[] =>
  servers.flatMap((server) =>
    (server.tools ?? [])
      .map((tool) => ({
        id: defaultToolId(server.id, tool.name),
        name: tool.name,
        serverId: server.id,
        serverName: server.name,
        schemaBytes: estimateToolSchemaBytes(tool),
        serverEnabled: server.enabled,
        approved: server.builtin === true || server.last_test_status === 'connected',
      }))
      .filter((candidate) => isDefaultToolId(candidate.id))
  );
