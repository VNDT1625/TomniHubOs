import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { SecretCaller, SecretScope } from '@process/agentRuntime/contextTypes';
import type { SecretContextUseRouter } from './router';
import { protectedMcpTextContent } from '../../security';

export const BUILTIN_SECRET_CONTEXT_NAME = 'tomny-secret-context';
export const BUILTIN_SECRET_CONTEXT_ID = 'builtin-secret-context';
/** In-app Tomny tools. Names are `tomny_secret_*`; the loopback server behind them is an implementation detail. */
export const AGENT_SECRET_CONTEXT_USE_TOOL = 'tomny_secret_use';
export const SECRET_CONTEXT_CAPTURE_TOOL = 'tomny_secret_capture';
export const SECRET_CONTEXT_GENERATE_TOOL = 'tomny_secret_generate';
export const SECRET_CONTEXT_LIST_TOOL = 'tomny_secret_list';
export const SECRET_CONTEXT_REQUEST_TOOL = 'tomny_secret_request';
export const SECRET_CONTEXT_ACCESS_TOOL = 'tomny_secret_request_access';
export const TOMNY_SECRET_TOOLS = [
  AGENT_SECRET_CONTEXT_USE_TOOL,
  SECRET_CONTEXT_CAPTURE_TOOL,
  SECRET_CONTEXT_GENERATE_TOOL,
  SECRET_CONTEXT_LIST_TOOL,
  SECRET_CONTEXT_REQUEST_TOOL,
  SECRET_CONTEXT_ACCESS_TOOL,
] as const;

export type SecretContextServerAuthority = Readonly<{
  scopeId: string;
  surface: string;
  allowedTabIds?: ReadonlySet<string>;
  sessionId?: string;
  companyId?: string;
  /** The Package App whose surface this run uses, resolved by Main. */
  packageId?: string;
}>;

export type SecretContextServerDeps = {
  router: SecretContextUseRouter;
  authority?: SecretContextServerAuthority;
};

const requireAllowedTab = (deps: SecretContextServerDeps, tabId: string): void => {
  if (deps.authority?.allowedTabIds && !deps.authority.allowedTabIds.has(tabId)) {
    throw new Error('Browser tab is outside the scoped Secret Context authority.');
  }
};

/** The run's identity, taken from the host authority and never from tool arguments. */
const callerOf = (deps: SecretContextServerDeps): SecretCaller | undefined => {
  const sessionId = deps.authority?.sessionId;
  const companyId = deps.authority?.companyId;
  const packageId = deps.authority?.packageId;
  return sessionId || companyId || packageId
    ? {
        ...(sessionId ? { sessionId } : {}),
        ...(companyId ? { companyId } : {}),
        ...(packageId ? { packageId } : {}),
      }
    : undefined;
};

const withCaller = (deps: SecretContextServerDeps): { caller?: SecretCaller } => {
  const caller = callerOf(deps);
  return caller ? { caller } : {};
};

/** `session` (default) keeps a captured or generated secret in RAM for this conversation only. */
const scopeFor = (deps: SecretContextServerDeps, choice: 'session' | 'app' | 'package'): SecretScope | undefined => {
  if (choice === 'app') return undefined;
  if (choice === 'package') {
    const packageId = deps.authority?.packageId;
    if (!packageId) throw new Error('This run does not use a Package App, so there is no package scope.');
    return { kind: 'package', packageId };
  }
  const sessionId = deps.authority?.sessionId;
  if (!sessionId) throw new Error('No session identity is available for a session-scoped secret.');
  return { kind: 'session', sessionId };
};

const textResult = (text: string, isError = false) => ({
  content: protectedMcpTextContent(text),
  ...(isError ? { isError: true } : {}),
});

const invoke = async (operation: () => Promise<unknown>, errorMessage: string) => {
  try {
    return textResult(JSON.stringify(await operation()));
  } catch {
    return textResult(errorMessage, true);
  }
};

const secretHandle = z
  .string()
  .trim()
  .min(10)
  .max(512)
  .refine((value) => value.startsWith('secret://'), 'Expected an opaque Core Secret Context handle.');
