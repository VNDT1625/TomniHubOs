/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for the Agent Team Edit service — the per-workspace coordinator wrapper
 * that performs MTUI-guarded writes and emits change snapshots. The MTUI writer
 * + clock are injected so no real CLI is spawned.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createPremiumStarterProject, type ViuProjectState } from '@/common/viu';
import {
  createTeamEditService,
  createTeamPreviewFilePersistence,
  getTeamEditService,
  setTeamEditChangeListener,
} from '@/process/ide/teamEdit/teamEditService';
import type { MtuiResponse } from '@/process/terminal/mtuiBridge';

const ROOT = '/repo';

const failTeamServiceOperation = (): never => {
  throw new Error('service blocked');
};

/** A fake MTUI writer that records calls and returns a configurable result. */
const makeWriter = (ok = true) => {
  const calls: Array<{ filePath: string; data: string }> = [];
  const writeFile = vi.fn(async (filePath: string, data: string): Promise<MtuiResponse> => {
    calls.push({ filePath, data });
    return ok ? { ok: true } : { ok: false, message: 'boom' };
  });
  return { writeFile, calls };
};

describe('teamEditService — guarded write', () => {
  it("writes through MTUI and auto-acquires the writer's lease", async () => {
    const { writeFile, calls } = makeWriter();
    const service = createTeamEditService({ writeFile });
    const result = await service.write(ROOT, 'agent-a', 'src/a.ts', 'hello');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.bytes).toBe(5);
    expect(calls).toHaveLength(1);
    expect(calls[0].data).toBe('hello');
    // The write registered a lease for agent-a.
    const snap = service.snapshot(ROOT);
    expect(snap.leases.map((l) => l.agentId)).toEqual(['agent-a']);
  });

  it('refuses a write when another agent holds the file (no MTUI call)', async () => {
    const { writeFile } = makeWriter();
    const service = createTeamEditService({ writeFile });
    service.claim(ROOT, 'agent-a', 'src/a.ts', 'editing');
    const result = await service.write(ROOT, 'agent-b', 'src/a.ts', 'overwrite');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.reason).toBe('held');
    if (result.reason !== 'held') throw new Error('expected held');
    expect(result.lease.agentId).toBe('agent-a');
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('serialises two concurrent writes to the SAME unclaimed file (TOCTOU guard)', async () => {
    // Regression: before the fix, both agents passed the sync `canWrite` check
    // (no lease yet) and the lease was only recorded AFTER the await — so both
    // writes landed and clobbered each other. Claiming SYNCHRONOUSLY before the
    // await closes the window: the second concurrent writer must be refused.
    const calls: string[] = [];
    let release1: (() => void) | null = null;
    const gate1 = new Promise<void>((r) => (release1 = r));
    const writeFile = vi.fn(async (filePath: string, data: string): Promise<MtuiResponse> => {
      // The first write blocks until we let it through, holding the lease while
      // the second concurrent write attempt runs.
      if (calls.length === 0) {
        calls.push(data);
        await gate1;
        return { ok: true };
      }
      calls.push(data);
      return { ok: true };
    });
    const service = createTeamEditService({ writeFile });

    const first = service.write(ROOT, 'agent-a', 'src/a.ts', 'from-a');
    const second = service.write(ROOT, 'agent-b', 'src/a.ts', 'from-b');
    // agent-b is refused immediately (synchronous claim conflict), before its
    // write touches MTUI.
    const secondResult = await second;
    expect(secondResult.ok).toBe(false);
    if (secondResult.ok) throw new Error('expected agent-b refused');
    expect(secondResult.reason).toBe('held');
    if (secondResult.reason !== 'held') throw new Error('expected held');
    expect(secondResult.lease.agentId).toBe('agent-a');

    release1?.();
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
    // Only agent-a's write reached MTUI; agent-b never clobbered it.
    expect(calls).toEqual(['from-a']);
  });

  it('releases a freshly-acquired lease when the write fails (no orphan lease)', async () => {
    const { writeFile } = makeWriter(false);
    const service = createTeamEditService({ writeFile });
    const result = await service.write(ROOT, 'agent-a', 'src/a.ts', 'data');
    expect(result.ok).toBe(false);
    // The failed write must not leave agent-a holding the file.
    expect(service.snapshot(ROOT).leases).toHaveLength(0);
  });

  it('keeps a PRE-EXISTING lease when a write fails (does not release what the agent already held)', async () => {
    const { writeFile } = makeWriter(false);
    const service = createTeamEditService({ writeFile });
    service.claim(ROOT, 'agent-a', 'src/a.ts', 'editing');
    const result = await service.write(ROOT, 'agent-a', 'src/a.ts', 'data');
    expect(result.ok).toBe(false);
    // The agent already held the lease before this write — keep it.
    expect(service.snapshot(ROOT).leases.map((l) => l.agentId)).toEqual(['agent-a']);
  });

  it('surfaces an MTUI write failure as an error result', async () => {
    const { writeFile } = makeWriter(false);
    const service = createTeamEditService({ writeFile });
    const result = await service.write(ROOT, 'agent-a', 'src/a.ts', 'data');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('error');
  });

  it('isolates leases per workspace root', async () => {
    const { writeFile } = makeWriter();
    const service = createTeamEditService({ writeFile });
    service.claim('/repo-a', 'agent-a', 'src/a.ts');
    // Same path, different workspace → not blocked.
    const result = await service.write('/repo-b', 'agent-b', 'src/a.ts', 'ok');
    expect(result.ok).toBe(true);
  });

  it('accepts absolute paths under the root and stores them workspace-relative', async () => {
    const { writeFile, calls } = makeWriter();
    const service = createTeamEditService({ writeFile });
    const result = await service.write(ROOT, 'agent-a', '/repo/src/deep/a.ts', 'x');
    expect(result.ok).toBe(true);
    expect(service.snapshot(ROOT).leases[0].relPath).toBe('src/deep/a.ts');
    // The MTUI writer still receives an absolute path.
    expect(calls[0].filePath.replace(/\\/g, '/')).toBe('/repo/src/deep/a.ts');
  });
});

