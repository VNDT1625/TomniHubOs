/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in MCP server for the agent-company model (Requirement 3.1 — Agent
 * plane).
 *
 * Runs as a standalone stdio process spawned by the MCP client, mirroring
 * `imageGenServer.ts` / `resourceServer.ts`. It exposes a small set of
 * read/safe tools so an agent can shape and inspect a company without driving a
 * live delegation:
 *
 * - `company_create`        — currently disabled until its provider execution
 *   uses a governed Main-owned request protocol.
 * - `company_get_structure` — return the elastic role tree for a company.
 * - `company_list_roles`    — flatten that tree into a role list.
 * - `company_get_rules`     — read a company's user-defined rules (criterion 3.10).
 * - `company_set_rules`     — replace a company's rules (criterion 3.10).
 *
 * `design.md` refers to these capabilities with dotted names (`company.create`,
 * `company.getStructure`, ...); like the image-gen tool (`tomny_image_generation`)
 * we use snake_case here while preserving the intent.
 *
 * ## Process boundary & shared state
 *
 * This server boots in a separate `node` process (not the Electron Main
 * process), so it cannot reach Electron's `app.getPath` or the live Main-process
 * company service singletons. Instead — exactly like `resourceServer.ts` reads
 * the coordinator's persisted `resource-state.json` — it reads/writes the same
 * on-disk `company.json` / memory tree that the {@link companyBridge} (UI plane)
 * uses. The companies data directory is injected through
 * {@link COMPANY_ENV_KEYS.dataDir}; both planes therefore see the *same state*
 * via that shared directory (design note: "cùng một service").
 *
 * `company_create` is disabled until the child can use a sealed Main-owned
 * provider-request protocol. A standalone stdio child must not receive or read
 * BYOK credentials because it cannot prove a run-bound origin, destination,
 * final-egress inspection, revocation, or a durable transport receipt. The
 * local structure and rule tools remain available because they do not perform
 * provider or network work.
 *
 * NOTE: registering this server (spawn command/args/env) into
 * `builtinMcp/constants.ts` and the bootstrap is Task 15.1; this module only
 * exports the identifiers/env keys that task will wire.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  applyRulesToContext,
  createCompanyConfigStore,
  toStructureSpec,
  type ICompanyConfigStore,
} from '@process/company/companyConfig';
import {
  createCompanyOrchestrator,
  type CompanyStructure,
  type CompanyStructureSpec,
  type RoleNode,
  type TeamGateway,
} from '@process/company/companyOrchestrator';
import { ContextLayering } from '@process/company/contextLayering';
import { createMemoryStore } from '@process/company/memoryStore';
import { createCallTemplateManager, createFileCallTemplateStore } from '@process/company/callTemplate';

/** Stable identifier of the built-in Company MCP server (consumed by Task 15.1). */
export const BUILTIN_COMPANY_ID = 'builtin-company';

/** Canonical name of the built-in Company MCP server (consumed by Task 15.1). */
export const BUILTIN_COMPANY_NAME = 'tomny-company';

/**
 * Environment variables injected into this standalone process. Provider
 * credential keys are deliberately absent: the child is not allowed to receive
 * or read them until a governed Main-owned request protocol exists.
 */
export const COMPANY_ENV_KEYS = {
  /** Directory holding the per-company `company.json` / memory tree. */
  dataDir: 'TOMNY_COMPANY_DATA_DIR',
} as const;

/**
 * Stable, redacted failure returned before credential access or network I/O.
 * The eventual replacement must bind a child request to a Main-owned run,
 * destination, opaque secret lease, final-payload inspection, cancellation,
 * and terminal receipt.
 */
export const COMPANY_GENERATOR_TRANSPORT_DISABLED = 'COMPANY_GENERATOR_TRANSPORT_DISABLED';

/** Standard MCP text payload, optionally flagged as an error. */
const textResult = (
  text: string,
  isError = false
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } => ({
  content: [{ type: 'text' as const, text }],
  ...(isError ? { isError: true } : {}),
});

