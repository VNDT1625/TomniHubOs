/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type SelectionOutcome = 'verified' | 'failed' | 'cancelled' | 'timed_out';

export type SelectionRecordDetails = {
  outcome: SelectionOutcome;
  candidateId?: string;
  modelVersion?: string;
  packageVersion?: string;
  conditions?: Record<string, string | number | boolean>;
  latencyMs?: number;
  cost?: number;
  resourceUsage?: Record<string, number>;
  fallbackCount?: number;
};

export type SelectionLogEntry = {
  requestHash: string;
  requestSnippet: string;
  chosen: string[];
  succeeded: boolean;
  outcome?: SelectionOutcome;
  candidateId?: string;
  modelVersion?: string;
  packageVersion?: string;
  conditionHash?: string;
  latencyMs?: number;
  cost?: number;
  resourceUsage?: Record<string, number>;
  fallbackCount?: number;
  at: number;
};

export type SelectionSummary = {
  total: number;
  verified: number;
  failed: number;
  cancelled: number;
  timedOut: number;
  successRate: number;
  averageCost?: number;
  p95LatencyMs?: number;
  fallbackCount: number;
  decayedSuccessWeight: number;
};

export type SelectionLogFs = {
  readFile(filePath: string, encoding: 'utf-8'): Promise<string>;
  writeFile(filePath: string, data: string, options: { encoding: 'utf-8'; mode?: number }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  mkdir(dirPath: string, options: { recursive: true }): Promise<string | undefined>;
};

const defaultFs: SelectionLogFs = {
  readFile: (p, enc) => fs.promises.readFile(p, enc),
  writeFile: (p, data, opts) => fs.promises.writeFile(p, data, opts),
  rename: (a, b) => fs.promises.rename(a, b),
  mkdir: (p, opts) => fs.promises.mkdir(p, opts),
};

export type SelectionLogOptions = {
  filePath: string;
  fs?: SelectionLogFs;
  maxEntries?: number;
  now?: () => number;
  decayHalfLifeMs?: number;
};

export type ISelectionLog = {
  hashRequest(request: string): string;
  record(request: string, chosen: string[], succeeded: boolean): Promise<SelectionLogEntry>;
  record(request: string, chosen: string[], details: SelectionRecordDetails): Promise<SelectionLogEntry>;
  recall(request: string): Promise<SelectionLogEntry | undefined>;
  all(): Promise<SelectionLogEntry[]>;
  clear?(): Promise<void>;
  reset?(): Promise<void>;
  summary?(conditions?: Record<string, string | number | boolean>): Promise<SelectionSummary>;
};

const normaliseRequest = (request: string): string => request.trim().replace(/\s+/g, ' ').toLowerCase();
const stableObject = (value: Record<string, string | number | boolean>): string =>
  JSON.stringify(Object.entries(value).toSorted(([a], [b]) => a.localeCompare(b)));
const percentile95 = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  return values.toSorted((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
};

export const createSelectionLog = (options: SelectionLogOptions): ISelectionLog => {
  const fsImpl = options.fs ?? defaultFs;
  const maxEntries = Math.max(0, options.maxEntries ?? 500);
  const now = options.now ?? (() => Date.now());
  const halfLife = Math.max(1, options.decayHalfLifeMs ?? 30 * 24 * 60 * 60 * 1000);
  let pending: Promise<void> = Promise.resolve();

  const hash = (value: string): string => crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
  const hashRequest = (request: string): string => hash(normaliseRequest(request));

  const read = async (): Promise<SelectionLogEntry[]> => {
    try {
      const parsed: unknown = JSON.parse(await fsImpl.readFile(options.filePath, 'utf-8'));
      return Array.isArray(parsed) ? (parsed as SelectionLogEntry[]) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') {
        console.warn('[ToolSelect] Failed to read selection-log; starting empty:', error);
      }
      return [];
    }
  };

  const write = async (entries: SelectionLogEntry[]): Promise<void> => {
    const tmp = `${options.filePath}.tmp`;
    await fsImpl.mkdir(path.dirname(options.filePath), { recursive: true });
    await fsImpl.writeFile(tmp, `${JSON.stringify(entries, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    await fsImpl.rename(tmp, options.filePath);
  };

  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(operation, operation);
    pending = result.then(
      (): void => undefined,
      (): void => undefined
    );
    return result;
  };

  const record: ISelectionLog['record'] = (request, chosen, outcomeOrSucceeded) =>
    serialized(async () => {
      const details: SelectionRecordDetails =
        typeof outcomeOrSucceeded === 'boolean'
          ? { outcome: outcomeOrSucceeded ? 'verified' : 'failed' }
          : outcomeOrSucceeded;
      const { conditions, ...persistedDetails } = details;
      const entry: SelectionLogEntry = {
        requestHash: hashRequest(request),
        requestSnippet: request.trim().slice(0, 120),
        chosen: [...chosen],
        succeeded: details.outcome === 'verified',
        ...persistedDetails,
        conditionHash: conditions ? hash(stableObject(conditions)) : undefined,
        at: now(),
      };
      const existing = await read();
      await write([entry, ...existing].slice(0, maxEntries));
      return entry;
    });

  const all = async (): Promise<SelectionLogEntry[]> => {
    await pending;
    return (await read()).toSorted((a, b) => b.at - a.at);
  };

  const clear = (): Promise<void> => serialized(() => write([]));

  const summary = async (conditions?: Record<string, string | number | boolean>): Promise<SelectionSummary> => {
    const conditionHash = conditions ? hash(stableObject(conditions)) : undefined;
    const entries = (await all()).filter((entry) => !conditionHash || entry.conditionHash === conditionHash);
    const outcomeOf = (entry: SelectionLogEntry): SelectionOutcome =>
      entry.outcome ?? (entry.succeeded ? 'verified' : 'failed');
    const count = (outcome: SelectionOutcome): number => entries.filter((entry) => outcomeOf(entry) === outcome).length;
    const verified = count('verified');
    const costs = entries.flatMap((entry) => (entry.cost === undefined ? [] : [entry.cost]));
    const latencies = entries.flatMap((entry) => (entry.latencyMs === undefined ? [] : [entry.latencyMs]));
    const decayedSuccessWeight = entries.reduce(
      (total, entry) =>
        total + (outcomeOf(entry) === 'verified' ? Math.pow(0.5, Math.max(0, now() - entry.at) / halfLife) : 0),
      0
    );
    return {
      total: entries.length,
      verified,
      failed: count('failed'),
      cancelled: count('cancelled'),
      timedOut: count('timed_out'),
      successRate: entries.length === 0 ? 0 : verified / entries.length,
      averageCost: costs.length === 0 ? undefined : costs.reduce((sum, value) => sum + value, 0) / costs.length,
      p95LatencyMs: percentile95(latencies),
      fallbackCount: entries.reduce((sum, entry) => sum + (entry.fallbackCount ?? 0), 0),
      decayedSuccessWeight,
    };
  };

  return {
    hashRequest,
    record,
    recall: async (request) =>
      (await all()).find(
        (entry) =>
          entry.requestHash === hashRequest(request) &&
          (entry.outcome ?? (entry.succeeded ? 'verified' : 'failed')) === 'verified'
      ),
    all,
    clear,
    reset: clear,
    summary,
  };
};