describe('teamEditService — collaborative editReplace', () => {
  /** A fake MTUI anchor editor returning a configurable envelope. */
  const makeEditor = (envelope: MtuiResponse) => {
    const calls: Array<{ filePath: string; oldText: string; newText: string }> = [];
    const editReplace = vi.fn(async (filePath: string, oldText: string, newText: string): Promise<MtuiResponse> => {
      calls.push({ filePath, oldText, newText });
      return envelope;
    });
    return { editReplace, calls };
  };

  it('applies an anchor replace via MTUI and records the edit', async () => {
    const { editReplace, calls } = makeEditor({ ok: true, matches: 1 });
    const service = createTeamEditService({ editReplace });
    const result = await service.editReplace(ROOT, 'agent-a', 'src/a.ts', 'old', 'new');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.matches).toBe(1);
    expect(calls[0]).toMatchObject({ oldText: 'old', newText: 'new' });
    expect(service.snapshot(ROOT).leases.map((l) => l.agentId)).toEqual(['agent-a']);
  });

  it('maps a stale anchor (NO_MATCH) to reason "stale" and releases the fresh lease', async () => {
    const { editReplace } = makeEditor({ ok: false, error_type: 'NO_MATCH', message: 'Text not found' });
    const service = createTeamEditService({ editReplace });
    const result = await service.editReplace(ROOT, 'agent-a', 'src/a.ts', 'gone', 'x');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('stale');
    // A failed edit must not leave agent-a holding the file.
    expect(service.snapshot(ROOT).leases).toHaveLength(0);
  });

  it('maps an overlapping concurrent edit (CONFLICT) to reason "stale"', async () => {
    const { editReplace } = makeEditor({ ok: false, error_type: 'CONFLICT', message: 'Blocked: overlaps' });
    const service = createTeamEditService({ editReplace });
    const result = await service.editReplace(ROOT, 'agent-a', 'src/a.ts', 'beta', 'beta2');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('stale');
  });

  it('maps an ambiguous anchor (MULTIPLE_MATCHES) to reason "ambiguous"', async () => {
    const { editReplace } = makeEditor({ ok: false, error_type: 'MULTIPLE_MATCHES', message: 'Found 2 matches' });
    const service = createTeamEditService({ editReplace });
    const result = await service.editReplace(ROOT, 'agent-a', 'src/a.ts', 'x', 'y');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('ambiguous');
  });

  it('refuses an edit when another agent holds the file (no MTUI call)', async () => {
    const { editReplace } = makeEditor({ ok: true, matches: 1 });
    const service = createTeamEditService({ editReplace });
    service.claim(ROOT, 'agent-a', 'src/a.ts', 'editing');
    const result = await service.editReplace(ROOT, 'agent-b', 'src/a.ts', 'old', 'new');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected refusal');
    expect(result.reason).toBe('held');
    expect(editReplace).not.toHaveBeenCalled();
  });

  it('lets two agents edit DIFFERENT anchors of the same file (MTUI merges; leases released between)', async () => {
    const { editReplace } = makeEditor({ ok: true, matches: 1 });
    const service = createTeamEditService({ editReplace });
    const a = await service.editReplace(ROOT, 'agent-a', 'src/a.ts', 'alpha', 'alpha2');
    expect(a.ok).toBe(true);
    service.release(ROOT, 'agent-a', 'src/a.ts');
    const b = await service.editReplace(ROOT, 'agent-b', 'src/a.ts', 'gamma', 'gamma2');
    expect(b.ok).toBe(true);
  });
});

