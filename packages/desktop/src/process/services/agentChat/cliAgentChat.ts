/**
 * Transport-neutral CLI routing for background surfaces.
 *
 * `cli:<targetId>` is executed directly through Tomny Core adapters. The legacy
 * the legacy core REST conversation and backend WebSocket are deliberately not used.
 */

import type { AgentChat, ChatMessageInput } from './types';
import { parseCliModelId } from './cliModelId';
import {
  createDirectCliAgentDriver,
  type DirectCliAgentDriver,
  type DirectCliExecutionContext,
} from './directCliAgent';
import type { CliAgentDriver } from './cliAgentDriver';
import { normalizeChatMessagesForMarkdown } from './markdownMessageNormalizer';

type CachedContextualDriver = {
  driver: DirectCliAgentDriver;
  activeRuns: number;
  lastUsedAt: number;
  idleTimer?: ReturnType<typeof setTimeout>;
};

const MAX_CONTEXTUAL_DRIVERS = 8;
const CONTEXTUAL_DRIVER_IDLE_MS = 5 * 60_000;
let sharedDriver: DirectCliAgentDriver | null = null;
const contextualDrivers = new Map<string, CachedContextualDriver>();

const contextKey = (context: DirectCliExecutionContext): string =>
  JSON.stringify([
    context.workspace ?? '',
    context.surface ?? '',
    context.permissionMode ?? 'read-only',
    context.sessionId ?? '',
    [...(context.excludedMcpServerNames ?? [])].map((name) => name.toLowerCase()).toSorted(),
  ]);

const disposeContextualDriver = (key: string, entry: CachedContextualDriver): void => {
  if (contextualDrivers.get(key) !== entry) return;
  contextualDrivers.delete(key);
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  void entry.driver.dispose();
};

const scheduleContextualDriverIdle = (key: string, entry: CachedContextualDriver): void => {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    if (entry.activeRuns > 0) {
      entry.lastUsedAt = Date.now();
      scheduleContextualDriverIdle(key, entry);
      return;
    }
    disposeContextualDriver(key, entry);
  }, CONTEXTUAL_DRIVER_IDLE_MS);
  entry.idleTimer.unref?.();
};

const acquireContextualDriver = (
  context: DirectCliExecutionContext
): { driver: DirectCliAgentDriver; release: () => void } => {
  const key = contextKey(context);
  let entry = contextualDrivers.get(key);
  if (!entry) {
    if (contextualDrivers.size >= MAX_CONTEXTUAL_DRIVERS) {
      const candidate = [...contextualDrivers.entries()]
        .filter(([, cached]) => cached.activeRuns === 0)
        .toSorted((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0];
      if (!candidate) throw new Error(`Direct Tomny Core session limit reached (${MAX_CONTEXTUAL_DRIVERS}).`);
      disposeContextualDriver(candidate[0], candidate[1]);
    }
    entry = { driver: createDirectCliAgentDriver({}, context), activeRuns: 0, lastUsedAt: Date.now() };
    contextualDrivers.set(key, entry);
  }
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.activeRuns += 1;
  entry.lastUsedAt = Date.now();
  const activeEntry = entry;
  return {
    driver: activeEntry.driver,
    release: () => {
      activeEntry.activeRuns = Math.max(0, activeEntry.activeRuns - 1);
      activeEntry.lastUsedAt = Date.now();
      scheduleContextualDriverIdle(key, activeEntry);
    },
  };
};

/**
 * Route CLI model ids to direct Tomny Core adapters while provider ids keep
 * using the caller's existing provider implementation.
 */
export const withCliAgent = (
  inner: AgentChat,
  driver?: CliAgentDriver,
  context?: DirectCliExecutionContext
): AgentChat => {
  return async ({ model, messages, signal }) => {
    const normalizedMessages = await normalizeChatMessagesForMarkdown(messages as ChatMessageInput[]);
    const cli = parseCliModelId(model);
    if (!cli) return inner({ model, messages: normalizedMessages, signal });
    const params = {
      agentId: cli.agentId,
      modelId: cli.modelId,
      messages: normalizedMessages,
      signal,
    };
    if (driver) return driver.run(params);
    if (!context) {
      sharedDriver ??= createDirectCliAgentDriver();
      return sharedDriver.run(params);
    }
    const acquired = acquireContextualDriver(context);
    try {
      return await acquired.driver.run(params);
    } finally {
      acquired.release();
    }
  };
};

/** Dispose direct adapter processes and clear detection/session caches. */
export const __resetSharedCliDriver = (): void => {
  const active = [sharedDriver, ...[...contextualDrivers.values()].map((entry) => entry.driver)].filter(
    (driver): driver is DirectCliAgentDriver => driver !== null
  );
  sharedDriver = null;
  for (const entry of contextualDrivers.values()) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
  }
  contextualDrivers.clear();
  for (const driver of active) void driver.dispose();
};
