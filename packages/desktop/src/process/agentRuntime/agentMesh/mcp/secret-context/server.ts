import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { SecretContextUseRouter } from './router';
import { protectedMcpTextContent } from '../../security';

export const BUILTIN_SECRET_CONTEXT_NAME = 'tomny-secret-context';
export const BUILTIN_SECRET_CONTEXT_ID = 'builtin-secret-context';
export const AGENT_SECRET_CONTEXT_USE_TOOL = 'agent_secret_context_use';
export const SECRET_CONTEXT_CAPTURE_TOOL = 'secret_context_capture';
export const SECRET_CONTEXT_GENERATE_TOOL = 'secret_context_generate';

export type SecretContextServerAuthority = Readonly<{
  scopeId: string;
  surface: string;
  allowedTabIds?: ReadonlySet<string>;
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
      sink: z.enum(['browser.fill', 'process.env.inject', 'deployment.secret.put']),
      locator: useLocator,
      target: hostname.optional(),
    },
    async ({ handle, field, sink, locator, target }) =>
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
    },
    async ({ label, field, kind, locator, target }) =>
      invoke(() => {
        requireAllowedTab(deps, locator.tabId);
        return deps.router.capture({
          label,
          field,
          kind,
          tabId: locator.tabId,
          selector: locator.selector,
          target: target.toLowerCase(),
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
    },
    async ({ label, field, generator }) =>
      invoke(() => deps.router.generate({ label, field, generator }), 'Secret context generation failed.')
  );

  return server;
};