describe('teamEditService — change notifications', () => {
  it('emits a snapshot on every mutation', async () => {
    const { writeFile } = makeWriter();
    const onChange = vi.fn();
    const service = createTeamEditService({ writeFile, onChange });
    service.join(ROOT, 'agent-a', 'Agent A');
    service.claim(ROOT, 'agent-a', 'src/a.ts');
    await service.write(ROOT, 'agent-a', 'src/a.ts', 'x');
    service.release(ROOT, 'agent-a', 'src/a.ts');
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.rootPath).toBe(ROOT);
  });

  it('reset drops the workspace coordinator', async () => {
    const { writeFile } = makeWriter();
    const service = createTeamEditService({ writeFile });
    service.claim(ROOT, 'agent-a', 'src/a.ts');
    service.reset(ROOT);
    expect(service.snapshot(ROOT).leases).toHaveLength(0);
  });
});

describe('teamEditService — immutable VIU preview packages', () => {
  const publish = (
    service: ReturnType<typeof createTeamEditService>,
    state: ViuProjectState,
    packageId = 'preview-home',
    teamTaskId?: string
  ) =>
    service.publishPreview(
      ROOT,
      state,
      {
        snapshotId: 'snapshot-' + packageId,
        createdAt: 100,
        startScreenId: 'screen-home',
        metadata: { title: 'Checkout prototype', createdBy: 'agent-design' },
      },
      { packageId, createdAt: 101, teamWorkspaceKey: ROOT, ...(teamTaskId ? { teamTaskId } : {}) }
    );

  it('rejects publication into a different Team workspace', () => {
    const service = createTeamEditService();
    const state = createPremiumStarterProject('project-preview-workspace');

    expect(() =>
      service.publishPreview(
        ROOT,
        state,
        {
          snapshotId: 'snapshot-wrong-workspace',
          createdAt: 100,
          startScreenId: 'screen-home',
          metadata: { title: 'Wrong workspace', createdBy: 'agent-design' },
        },
        { packageId: 'package-wrong-workspace', createdAt: 101, teamWorkspaceKey: '/another-repo' }
      )
    ).toThrow('does not match');
  });

  it('rejects a package linked to a missing Team task', () => {
    const service = createTeamEditService();
    const state = createPremiumStarterProject('project-preview-task');

    expect(() => publish(service, state, 'preview-missing-task', 'missing-task')).toThrow('Unknown Team task');
  });

  it('freezes the published snapshot independently from later project edits', () => {
    const service = createTeamEditService();
    const state = createPremiumStarterProject('project-preview-immutable');
    const item = publish(service, state);
    state.nodes['node-home-title']!.content = { text: 'Changed after publication' };

    expect(Object.isFrozen(item)).toBe(true);
    expect(Object.isFrozen(item.snapshot.project)).toBe(true);
    expect(item.snapshot.project.nodes['node-home-title']?.content?.text).not.toBe('Changed after publication');
  });

  it('keeps version one immutable and rejects duplicate package ids', () => {
    const service = createTeamEditService();
    const state = createPremiumStarterProject('project-preview-version');
    const item = publish(service, state, 'preview-versioned');

    expect(item.version).toBe(1);
    expect(() => publish(service, state, 'preview-versioned')).toThrow('already exists');
  });

  it('validates feedback anchors against the exact published snapshot', () => {
    const service = createTeamEditService();
    const state = createPremiumStarterProject('project-preview-feedback');
    const item = publish(service, state, 'preview-feedback');

    expect(() =>
      service.appendPreviewFeedback(ROOT, item.packageId, {
        feedbackId: 'feedback-invalid',
        authorId: 'user',
        authorKind: 'user',
        createdAt: 200,
        kind: 'issue',
        body: 'Wrong screen',
        screenId: 'screen-missing',
      })
    ).toThrow('does not exist');
    const event = service.appendPreviewFeedback(ROOT, item.packageId, {
      feedbackId: 'feedback-valid',
      authorId: 'user',
      authorKind: 'user',
      createdAt: 201,
      kind: 'comment',
      body: 'Make the CTA clearer',
      screenId: 'screen-home',
      nodeId: 'node-home-cta',
    });
    expect(event.snapshotId).toBe(item.snapshot.snapshotId);
    expect(service.listPreviewFeedback(ROOT, item.packageId)).toEqual([event]);
  });

  it('restores published packages and append-only feedback after a service restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tomny-viu-preview-'));
    try {
      const persistence = createTeamPreviewFilePersistence(directory);
      const first = createTeamEditService({ previewPersistence: persistence });
      const state = createPremiumStarterProject('project-preview-persisted');
      const item = publish(first, state, 'preview-persisted');
      first.appendPreviewFeedback(ROOT, item.packageId, {
        feedbackId: 'feedback-persisted',
        authorId: 'reviewer',
        authorKind: 'user',
        createdAt: 202,
        kind: 'approval',
        body: 'Ready to build',
        screenId: 'screen-home',
      });

      const restarted = createTeamEditService({ previewPersistence: persistence });
      const restored = restarted.getPreview(ROOT, item.packageId, 'user-preview');

      expect(restored.snapshot.contentDigest).toBe(item.snapshot.contentDigest);
      expect(Object.isFrozen(restored.snapshot.project)).toBe(true);
      expect(restarted.listPreviewFeedback(ROOT, item.packageId)).toMatchObject([
        { feedbackId: 'feedback-persisted', body: 'Ready to build' },
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects a tampered on-disk preview archive without exposing forged content', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tomny-viu-preview-tamper-'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const persistence = createTeamPreviewFilePersistence(directory);
      const first = createTeamEditService({ previewPersistence: persistence });
      const state = createPremiumStarterProject('project-preview-tampered');
      publish(first, state, 'preview-tampered');

      const storedFile = join(directory, readdirSync(directory)[0]!);
      const archive = JSON.parse(readFileSync(storedFile, 'utf8')) as {
        packages: Array<{ snapshot: { contentDigest: string } }>;
      };
      archive.packages[0]!.snapshot.contentDigest = 'forged-digest';
      writeFileSync(storedFile, JSON.stringify(archive), 'utf8');

      const restarted = createTeamEditService({ previewPersistence: persistence });
      expect(restarted.listPreviews(ROOT)).toEqual([]);
      expect(consoleError).toHaveBeenCalledWith(
        '[teamEditService] Ignoring an invalid VIU preview archive:',
        expect.any(Error)
      );
    } finally {
      consoleError.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not expose an unpublished in-memory package when durable save fails', () => {
    const persistence = {
      load: vi.fn(() => undefined),
      save: vi.fn(() => {
        throw new Error('disk full');
      }),
    };
    const service = createTeamEditService({ previewPersistence: persistence });
    const state = createPremiumStarterProject('project-preview-transaction');

    expect(() => publish(service, state, 'preview-not-saved')).toThrow('disk full');
    expect(service.listPreviews(ROOT)).toEqual([]);
  });

  it('creates only opaque local references without paths or credentials', async () => {
    const { createViuLocalTestReference } = await import('@renderer/pages/studio/ide/teamEdit/teamEditClient');
    const reference = createViuLocalTestReference('preview-home_01');

    expect(reference).toBe('viu-preview://team-test/preview-home_01');
    expect(reference).not.toContain(ROOT);
    expect(reference).not.toMatch(/(?:token|password|secret)=/i);
    expect(() => createViuLocalTestReference('../repo?token=secret')).toThrow('opaque identifier');
  });

  it('returns the same immutable package to user and agent preview consumers', () => {
    const service = createTeamEditService();
    const state = createPremiumStarterProject('project-preview-parity');
    const item = publish(service, state, 'preview-parity');

    expect(service.getPreview(ROOT, item.packageId, 'user-preview')).toBe(item);
    expect(service.getPreview(ROOT, item.packageId, 'agent-preview')).toBe(item);
  });
});

