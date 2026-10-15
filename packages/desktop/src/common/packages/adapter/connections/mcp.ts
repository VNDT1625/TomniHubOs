/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import {
  buildEnvironmentVariable,
  commonFields,
  connectionId,
  description,
  ENV_KEY,
  httpsUrl,
  findLaunchProblem,
  mcpLaunchArguments,
  packagePath,
  processCommand,
  title,
  type Shaped,
} from '../primitives';

/** Programs a local (stdio) MCP server may be started with. `node` is always run by the Hub through Electron. */
export const ADAPTER_MCP_COMMANDS = ['npx', 'uvx', 'docker', 'node', 'python', 'uv', 'bun'] as const;

/** `Authorization`, `X-Api-Key`, ...: a header name, never a header line. */
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;

/**
 * A header of a remote MCP server. The value always comes from the package's secret store through `fromEnv`; a
 * literal value in a repository is never copied into a package. This object is strict even in the tolerant read:
 * a header that carries a `value` (or anything else) makes the whole connection invalid instead of silently
 * dropping a secret that was written into the repository.
 */
const mcpHeader = z
  .object({ name: z.string().max(64).regex(HEADER_NAME), fromEnv: z.string().max(64).regex(ENV_KEY) })
  .strict();

/**
 * `mcp`: an MCP server. `transport` is `stdio` when absent (documents written before remote servers existed).
 * stdio starts a local program; http/sse connect to an https endpoint and have no `command`, so a host that only
 * knows stdio drops those connections as invalid and keeps the rest.
 */
export const buildMcpConnection = (shaped: Shaped) => {
  const env = z.array(buildEnvironmentVariable(shaped)).max(20).optional();
  const local = shaped({
    kind: z.literal('mcp'),
    transport: z.literal('stdio').optional(),
    id: connectionId,
    title,
    description: description.optional(),
    command: z.enum(ADAPTER_MCP_COMMANDS),
    args: mcpLaunchArguments.min(1),
    /** Working folder inside the package, when the server runs from source/. */
    cwd: packagePath.optional(),
    /** Commands run once before the first start (install dependencies). */
    setup: z.array(processCommand).max(6).optional(),
    env,
    ...commonFields,
  }).superRefine((value, context) => {
    // Flags are checked per program (see MCP_LAUNCH_FLAGS); a flag outside that list makes the connection invalid.
    const problem = findLaunchProblem(value.command, value.args);
    if (problem !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['args'], message: problem.reason });
    }
  });
  const remote = shaped({
    kind: z.literal('mcp'),
    transport: z.enum(['http', 'sse']),
    id: connectionId,
    title,
    description: description.optional(),
    url: httpsUrl(500),
    headers: z.array(mcpHeader).max(20).optional(),
    env,
    ...commonFields,
  });
  return z.union([local, remote]);
};
