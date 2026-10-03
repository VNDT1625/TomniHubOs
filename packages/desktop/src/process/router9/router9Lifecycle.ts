/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const JOURNAL_FILE = 'cli-config-recovery.json';
const JOURNAL_SCHEMA_VERSION = 1;

type Router9JournalEntry = {
  configPath: string;
  originalContent: string | null;
  appliedContent: string | null;
  pendingContent: string | null;
};

type Router9Journal = {
  schemaVersion: typeof JOURNAL_SCHEMA_VERSION;
  entries: Router9JournalEntry[];
};

export type Router9ConfigWriteHooks = {
  beforeWrite: (configPath: string, originalContent: string | undefined, appliedContent: string) => Promise<void>;
  afterWrite: (configPath: string, appliedContent: string) => Promise<void>;
};

type Router9ConfigSessionDeps = {
  journalPath: () => string;
  isManagedPath: (configPath: string) => boolean;
  readFile: (filePath: string) => Promise<string | undefined>;
  writeFileAtomic: (filePath: string, content: string) => Promise<void>;
  removeFile: (filePath: string) => Promise<void>;
  logWarn: (message: string) => void;
};

const readFile = async (filePath: string): Promise<string | undefined> => {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
};

const writeFileAtomic = async (filePath: string, content: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch((): undefined => undefined);
  }
};

const removeFile = async (filePath: string): Promise<void> => {
  await fs.rm(filePath, { force: true });
};