describe('teamEditService — shared singleton (UI + agent plane)', () => {
  it('returns ONE instance regardless of call order vs the change listener (no split-brain)', () => {
    // Agent plane resolves the service BEFORE the bridge wires its listener
    // (the real boot-order hazard). Both must end up sharing one coordinator.
    const first = getTeamEditService();
    const events: string[] = [];
    setTeamEditChangeListener((s) => events.push(s.rootPath));
    const second = getTeamEditService();
    expect(second).toBe(first); // same instance — agent + UI see the same state

    // A mutation on the shared instance flows to the late-registered listener.
    first.claim(ROOT, 'agent-a', 'src/a.ts');
    expect(events).toContain(ROOT);
    expect(first.snapshot(ROOT).leases.map((l) => l.agentId)).toEqual(['agent-a']);
    first.reset(ROOT);
  });
});

describe('teamEditBridge - Main IPC envelopes', () => {
  afterEach(() => {
    vi.doUnmock('@office-ai/platform');
    vi.doUnmock('@/process/ide/teamEdit/teamEditService');
    vi.resetModules();
  });

  it('binds every provider, emits changes, and forwards success results', async () => {
    vi.resetModules();
    const providers = new Map<string, (request: never) => Promise<unknown>>();
    const emit = vi.fn();
    let changeListener: ((snapshot: unknown) => void) | undefined;
    const service = {
      snapshot: vi.fn(() => ({ rootPath: ROOT })),
      join: vi.fn(),
      claim: vi.fn(() => ({ ok: true, lease: { relPath: 'src/app.ts' }, renewed: false })),
      release: vi.fn(() => true),
      reset: vi.fn(),
      write: vi.fn(async () => ({ ok: true, bytes: 4 })),
      editReplace: vi.fn(async () => ({ ok: true, matches: 1 })),
      saveTask: vi.fn(() => ({ id: 'task-1' })),
      removeTask: vi.fn(() => true),
      saveGroup: vi.fn(() => ({ id: 'group-1' })),
      removeGroup: vi.fn(() => true),
      postMessage: vi.fn(() => ({ id: 'message-1' })),
      publishPreview: vi.fn(() => ({ packageId: 'package-1' })),
      listPreviews: vi.fn(() => [{ packageId: 'package-1' }]),
      getPreview: vi.fn(() => ({ packageId: 'package-1' })),
      appendPreviewFeedback: vi.fn(() => ({ feedbackId: 'feedback-1' })),
      listPreviewFeedback: vi.fn(() => [{ feedbackId: 'feedback-1' }]),
    };

    vi.doMock('@office-ai/platform', () => ({
      bridge: {
        buildProvider: (channel: string) => ({
          provider: (handler: (request: never) => Promise<unknown>) => providers.set(channel, handler),
        }),
        buildEmitter: () => ({ emit }),
      },
    }));
    vi.doMock('@/process/ide/teamEdit/teamEditService', () => ({
      getTeamEditService: () => service,
      setTeamEditChangeListener: (listener: (snapshot: unknown) => void) => {
        changeListener = listener;
      },
    }));

    const { registerTeamEditBridge } = await import('@/process/ide/teamEdit/teamEditBridge');
    registerTeamEditBridge();

    const requests: Record<string, unknown> = {
      'ide.team-snapshot': { rootPath: ROOT },
      'ide.team-join': { rootPath: ROOT, agentId: 'user', label: 'You', isUser: true },
      'ide.team-claim': { rootPath: ROOT, agentId: 'user', relPath: 'src/app.ts', intent: 'review' },
      'ide.team-release': { rootPath: ROOT, agentId: 'user', relPath: 'src/app.ts' },
      'ide.team-reset': { rootPath: ROOT },
      'ide.team-write': { rootPath: ROOT, agentId: 'agent-a', relPath: 'src/app.ts', data: 'next' },
      'ide.team-edit': {
        rootPath: ROOT,
        agentId: 'agent-a',
        relPath: 'src/app.ts',
        oldText: 'old',
        newText: 'new',
      },
      'ide.team-task-save': { rootPath: ROOT, task: { id: 'task-1' } },
      'ide.team-task-remove': { rootPath: ROOT, taskId: 'task-1' },
      'ide.team-group-save': { rootPath: ROOT, group: { id: 'group-1' } },
      'ide.team-group-remove': { rootPath: ROOT, groupId: 'group-1' },
      'ide.team-message-post': { rootPath: ROOT, senderId: 'user', body: 'Review', taskId: 'task-1' },
      'ide.team-preview-publish': { rootPath: ROOT, state: {}, snapshot: {}, share: {} },
      'ide.team-preview-list': { rootPath: ROOT },
      'ide.team-preview-get': { rootPath: ROOT, packageId: 'package-1', consumer: 'user-preview' },
      'ide.team-preview-feedback-append': { rootPath: ROOT, packageId: 'package-1', feedback: {} },
      'ide.team-preview-feedback-list': { rootPath: ROOT, packageId: 'package-1' },
    };

    expect(new Set(providers.keys())).toEqual(new Set(Object.keys(requests)));
    await Promise.all(
      Object.entries(requests).map(([channel, request]) =>
        expect(providers.get(channel)?.(request as never)).resolves.toMatchObject({ ok: true })
      )
    );

    changeListener?.({ rootPath: ROOT });
    expect(emit).toHaveBeenCalledWith({ snapshot: { rootPath: ROOT } });
    expect(service.getPreview).toHaveBeenCalledWith(ROOT, 'package-1', 'user-preview');
    expect(service.appendPreviewFeedback).toHaveBeenCalledWith(ROOT, 'package-1', {});
  });

  it('turns failures from every service boundary into resolving error envelopes', async () => {
    vi.resetModules();
    const providers = new Map<string, (request: never) => Promise<unknown>>();
    const fail = failTeamServiceOperation;
    const service = {
      snapshot: vi.fn(fail),
      join: vi.fn(fail),
      claim: vi.fn(fail),
      release: vi.fn(fail),
      reset: vi.fn(fail),
      write: vi.fn(fail),
      editReplace: vi.fn(fail),
      saveTask: vi.fn(fail),
      removeTask: vi.fn(fail),
      saveGroup: vi.fn(fail),
      removeGroup: vi.fn(fail),
      postMessage: vi.fn(fail),
      publishPreview: vi.fn(fail),
      listPreviews: vi.fn(fail),
      getPreview: vi.fn(fail),
      appendPreviewFeedback: vi.fn(fail),
      listPreviewFeedback: vi.fn(fail),
    };

    vi.doMock('@office-ai/platform', () => ({
      bridge: {
        buildProvider: (channel: string) => ({
          provider: (handler: (request: never) => Promise<unknown>) => providers.set(channel, handler),
        }),
        buildEmitter: () => ({ emit: vi.fn() }),
      },
    }));
    vi.doMock('@/process/ide/teamEdit/teamEditService', () => ({
      getTeamEditService: () => service,
      setTeamEditChangeListener: vi.fn(),
    }));

    const { registerTeamEditBridge } = await import('@/process/ide/teamEdit/teamEditBridge');
    registerTeamEditBridge();

    const request = {
      rootPath: ROOT,
      agentId: 'agent-a',
      label: 'Agent A',
      relPath: 'src/app.ts',
      intent: 'review',
      data: 'next',
      oldText: 'old',
      newText: 'new',
      task: {},
      taskId: 'task-1',
      group: {},
      groupId: 'group-1',
      senderId: 'user',
      body: 'Review',
      state: {},
      snapshot: {},
      share: {},
      packageId: 'package-1',
      consumer: 'agent-preview',
      feedback: {},
    };

    await Promise.all(
      [...providers.values()].map((handler) =>
        expect(handler(request as never)).resolves.toEqual({ ok: false, error: 'service blocked' })
      )
    );
  });
});
describe('teamEditClient - renderer IPC contract', () => {
  afterEach(() => {
    vi.doUnmock('@office-ai/platform');
    vi.resetModules();
    vi.useRealTimers();
  });

  it('forwards every Team operation with its complete typed payload', async () => {
    vi.resetModules();
    const invoke = vi.fn(async (channel: string, payload: unknown) => ({ ok: true, data: { channel, payload } }));
    let changedListener: ((value: { snapshot: { rootPath: string } }) => void) | undefined;
    const unsubscribe = vi.fn();

    vi.doMock('@office-ai/platform', () => ({
      bridge: {
        buildProvider: (channel: string) => ({
          invoke: (payload?: unknown) => invoke(channel, payload),
        }),
        buildEmitter: () => ({
          on: (listener: (value: { snapshot: { rootPath: string } }) => void) => {
            changedListener = listener;
            return unsubscribe;
          },
        }),
      },
    }));

    const { teamEditClient } = await import('@renderer/pages/studio/ide/teamEdit/teamEditClient');
    const task = { id: 'task-1', title: 'Review checkout' };
    const group = { id: 'group-1', name: 'Frontend' };
    const state = { projectId: 'project-1' };
    const snapshot = { snapshotId: 'snapshot-1' };
    const share = { packageId: 'package-1' };
    const feedback = { feedbackId: 'feedback-1', body: 'Ready' };

    await teamEditClient.snapshot(ROOT);
    await teamEditClient.join(ROOT, 'user', 'You');
    await teamEditClient.claim(ROOT, 'user', 'src/app.ts', 'review');
    await teamEditClient.release(ROOT, 'user', 'src/app.ts');
    await teamEditClient.reset(ROOT);
    await teamEditClient.write(ROOT, 'agent-a', 'src/app.ts', 'next');
    await teamEditClient.edit(ROOT, 'agent-a', 'src/app.ts', 'old', 'new');
    await teamEditClient.saveTask(ROOT, task as never);
    await teamEditClient.removeTask(ROOT, 'task-1');
    await teamEditClient.saveGroup(ROOT, group as never);
    await teamEditClient.removeGroup(ROOT, 'group-1');
    await teamEditClient.postMessage(ROOT, 'user', 'Please review', 'task-1');
    await teamEditClient.publishPreview(ROOT, state as never, snapshot as never, share as never);
    await teamEditClient.listPreviews(ROOT);
    await teamEditClient.getPreview(ROOT, 'package-1', 'agent-preview');
    await teamEditClient.appendPreviewFeedback(ROOT, 'package-1', feedback as never);
    await teamEditClient.listPreviewFeedback(ROOT, 'package-1');

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      'ide.team-snapshot',
      'ide.team-join',
      'ide.team-claim',
      'ide.team-release',
      'ide.team-reset',
      'ide.team-write',
      'ide.team-edit',
      'ide.team-task-save',
      'ide.team-task-remove',
      'ide.team-group-save',
      'ide.team-group-remove',
      'ide.team-message-post',
      'ide.team-preview-publish',
      'ide.team-preview-list',
      'ide.team-preview-get',
      'ide.team-preview-feedback-append',
      'ide.team-preview-feedback-list',
    ]);
    expect(invoke).toHaveBeenCalledWith('ide.team-join', {
      rootPath: ROOT,
      agentId: 'user',
      label: 'You',
      isUser: true,
    });
    expect(invoke).toHaveBeenCalledWith('ide.team-preview-get', {
      rootPath: ROOT,
      packageId: 'package-1',
      consumer: 'agent-preview',
    });

    const listener = vi.fn();
    expect(teamEditClient.onChanged(listener)).toBe(unsubscribe);
    changedListener?.({ snapshot: { rootPath: ROOT } });
    expect(listener).toHaveBeenCalledWith({ rootPath: ROOT });
  });

  it('rejects provider failures and a missing IPC reply with explicit errors', async () => {
    vi.useFakeTimers();
    const invoke = vi.fn<() => Promise<unknown>>();
    vi.doMock('@office-ai/platform', () => ({
      bridge: {
        buildProvider: () => ({ invoke }),
        buildEmitter: () => ({ on: vi.fn() }),
      },
    }));

    const { TeamEditTimeoutError, teamEditClient } = await import('@renderer/pages/studio/ide/teamEdit/teamEditClient');
    invoke.mockRejectedValueOnce('bridge failed');
    await expect(teamEditClient.snapshot(ROOT)).rejects.toThrow('bridge failed');

    invoke.mockReturnValueOnce(new Promise(() => {}));
    const pending = expect(teamEditClient.snapshot(ROOT)).rejects.toBeInstanceOf(TeamEditTimeoutError);
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
  });
});