const secretField = z
  .string()
  .trim()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u, 'Expected a Core Secret Context field name.');
const hostname = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine((value) => {
    try {
      const parsed = new URL(`https://${value}`);
      return parsed.hostname.toLowerCase() === value.toLowerCase() && parsed.port === '';
    } catch {
      return false;
    }
  }, 'Expected an exact target hostname.');
const secretLabel = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (value) =>
      [...value].every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint >= 32 && codePoint !== 127;
      }),
    'Secret labels must be one line.'
  );
const secretKind = z.enum(['credential', 'password', 'token', 'cookie', 'private-key', 'other']);
const browserLocator = z.object({
  tabId: z.string().trim().min(1).max(256),
  selector: z.string().trim().min(1).max(2_000),
});
const useLocator = z.object({
  terminalId: z.string().trim().min(1).max(128).optional(),
  tabId: z.string().trim().min(1).max(256).optional(),
  selector: z.string().trim().min(1).max(2_000).optional(),
  processId: z.string().trim().min(1).max(128).optional(),
  variable: secretField.optional(),
  provider: z.string().trim().min(1).max(128).optional(),
  projectId: z.string().trim().min(1).max(128).optional(),
  environment: z.string().trim().min(1).max(128).optional(),
  name: secretField.optional(),
});