const canonicalPath = (filePath: string): string => {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const managedConfigPaths = new Set(
  [
    path.join(os.homedir(), '.claude', 'settings.json'),
    path.join(os.homedir(), '.codex', 'config.toml'),
    path.join(os.homedir(), '.openclaw', 'openclaw.json'),
  ].map(canonicalPath)
);

const defaultConfigSessionDeps: Router9ConfigSessionDeps = {
  journalPath: () => path.join(app.getPath('userData'), 'tomni-model-gateway', JOURNAL_FILE),
  isManagedPath: (configPath) => managedConfigPaths.has(canonicalPath(configPath)),
  readFile,
  writeFileAtomic,
  removeFile,
  logWarn: (message) => console.warn(message),
};

const nullableString = (value: unknown): value is string | null => typeof value === 'string' || value === null;

/** Serializes config writes and restores using an atomic, CAS-protected recovery journal. */
export class Router9ConfigSession {
  readonly #deps: Router9ConfigSessionDeps;
  readonly #entries = new Map<string, Router9JournalEntry>();
  #tail: Promise<void> = Promise.resolve();
  #journalLoaded = false;
  #recovered = false;
  #closing = false;

  constructor(deps: Partial<Router9ConfigSessionDeps> = {}) {
    this.#deps = { ...defaultConfigSessionDeps, ...deps };
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation);
    this.#tail = result.then(
      (): undefined => undefined,
      (): undefined => undefined
    );
    return result;
  }

  async #loadJournal(): Promise<void> {
    if (this.#journalLoaded) return;
    const raw = await this.#deps.readFile(this.#deps.journalPath());
    this.#journalLoaded = true;
    if (raw === undefined) return;
    try {
      const value = JSON.parse(raw) as Partial<Router9Journal>;
      if (value.schemaVersion !== JOURNAL_SCHEMA_VERSION || !Array.isArray(value.entries)) {
        throw new Error('unsupported schema');
      }
      const seen = new Set<string>();
      for (const candidate of value.entries) {
        if (
          !candidate ||
          typeof candidate.configPath !== 'string' ||
          !nullableString(candidate.originalContent) ||
          !nullableString(candidate.appliedContent) ||
          !nullableString(candidate.pendingContent) ||
          (candidate.appliedContent === null && candidate.pendingContent === null) ||
          !this.#deps.isManagedPath(candidate.configPath) ||
          seen.has(candidate.configPath)
        ) {
          this.#deps.logWarn('[ModelGateway] Ignoring an unsafe Router9 recovery journal entry.');
          continue;
        }
        seen.add(candidate.configPath);
        this.#entries.set(candidate.configPath, { ...candidate });
      }
    } catch (error) {
      this.#deps.logWarn(
        `[ModelGateway] Ignoring invalid Router9 recovery journal: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async #persistJournal(): Promise<void> {
    const journalPath = this.#deps.journalPath();
    if (this.#entries.size === 0) {
      await this.#deps.removeFile(journalPath);
      return;
    }
    const value: Router9Journal = {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      entries: [...this.#entries.values()],
    };
    await this.#deps.writeFileAtomic(journalPath, `${JSON.stringify(value, null, 2)}\n`);
  }

  async #restoreEntries(): Promise<void> {
    const failures: unknown[] = [];
    for (const [configPath, entry] of this.#entries) {
      try {
        // eslint-disable-next-line no-await-in-loop -- CAS checks and restores must stay ordered with journal updates.
        const currentContent = await this.#deps.readFile(configPath);
        const current = currentContent ?? null;
        const managedContents = [entry.appliedContent, entry.pendingContent].filter(
          (content): content is string => content !== null
        );
        if (currentContent !== undefined && managedContents.includes(currentContent)) {
          // eslint-disable-next-line no-await-in-loop -- each restore must finish before its journal entry is cleared.
          if (entry.originalContent === null) await this.#deps.removeFile(configPath);
          // eslint-disable-next-line no-await-in-loop -- each restore must finish before its journal entry is cleared.
          else await this.#deps.writeFileAtomic(configPath, entry.originalContent);
          this.#entries.delete(configPath);
        } else if (current === entry.originalContent) {
          this.#entries.delete(configPath);
        } else {
          this.#deps.logWarn(
            `[ModelGateway] ${configPath} changed outside Tomny after 9Router apply; preserving user content.`
          );
          this.#entries.delete(configPath);
        }
      } catch (error) {
        failures.push(error);
      }
    }
    await this.#persistJournal();
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Failed to restore one or more 9Router CLI configurations.');
    }
  }

  async #recoverUnderLock(): Promise<void> {
    if (this.#recovered) return;
    await this.#loadJournal();
    await this.#restoreEntries();
    this.#recovered = true;
  }

  async #beforeWrite(configPath: string, originalContent: string | undefined, appliedContent: string): Promise<void> {
    if (!this.#deps.isManagedPath(configPath)) {
      throw new Error(`Refusing to manage an unsupported Router9 config path: ${configPath}`);
    }
    const current = originalContent ?? null;
    const existing = this.#entries.get(configPath);
    if (existing) {
      const safeContents = [existing.originalContent, existing.appliedContent, existing.pendingContent];
      if (!safeContents.includes(current)) {
        throw new Error(`${configPath} changed outside Tomny; refusing to overwrite user content.`);
      }
      if (existing.pendingContent !== null && current === existing.pendingContent) {
        existing.appliedContent = existing.pendingContent;
      }
      existing.pendingContent = appliedContent;
    } else {
      this.#entries.set(configPath, {
        configPath,
        originalContent: current,
        appliedContent: null,
        pendingContent: appliedContent,
      });
    }
    await this.#persistJournal();
  }

  async #afterWrite(configPath: string, appliedContent: string): Promise<void> {
    const entry = this.#entries.get(configPath);
    if (!entry || entry.pendingContent !== appliedContent) {
      throw new Error(`Router9 config write journal is inconsistent for ${configPath}.`);
    }
    entry.appliedContent = appliedContent;
    entry.pendingContent = null;
    await this.#persistJournal();
  }

  recover(): Promise<void> {
    return this.#enqueue(() => this.#recoverUnderLock());
  }

  apply<T>(operation: (hooks: Router9ConfigWriteHooks) => Promise<T>): Promise<T> {
    if (this.#closing) return Promise.reject(new Error('Router9 configuration is shutting down; apply was cancelled.'));
    return this.#enqueue(async () => {
      if (this.#closing) throw new Error('Router9 configuration is shutting down; apply was cancelled.');
      await this.#recoverUnderLock();
      if (this.#closing) throw new Error('Router9 configuration is shutting down; apply was cancelled.');
      return operation({
        beforeWrite: (configPath, originalContent, appliedContent) =>
          this.#beforeWrite(configPath, originalContent, appliedContent),
        afterWrite: (configPath, appliedContent) => this.#afterWrite(configPath, appliedContent),
      });
    });
  }

  beginShutdown(): void {
    this.#closing = true;
  }

  restore(): Promise<void> {
    this.beginShutdown();
    return this.#enqueue(async () => {
      await this.#recoverUnderLock();
      await this.#restoreEntries();
    });
  }
}

export const router9ConfigSession = new Router9ConfigSession();

type Router9ShutdownDeps = {
  beginConfigShutdown: () => void;
  stopManagedGateway: () => Promise<void>;
  restoreConfigs: () => Promise<void>;
};

const defaultShutdownDeps: Router9ShutdownDeps = {
  beginConfigShutdown: () => router9ConfigSession.beginShutdown(),
  stopManagedGateway: async () => undefined,

  restoreConfigs: () => router9ConfigSession.restore(),
};

const runShutdown = async (deps: Router9ShutdownDeps): Promise<void> => {
  deps.beginConfigShutdown();
  const failures: unknown[] = [];
  try {
    await deps.stopManagedGateway();
  } catch (error) {
    failures.push(error);
  }
  try {
    await deps.restoreConfigs();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, '9Router shutdown cleanup failed.');
  }
};

let defaultShutdownPromise: Promise<void> | undefined;

/** Stops Tomny's owned gateway once and restores only CAS-proven CLI config writes. */
export const shutdownRouter9Integration = (deps: Partial<Router9ShutdownDeps> = {}): Promise<void> => {
  if (Object.keys(deps).length > 0) return runShutdown({ ...defaultShutdownDeps, ...deps });
  defaultShutdownPromise ??= runShutdown(defaultShutdownDeps);
  return defaultShutdownPromise;
};
