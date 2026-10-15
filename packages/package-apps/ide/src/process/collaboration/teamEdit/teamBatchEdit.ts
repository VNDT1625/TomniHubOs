/**
 * Batch edits for agents that share a workspace: several exact replacements across several files, a unified diff,
 * and undo of a whole batch. Each one holds the team lease of every file it touches, then runs one MTUI command, so
 * the work is backed up, undoable as a unit, and never overwrites another agent's file.
 */
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

import { runMtuiInRoot } from '@process/resources/nativeFile/mtuiBridge';

export type BatchOutcome = Readonly<{ ok: boolean; message: string }>;

type Lease = { relPath: string; agentId: string; intent?: string };
type TeamLeases = {
  claim: (
    rootPath: string,
    agentId: string,
    relPath: string,
    intent?: string
  ) => { ok: true; lease: Lease; renewed: boolean } | { ok: false; reason: 'held'; lease: Lease };
  release: (rootPath: string, agentId: string, relPath: string) => boolean;
};

/** Runs one MTUI command in a workspace and returns its parsed JSON. */
export type BatchMtuiRunner = (args: string[], rootPath: string) => Promise<Record<string, unknown>>;

export type BatchFileEdit = Readonly<{
  relPath: string;
  edits: ReadonlyArray<Readonly<{ oldText: string; newText: string; all?: boolean }>>;
}>;

const MAX_FILES = 40;
const MAX_EDITS_PER_FILE = 100;
const MAX_UNDO_GROUP_PROBE = 50;

const fail = (message: string): BatchOutcome => ({ ok: false, message });

const heldMessage = (lease: Lease, verb: string): string =>
  `CONFLICT: ${lease.relPath} is held by ${lease.agentId}${lease.intent ? ` (${lease.intent})` : ''}. ` +
  `The ${verb} was refused and nothing was changed, so that agent's work is not overwritten. Coordinate, or change different files.`;

/** A workspace-relative path with forward slashes, or undefined when it could leave the workspace. */
const safeRelative = (value: string): string | undefined => {
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//u, '');
  if (!normalized || isAbsolute(normalized) || /^[A-Za-z]:/u.test(normalized)) return undefined;
  return normalized.split('/').some((part) => part === '..' || part === '') ? undefined : normalized;
};

const stringField = (record: Record<string, unknown>, key: string): string =>
  typeof record[key] === 'string' ? record[key] : '';

/** MTUI's refusal, written for the model: what happened and what to do next. */
const explainFailure = (result: Record<string, unknown>, verb: string): string => {
  const detail = stringField(result, 'message') || 'MTUI refused the change.';
  switch (stringField(result, 'error_type')) {
    case 'NO_MATCH':
      return `STALE: ${detail}\nNothing was written. Re-read the files, rebase the edits on the current text, then try again.`;
    case 'MULTIPLE_MATCHES':
      return `AMBIGUOUS: ${detail}\nNothing was written. Use a longer unique oldText, or set all=true to replace every match.`;
    case 'CONFLICT':
    case 'CONFLICT_DETAILED':
      return `CONFLICT: ${detail}\nNothing was written. The files changed since you read them; re-read and rebase.`;
    default:
      return `${verb} failed: ${detail}`;
  }
};

/** MTUI prints Windows extended paths; the model should see plain workspace-relative ones. */
const toWorkspaceRelative = (root: string, file: string): string | undefined => {
  const plain = file.startsWith('\\\\?\\') ? file.slice(4) : file;
  const rel = relative(root, plain).replaceAll('\\', '/');
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : undefined;
};

