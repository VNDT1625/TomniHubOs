/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Small Main-owned files the process runtime needs (docs/platform/repotopackage-design.md section 13):
 *
 * - the setup markers: "the `setup` commands of this service already ran for this approval". A marker is scoped by
 *   package, connection and version, because a setup (installing dependencies) belongs to one extracted folder; the
 *   markers of a connection are cleared when it is turned off, so a package that is installed again always runs
 *   setup again.
 * - the evidence log: one JSON line per lifecycle step of a persistent contribution. No command line, path,
 *   environment value or secret is written; only identities, the approval hash and a reason code.
 *
 * Both fail closed: a file that cannot be read is treated as empty (setup runs again), and a log that cannot be
 * written makes the supervisor refuse to start the process.
 */

import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PackagePersistentContributionEvidence } from '@process/resources/packageProcessRuntime/persistentContributionSupervisor';
import type { RepoProcessPorts } from './repoProcessPorts';

const MAX_MARKERS = 2_000;
const MAX_KEY_LENGTH = 400;
const EVIDENCE_ROTATE_BYTES = 1024 * 1024;

export type SetupMarkerStore = Readonly<{
  has: (key: string) => Promise<boolean>;
  mark: (key: string) => Promise<void>;
  /** Forgets every marker whose key starts with `prefix`. */
  clear: (prefix: string) => Promise<void>;
  /** The port the endpoint uses: every key is prefixed with `scope`, so a package can only see its own markers. */
  scoped: (scope: string) => RepoProcessPorts['setupMarkers'];
}>;

export const createJsonSetupMarkerStore = (filePath: string): SetupMarkerStore => {
  let loaded: Promise<string[]> | undefined;
  let writes: Promise<void> = Promise.resolve();

  const load = (): Promise<string[]> => {
    loaded ??= readFile(filePath, 'utf8').then(
      (text) => {
        try {
          const raw: unknown = JSON.parse(text);
          const marks = (raw as { marks?: unknown } | null)?.marks;
          return Array.isArray(marks)
            ? marks.filter((item): item is string => typeof item === 'string' && item.length <= MAX_KEY_LENGTH)
            : [];
        } catch {
          return [];
        }
      },
      (): string[] => []
    );
    return loaded;
  };

  const persist = (marks: readonly string[]): Promise<void> => {
    const task = writes.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporary = `${filePath}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, marks }), 'utf8');
      await rename(temporary, filePath);
    });
    // A failed write must not poison the next one; the caller still sees this failure.
    writes = task.catch((): undefined => undefined);
    return task;
  };

  const has = async (key: string): Promise<boolean> => (await load()).includes(key);

  const mark = async (key: string): Promise<void> => {
    if (key.length > MAX_KEY_LENGTH) throw new Error('Setup marker key is too long.');
    const marks = await load();
    if (marks.includes(key)) return;
    marks.push(key);
    // Bounded: the oldest markers go first; a missing marker only costs one more run of an idempotent setup.
    if (marks.length > MAX_MARKERS) marks.splice(0, marks.length - MAX_MARKERS);
    await persist(marks);
  };

  const clear = async (prefix: string): Promise<void> => {
    const marks = await load();
    const kept = marks.filter((key) => !key.startsWith(prefix));
    if (kept.length === marks.length) return;
    marks.splice(0, marks.length, ...kept);
    await persist(marks);
  };

  return {
    has,
    mark,
    clear,
    scoped: (scope) => ({
      has: (key) => has(`${scope}${key}`),
      mark: (key) => mark(`${scope}${key}`),
    }),
  };
};

/** Appends one line per lifecycle step; the file is rotated once (`.1`) when it passes 1 MiB. */
export const createEvidenceFileSink =
  (filePath: string, now: () => number = Date.now) =>
  async (evidence: PackagePersistentContributionEvidence): Promise<void> => {
    await mkdir(path.dirname(filePath), { recursive: true });
    try {
      if ((await stat(filePath)).size > EVIDENCE_ROTATE_BYTES) await rename(filePath, `${filePath}.1`);
    } catch {
      // No file yet.
    }
    const { surface, contributionId, artifactIntegrity } = evidence.binding;
    const line = JSON.stringify({
      at: now(),
      kind: evidence.kind,
      phase: evidence.phase,
      packageId: surface.packageId,
      packageVersion: surface.packageVersion,
      contributionId,
      approvalHash: artifactIntegrity,
      ...(evidence.reason === undefined ? {} : { reason: evidence.reason }),
    });
    await appendFile(filePath, `${line}\n`, 'utf8');
  };