/** Resolve the companies data directory, or `undefined` when not injected. */
const companyDataDir = (): string | undefined => process.env[COMPANY_ENV_KEYS.dataDir] || undefined;

/**
 * A {@link TeamGateway} whose every method rejects. Live delegation (spawning
 * agents) is intentionally NOT part of this read/safe MCP surface; the gateway
 * exists only because {@link createCompanyOrchestrator} requires it, and the
 * structure tools call only the pure `createStructure`, which never touches it.
 */
const notWiredTeamGateway: TeamGateway = {
  createTeam: () =>
    Promise.reject(
      new Error('[CompanyMCP] team delegation is not available from the MCP server (read/safe structure tools only).')
    ),
  spawnTeammate: () =>
    Promise.reject(
      new Error('[CompanyMCP] team delegation is not available from the MCP server (read/safe structure tools only).')
    ),
  sendMessage: () =>
    Promise.reject(
      new Error('[CompanyMCP] team delegation is not available from the MCP server (read/safe structure tools only).')
    ),
  awaitResult: () =>
    Promise.reject(
      new Error('[CompanyMCP] team delegation is not available from the MCP server (read/safe structure tools only).')
    ),
};

/** Open a config store rooted at the injected data dir (callers must ensure it exists). */
const openConfigStore = (dataDir: string): ICompanyConfigStore => createCompanyConfigStore({ localRootDir: dataDir });

/**
 * Build the elastic role tree for a spec by reusing the orchestrator's pure
 * `createStructure`. The memory/template stores and team gateway are required by
 * the factory but never exercised by `createStructure`.
 */
const buildStructure = (spec: CompanyStructureSpec, dataDir: string): CompanyStructure => {
  const orchestrator = createCompanyOrchestrator({
    contextLayering: new ContextLayering(),
    memoryStore: createMemoryStore({ companyId: spec.companyId, localRootDir: dataDir }),
    callTemplateManager: createCallTemplateManager({
      probe: () => Promise.reject(new Error('[CompanyMCP] CLI probing is not available from the MCP server.')),
      store: createFileCallTemplateStore({ baseDir: dataDir }),
    }),
    teamGateway: notWiredTeamGateway,
  });
  return orchestrator.createStructure(spec);
};

/** Flatten a role tree into a compact, agent-friendly list. */
const flattenRoles = (
  node: RoleNode
): Array<{ id: string; role: RoleNode['role']; name: string; divisionId?: string }> => [
  { id: node.id, role: node.role, name: node.name, ...(node.divisionId ? { divisionId: node.divisionId } : {}) },
  ...node.children.flatMap(flattenRoles),
];