export const createTeamBatchEditor = (deps: { team: TeamLeases; runMtui?: BatchMtuiRunner }) => {
  const run: BatchMtuiRunner = deps.runMtui ?? ((args, root) => runMtuiInRoot(args, root) as Promise<Record<string, unknown>>);

  /** Holds the lease of every path while `work` runs; leases this call took are released afterwards. */
  const withLeases = async (
    root: string,
    agentId: string,
    relPaths: readonly string[],
    verb: string,
    work: () => Promise<BatchOutcome>
  ): Promise<BatchOutcome> => {
    const taken: string[] = [];
    try {
      for (const relPath of relPaths) {
        const claim = deps.team.claim(root, agentId, relPath, verb);
        if (claim.ok === false) return fail(heldMessage(claim.lease, verb));
        if (!claim.renewed) taken.push(relPath);
      }
      return await work();
    } finally {
      for (const relPath of taken) deps.team.release(root, agentId, relPath);
    }
  };

  const withTempFile = async <T>(extension: string, content: string, use: (path: string) => Promise<T>): Promise<T> => {
    const path = join(tmpdir(), `tomny-batch-${randomUUID()}.${extension}`);
    await writeFile(path, content, { encoding: 'utf8', mode: 0o600 });
    try {
      return await use(path);
    } finally {
      await rm(path, { force: true });
    }
  };

  return {
    /** Exact replacements across several files as one MTUI batch with one group undo. */
    async editMany(root: string, agentId: string, files: readonly BatchFileEdit[]): Promise<BatchOutcome> {
      if (files.length === 0 || files.length > MAX_FILES) return fail(`Give between 1 and ${MAX_FILES} files.`);
      const cleaned: Array<{ relPath: string; edits: BatchFileEdit['edits'] }> = [];
      for (const file of files) {
        const relPath = safeRelative(file.relPath);
        if (!relPath) return fail(`${file.relPath} is not a path inside the workspace.`);
        if (file.edits.length === 0 || file.edits.length > MAX_EDITS_PER_FILE) {
          return fail(`${relPath}: give between 1 and ${MAX_EDITS_PER_FILE} edits.`);
        }
        cleaned.push({ relPath, edits: file.edits });
      }
      return withLeases(root, agentId, [...new Set(cleaned.map((file) => file.relPath))], 'edit', async () => {
        const spec = cleaned.map(({ relPath, edits }) => ({
          file: relPath,
          edits: edits.map((edit) => ({ old: edit.oldText, new: edit.newText, all: edit.all === true })),
        }));
        const result = await withTempFile('json', JSON.stringify(spec), (specPath) =>
          run(['--json', 'edit-many', '--spec', specPath], root)
        );
        if (result['ok'] !== true) return fail(explainFailure(result, 'Edit'));
        const written = Array.isArray(result['files']) ? (result['files'] as Array<Record<string, unknown>>) : [];
        const replaced = written.reduce((sum, file) => sum + (typeof file['matches'] === 'number' ? file['matches'] : 0), 0);
        return {
          ok: true,
          message: `Edited ${written.length} files (${replaced} replacements) via MTUI. Undo all of it with tomny_team_undo groupId=${stringField(result, 'group_id')}.`,
        };
      });
    },

    /** A unified diff applied through MTUI, holding the lease of every file it names. */
    async applyPatch(root: string, agentId: string, patch: string): Promise<BatchOutcome> {
      const named = new Set<string>();
      for (const line of patch.split(/\r?\n/u)) {
        const match = /^(?:\+\+\+|---) (?:[ab]\/)?(\S.*?)(?:\t.*)?$/u.exec(line);
        if (match && match[1] !== '/dev/null') named.add(match[1]!);
      }
      if (named.size === 0) return fail('The patch names no files; pass a unified diff with ---/+++ lines.');
      if (named.size > MAX_FILES) return fail(`The patch touches more than ${MAX_FILES} files.`);
      const relPaths: string[] = [];
      for (const name of named) {
        const relPath = safeRelative(name);
        if (!relPath) return fail(`${name} is not a path inside the workspace.`);
        relPaths.push(relPath);
      }
      return withLeases(root, agentId, relPaths, 'patch', async () => {
        const result = await withTempFile('diff', patch.endsWith('\n') ? patch : `${patch}\n`, (patchPath) =>
          run(['--json', 'apply-patch', '--file', patchPath], root)
        );
        if (result['ok'] !== true) return fail(explainFailure(result, 'Patch'));
        const files = Array.isArray(result['files']) ? (result['files'] as Array<Record<string, unknown>>) : [];
        const ids = files.map((file) => stringField(file, 'operation_id')).filter(Boolean);
        return {
          ok: true,
          message: `Patched ${files.length} files via MTUI.${ids.length > 0 ? ` Undo with tomny_team_undo operationId=${ids[0]}${ids.length > 1 ? ' (one per file)' : ''}.` : ''}`,
        };
      });
    },

    /** Undoes one operation, or every operation of an edit batch, after taking the lease of the files it restores. */
    async undo(
      root: string,
      agentId: string,
      target: Readonly<{ operationId?: string; groupId?: string }>
    ): Promise<BatchOutcome> {
      const { operationId, groupId } = target;
      if (Boolean(operationId) === Boolean(groupId)) return fail('Give exactly one of operationId or groupId.');
      const ids: string[] = [];
      if (operationId) {
        ids.push(operationId);
      } else {
        for (let index = 0; index < MAX_UNDO_GROUP_PROBE; index += 1) {
          const probe = await run(['--json', 'diff', '--operation', `${groupId}.${index}`], root);
          if (probe['ok'] !== true) break;
          ids.push(`${groupId}.${index}`);
        }
        if (ids.length === 0) return fail(`No operations were found for group ${groupId}.`);
      }
      const relPaths = new Set<string>();
      for (const id of ids) {
        const shown = await run(['--json', 'diff', '--operation', id], root);
        if (shown['ok'] !== true) return fail(explainFailure(shown, 'Undo'));
        for (const file of Array.isArray(shown['files']) ? (shown['files'] as Array<Record<string, unknown>>) : []) {
          const rel = toWorkspaceRelative(root, stringField(file, 'file'));
          if (!rel) return fail('That operation touched a file outside this workspace, so it was not undone.');
          relPaths.add(rel);
        }
      }
      return withLeases(root, agentId, [...relPaths], 'undo', async () => {
        const result = await run(
          groupId ? ['--json', 'undo', '--group', groupId] : ['--json', 'undo', '--operation', operationId!],
          root
        );
        if (result['ok'] !== true) return fail(explainFailure(result, 'Undo'));
        return { ok: true, message: `Restored ${relPaths.size} file${relPaths.size === 1 ? '' : 's'} via MTUI: ${[...relPaths].join(', ')}.` };
      });
    },
  };
};