/** A standalone capability so child agents can use secrets without gaining orchestration tools. */
export const createSecretContextServer = (deps: SecretContextServerDeps): McpServer => {
  const server = new McpServer({ name: BUILTIN_SECRET_CONTEXT_NAME, version: '1.0.0' });

  server.tool(
    AGENT_SECRET_CONTEXT_USE_TOOL,
    'Use one opaque Secret Context field through a backend-preauthorized sink. The trusted host evaluates exact destination policy automatically and returns only a non-secret receipt.',
    {
      handle: secretHandle,
      field: secretField,
      sink: z.enum(['browser.fill', 'terminal.input', 'process.env.inject', 'deployment.secret.put']),
      locator: useLocator,
      target: hostname.optional(),
      submit: z.boolean().optional().describe('terminal.input only: press Enter after typing (default true).'),
    },
    async ({ handle, field, sink, locator, target, submit }) =>
      invoke(() => {
        if (sink === 'browser.fill') {
          if (!locator.tabId || !locator.selector || !target) throw new Error('Incomplete browser route.');
          requireAllowedTab(deps, locator.tabId);
          return deps.router.use({
            handle,
            field,
            sink,
            locator: { tabId: locator.tabId, selector: locator.selector },
            surface: 'browser',
            purpose: 'browser-fill',
            target: target.toLowerCase(),
            ...withCaller(deps),
          });
        }
        if (sink === 'terminal.input') {
          if (!locator.terminalId) throw new Error('Incomplete terminal route.');
          return deps.router.use({
            handle,
            field,
            sink,
            locator: { terminalId: locator.terminalId, submit: submit === false ? 'false' : 'true' },
            surface: 'terminal',
            purpose: 'terminal-input',
            target: locator.terminalId,
            ...withCaller(deps),
          });
        }
        if (sink === 'process.env.inject') {
          if (!locator.processId || !locator.variable) throw new Error('Incomplete managed process route.');
          return deps.router.use({
            handle,
            field,
            sink,
            locator: { processId: locator.processId, variable: locator.variable },
            surface: 'secret-firewall',
            purpose: 'opaque-use',
            target: locator.processId,
            ...withCaller(deps),
          });
        }
        if (!locator.provider || !locator.projectId || !locator.environment || !locator.name) {
          throw new Error('Incomplete deployment route.');
        }
        return deps.router.use({
          handle,
          field,
          sink,
          locator: {
            provider: locator.provider,
            projectId: locator.projectId,
            environment: locator.environment,
            name: locator.name,
          },
          surface: 'secret-firewall',
          purpose: 'opaque-use',
          target: `${locator.provider}/${locator.projectId}/${locator.environment}`,
          ...withCaller(deps),
        });
      }, 'Secret context use failed.')
  );

  server.tool(
    SECRET_CONTEXT_CAPTURE_TOOL,
    'Capture one secret from an exact browser field into the encrypted Core vault. Plaintext stays in the trusted Main process. Returns only an opaque handle and receipt metadata.',
    {
      label: secretLabel,
      field: secretField,
      kind: secretKind,
      locator: browserLocator,
      target: hostname,
      scope: z
        .enum(['session', 'app', 'package'])
        .default('session')
        .describe(
          'session keeps it in RAM for this conversation only; app stores it permanently; package stores it permanently for the active Package App only.'
        ),
    },
    async ({ label, field, kind, locator, target, scope }) =>
      invoke(() => {
        requireAllowedTab(deps, locator.tabId);
        return deps.router.capture({
          label,
          field,
          kind,
          tabId: locator.tabId,
          selector: locator.selector,
          target: target.toLowerCase(),
          ...(scopeFor(deps, scope) ? { scope: scopeFor(deps, scope) } : {}),
        });
      }, 'Secret context capture failed.')
  );

  server.tool(
    SECRET_CONTEXT_GENERATE_TOOL,
    'Generate a fixed-format secret with the trusted Main-process CSPRNG and store it in the encrypted Core vault. Returns only an opaque handle and receipt metadata.',
    {
      label: secretLabel,
      field: secretField,
      generator: z.enum(['fernet-key', 'api-key']),
      scope: z
        .enum(['session', 'app', 'package'])
        .default('session')
        .describe(
          'session keeps it in RAM for this conversation only; app stores it permanently; package stores it permanently for the active Package App only.'
        ),
    },
    async ({ label, field, generator, scope }) =>
      invoke(
        () =>
          deps.router.generate({
            label,
            field,
            generator,
            ...(scopeFor(deps, scope) ? { scope: scopeFor(deps, scope) } : {}),
          }),
        'Secret context generation failed.'
      )
  );

  server.tool(
    SECRET_CONTEXT_LIST_TOOL,
    'List the secret sets this run may use: handle, label, note, variable names, scope and where each can be typed. Never returns a value. Use the handle with tomny_secret_use.',
    {},
    async () => invoke(async () => ({ sets: await deps.router.listVisible(callerOf(deps)) }), 'Secret listing failed.')
  );

  server.tool(
    SECRET_CONTEXT_REQUEST_TOOL,
    'Ask the person for a secret that does not exist yet. It appears in their Secret keys panel to fill in; you never receive the value. Say what it is for and where it will be typed.',
    {
      label: secretLabel,
      note: z.string().trim().min(1).max(500),
      fields: z.array(secretField).min(1).max(20),
      destinations: z
        .array(z.enum(['browser', 'terminal', 'process', 'deploy']))
        .min(1)
        .max(4),
      hosts: z.array(hostname).max(20).optional(),
    },
    async ({ label, note, fields, destinations, hosts }) =>
      invoke(async () => {
        const sessionId = deps.authority?.sessionId;
        if (!sessionId) throw new Error('No session identity is available for a secret request.');
        return deps.router.request(sessionId, {
          label,
          note,
          fields: [...new Set(fields)],
          destinations: [...new Set(destinations)],
          ...(hosts && hosts.length > 0 ? { hosts: hosts.map((host) => host.toLowerCase()) } : {}),
        });
      }, 'Secret request failed.')
  );

  server.tool(
    SECRET_CONTEXT_ACCESS_TOOL,
    "Ask the person to let the active Package App use one of their general app secrets. Nothing is granted by asking: the person approves or denies in the package's Secret keys, and you never receive the value. The package's own secret space needs no approval.",
    {
      handle: z
        .string()
        .trim()
        .min(10)
        .max(300)
        .regex(/^secret:\/\/[A-Za-z0-9/_.-]+$/u),
      reason: z.string().trim().min(1).max(300).describe('Why the package needs this secret, shown to the person.'),
    },
    async ({ handle, reason }) =>
      invoke(async () => {
        const packageId = deps.authority?.packageId;
        if (!packageId) throw new Error('This run does not use a Package App.');
        return deps.router.requestPackageAccess(packageId, { handle, reason });
      }, 'Secret access request failed.')
  );

  return server;
};
