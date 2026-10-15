import { beforeEach, describe, expect, it, vi } from 'vitest';

const runMtuiInRoot = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/desktop/src/process/resources/nativeFile/mtuiBridge', () => ({ runMtuiInRoot }));

import {
  ensureUnderstandCache,
  readsUnderstandCache,
} from '../../../packages/desktop/src/process/resources/nativeFile/mtuiUnderstand';

const calls = (): string[] => runMtuiInRoot.mock.calls.map((call) => (call[0] as string[]).slice(1).join(' '));

describe('mtui understand cache bootstrap', () => {
  beforeEach(() => {
    runMtuiInRoot.mockReset();
  });

  it('recognises the commands that read the cache', () => {
    expect(readsUnderstandCache(['context', 'chat'])).toBe(true);
    expect(readsUnderstandCache(['map', 'repo'])).toBe(true);
    expect(readsUnderstandCache(['read', 'a.ts'])).toBe(false);
    expect(readsUnderstandCache([])).toBe(false);
  });

  it('builds the cache before the first query when it is missing', async () => {
    runMtuiInRoot.mockImplementation(async (args: string[]) =>
      args.includes('status') ? { ok: true, exists: false } : { ok: true }
    );
    await ensureUnderstandCache('C:/repo');
    expect(calls()).toEqual(['understand status', 'understand build']);
  });

  it('does not rebuild a current cache', async () => {
    runMtuiInRoot.mockResolvedValue({ ok: true, exists: true, stale_marker_paths: 0, full_rebuild_required: false });
    await ensureUnderstandCache('C:/repo');
    expect(calls()).toEqual(['understand status']);
  });

  it('refreshes a stale cache without blocking the query', async () => {
    let finishBuild: () => void = () => undefined;
    runMtuiInRoot.mockImplementation((args: string[]) =>
      args.includes('status')
        ? Promise.resolve({ ok: true, exists: true, stale_marker_paths: 3 })
        : new Promise((resolve) => {
            finishBuild = () => resolve({ ok: true });
          })
    );
    await ensureUnderstandCache('C:/repo');
    expect(calls()).toEqual(['understand status', 'understand build']);
    finishBuild();
  });

  it('shares one build between concurrent callers', async () => {
    runMtuiInRoot.mockImplementation(async (args: string[]) =>
      args.includes('status') ? { ok: true, exists: false } : { ok: true }
    );
    await Promise.all([ensureUnderstandCache('C:/repo'), ensureUnderstandCache('C:/repo')]);
    expect(calls().filter((call) => call === 'understand build')).toHaveLength(1);
  });

  it('keeps the filesystem fallback when MTUI has no understand command', async () => {
    runMtuiInRoot.mockResolvedValue({ ok: false, error_type: 'INVALID_ARGUMENT' });
    await expect(ensureUnderstandCache('C:/repo')).resolves.toBeUndefined();
    expect(calls()).toEqual(['understand status']);
  });

  it('never throws when the MTUI process cannot start', async () => {
    runMtuiInRoot.mockRejectedValue(new Error('spawn failed'));
    await expect(ensureUnderstandCache('C:/repo')).resolves.toBeUndefined();
  });
});
