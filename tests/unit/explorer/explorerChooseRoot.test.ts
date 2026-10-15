import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ExplorerGrantStore } from '@process/resources/explorer/explorerGrantStore';
import { createChooseRoot, type ExplorerConsentDeps } from '@process/resources/explorer/explorerChooseRoot';

const window = {} as never;
const sender = { id: 42 } as never;
const event = { sender } as never;

type Fixture = {
  choose: ReturnType<typeof createChooseRoot>;
  confirmGrant: Mock<(target: string) => Promise<boolean>>;
  pickFolder: Mock<() => Promise<string | null>>;
};

/** Builds a chooseRoot wired to one grant file, as a fresh process run would. */
const fixture = async (file: string): Promise<Fixture> => {
  const confirmGrant = vi.fn(async (_target: string): Promise<boolean> => true);
  const pickFolder = vi.fn(async (): Promise<string | null> => null);
  const deps: ExplorerConsentDeps = {
    resolveWindow: () => window,
    ready: Promise.resolve(),
    defaultRoot: () => path.join(path.dirname(file), 'workdir'),
    grantStore: new ExplorerGrantStore(file),
    t: (key: string) => key,
    pickFolder: () => pickFolder(),
    confirmGrant: (_owner, target) => confirmGrant(target),
  };
  return { choose: createChooseRoot(deps), confirmGrant, pickFolder };
};

let dir = '';
let grantFile = '';
let alpha = '';
let alphaChild = '';
let beta = '';

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tomny-explorer-grants-'));
  grantFile = path.join(dir, 'explorer-grants.json');
  alpha = path.join(dir, 'Alpha');
  alphaChild = path.join(alpha, 'packages', 'desktop');
  beta = path.join(dir, 'Beta');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('Explorer folder consent', () => {
  it('skips the consent dialog for a folder granted in an earlier run', async () => {
    const first = await fixture(grantFile);
    expect(await first.choose(event, { path: alpha })).toBe(alpha);
    expect(first.confirmGrant).toHaveBeenCalledOnce();
    expect(first.confirmGrant).toHaveBeenCalledWith(alpha);

    // A new store instance over the same file stands in for the next app run:
    // the grant must survive, so the dialog must not come back.
    const second = await fixture(grantFile);
    expect(await second.choose(event, { path: alpha })).toBe(alpha);
    expect(second.confirmGrant).not.toHaveBeenCalled();
  });

  it('covers every folder beneath a granted root without prompting again', async () => {
    const first = await fixture(grantFile);
    await first.choose(event, { path: alpha });

    const second = await fixture(grantFile);
    expect(await second.choose(event, { path: alphaChild })).toBe(alphaChild);
    expect(second.confirmGrant).not.toHaveBeenCalled();
  });

  it('still prompts for a sibling folder that was never granted', async () => {
    const first = await fixture(grantFile);
    await first.choose(event, { path: alpha });

    const second = await fixture(grantFile);
    expect(await second.choose(event, { path: beta })).toBe(beta);
    expect(second.confirmGrant).toHaveBeenCalledOnce();
  });

  it('keeps nothing granted when the user cancels the dialog', async () => {
    const first = await fixture(grantFile);
    first.confirmGrant.mockResolvedValue(false);
    expect(await first.choose(event, { path: alpha })).toBeNull();

    const second = await fixture(grantFile);
    second.confirmGrant.mockResolvedValue(false);
    expect(await second.choose(event, { path: alpha })).toBeNull();
    expect(second.confirmGrant).toHaveBeenCalledOnce();
  });

  it('refuses non-absolute paths instead of prompting for them', async () => {
    const first = await fixture(grantFile);
    await expect(first.choose(event, { path: path.join('Work', 'Alpha') })).rejects.toThrow('INVALID_REQUEST');
    expect(first.confirmGrant).not.toHaveBeenCalled();
  });

  it('fails closed when the grant file is unreadable', async () => {
    await writeFile(grantFile, '{ not json', 'utf8');
    const broken = await fixture(grantFile);
    await expect(broken.choose(event, { path: alpha })).rejects.toThrow('IO_ERROR');
  });

  it('persists canonical keys so a re-grant of the same folder is recorded once', async () => {
    const first = await fixture(grantFile);
    await first.choose(event, { path: alpha });
    await first.choose(event, { path: `${alpha}${path.sep}` });
    const entries = JSON.parse(await readFile(grantFile, 'utf8')) as string[];
    expect(entries).toHaveLength(1);
    expect(entries[0].toLowerCase()).toBe(path.resolve(alpha).toLowerCase());
  });

  it('defaults to the work directory without asking, and remembers it', async () => {
    const first = await fixture(grantFile);
    const workdir = path.join(path.dirname(grantFile), 'workdir');
    expect(await first.choose(event, {})).toBe(workdir);
    expect(first.confirmGrant).not.toHaveBeenCalled();

    const second = await fixture(grantFile);
    expect(await second.choose(event, { path: workdir })).toBe(workdir);
    expect(second.confirmGrant).not.toHaveBeenCalled();
  });
});