/** Stringify any caught error for an MCP text payload. */
const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Create the Company MCP server without starting a transport. */
export const createCompanyServer = (): McpServer => {
  const server = new McpServer({
    name: BUILTIN_COMPANY_NAME,
    version: '1.0.0',
  });

  // --- company_create (criterion 3.11) ------------------------------------
  server.tool(
    'company_create',
    `This operation is currently unavailable. The standalone child cannot safely
perform BYOK provider execution until it uses a sealed Main-owned request
protocol with authority, final-egress inspection, revocation, and a durable
receipt. Local structure and rule tools remain available.`,
    {
      description: z.string().describe('Free-text description of the project/goal to design a company for.'),
      companyId: z.string().optional().describe('Stable company id to save under. Defaults to "company".'),
      presidentName: z.string().optional().describe('Fallback President name when the design omits one.'),
    },
    async () => textResult(`Error: ${COMPANY_GENERATOR_TRANSPORT_DISABLED}`, true)
  );

  // --- company_get_structure ----------------------------------------------
  server.tool(
    'company_get_structure',
    `Return the elastic role tree of a previously-created company.

Input:
- companyId: the company to inspect (required)

Returns the company structure (President → division heads → workers) as JSON. Requires the
company data directory to be available.`,
    {
      companyId: z.string().describe('Company id to load the structure for.'),
    },
    async ({ companyId }) => {
      const dataDir = companyDataDir();
      if (!dataDir) {
        return textResult(
          'Company data is unavailable: the company data directory was not provided to this server.',
          true
        );
      }
      try {
        const config = await openConfigStore(dataDir).load(companyId);
        const structure = buildStructure(toStructureSpec(config), dataDir);
        return textResult(JSON.stringify(structure, null, 2));
      } catch (error) {
        return textResult(`Error reading company structure: ${describeError(error)}`, true);
      }
    }
  );

  // --- company_list_roles --------------------------------------------------
  server.tool(
    'company_list_roles',
    `List the roles of a company as a flat array (id, role, name, division).

Input:
- companyId: the company to inspect (required)

Returns a JSON array describing every role in the company tree. Requires the company data
directory to be available.`,
    {
      companyId: z.string().describe('Company id to list roles for.'),
    },
    async ({ companyId }) => {
      const dataDir = companyDataDir();
      if (!dataDir) {
        return textResult(
          'Company data is unavailable: the company data directory was not provided to this server.',
          true
        );
      }
      try {
        const config = await openConfigStore(dataDir).load(companyId);
        const structure = buildStructure(toStructureSpec(config), dataDir);
        return textResult(JSON.stringify(flattenRoles(structure.root), null, 2));
      } catch (error) {
        return textResult(`Error listing company roles: ${describeError(error)}`, true);
      }
    }
  );

  // --- company_get_rules (criterion 3.10) ---------------------------------
  server.tool(
    'company_get_rules',
    `Read a company's user-defined rules (e.g. "every plan must be reviewed by the System Architect").

Input:
- companyId: the company to inspect (required)

Returns the rules as a JSON string array. Requires the company data directory to be available.`,
    {
      companyId: z.string().describe('Company id to read rules for.'),
    },
    async ({ companyId }) => {
      const dataDir = companyDataDir();
      if (!dataDir) {
        return textResult(
          'Company data is unavailable: the company data directory was not provided to this server.',
          true
        );
      }
      try {
        const rules = await openConfigStore(dataDir).getRules(companyId);
        return textResult(JSON.stringify(rules, null, 2));
      } catch (error) {
        return textResult(`Error reading company rules: ${describeError(error)}`, true);
      }
    }
  );

  // --- company_set_rules (criterion 3.10) ---------------------------------
  server.tool(
    'company_set_rules',
    `Replace a company's rules. These rules are injected into every downward delegation, so all
agents in the company must follow them.

Input:
- companyId: the company to update (required)
- rules: the full replacement list of rule strings (required)

Returns the saved company configuration as JSON. Requires the company data directory to be available.`,
    {
      companyId: z.string().describe('Company id to update rules for.'),
      rules: z.array(z.string()).describe('Full replacement list of company rule strings.'),
    },
    async ({ companyId, rules }) => {
      const dataDir = companyDataDir();
      if (!dataDir) {
        return textResult(
          'Company data is unavailable: the company data directory was not provided to this server.',
          true
        );
      }
      try {
        const config = await openConfigStore(dataDir).setRules(companyId, rules);
        // Reflect the rules into a fresh context layer so the rendering is consistent
        // with how the orchestrator composes briefings (no persisted side effect here).
        applyRulesToContext(config.rules, new ContextLayering());
        return textResult(JSON.stringify(config, null, 2));
      } catch (error) {
        return textResult(`Error setting company rules: ${describeError(error)}`, true);
      }
    }
  );

  return server;
};

export const startCompanyServer = async (): Promise<void> => {
  const server = createCompanyServer();
  await server.connect(new StdioServerTransport());
};

if (typeof require !== 'undefined' && require.main === module) {
  void startCompanyServer().catch((error) => {
    console.error('[CompanyMCP] Fatal error:', error);
    process.exit(1);
  });
}
