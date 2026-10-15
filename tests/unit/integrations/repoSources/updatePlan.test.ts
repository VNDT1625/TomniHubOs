import { describe, expect, it } from 'vitest';
import { parseAdapterDocument, type AdapterDocument } from '@/common/packages/adapter';
import {
  bumpPatchVersion,
  diffOpenItems,
  isUpgradeVersion,
  planSourceUpdate,
  resolveUpdatableSource,
} from '@process/integrations/repoSources/updatePlan';

const document = (connections: unknown[], openItems: unknown[] = []): AdapterDocument =>
  parseAdapterDocument({ schemaVersion: 1, generatedBy: 'classifier', connections, openItems });

const command = (id: string, description = 'Does a thing') => ({
  kind: 'command',
  id,
  title: id,
  description,
  path: `source/commands/${id}.md`,
  format: 'markdown',
});
const hook = (id: string, args = ['source/hooks/run.js']) => ({
  kind: 'hook',
  id,
  event: 'PostToolUse',
  command: 'node',
  args,
});
const cli = (id: string, commandName = 'tool') => ({
  kind: 'cli',
  id,
  title: id,
  command: commandName,
  display: 'terminal',
});
const mcpHttp = (id: string, url: string) => ({ kind: 'mcp', id, title: id, transport: 'http', url });

const unrecognized = (path: string, note = 'Not understood') => ({ kind: 'unrecognized', note, path });
const envValue = (name: string) => ({ kind: 'env-value', note: 'Needs a value', name, required: true });

const entryOf = (plan: ReturnType<typeof planSourceUpdate>, key: string) =>
  plan.connections.find((entry) => entry.key === key);

describe('planSourceUpdate: the four cases of design 9.5', () => {
  const previous = document([
    command('same'),
    command('docs', 'old text'),
    hook('runner'),
    hook('steady'),
    cli('gone'),
  ]);
  const next = document([
    command('same'),
    command('docs', 'new text'),
    hook('runner', ['source/hooks/other.js']),
    hook('steady'),
    cli('fresh'),
  ]);
  const everythingOn = new Set(['command:same', 'command:docs', 'hook:runner', 'hook:steady', 'cli:gone']);

  it('1. unchanged: the connection keeps whatever state it had', () => {
    const plan = planSourceUpdate({ previous, next, enabledKeys: everythingOn });
    expect(entryOf(plan, 'command:same')).toMatchObject({
      change: 'unchanged',
      effect: 'keeps-state',
      wasEnabled: true,
    });
    expect(entryOf(plan, 'hook:steady')).toMatchObject({ change: 'unchanged', effect: 'keeps-state' });
  });

  it('2. a data connection that changed follows the update and stays on', () => {
    const plan = planSourceUpdate({ previous, next, enabledKeys: everythingOn });
    expect(entryOf(plan, 'command:docs')).toMatchObject({ change: 'data-changed', effect: 'follows-update' });
  });

  it('3. a connection that runs code and changed turns off and needs approval again', () => {
    const plan = planSourceUpdate({ previous, next, enabledKeys: everythingOn });
    expect(entryOf(plan, 'hook:runner')).toMatchObject({ change: 'code-changed', effect: 'turns-off-needs-approval' });
    expect(plan.needsReapproval).toEqual(['hook:runner']);
  });

  it('4. a new connection starts off and a removed one is removed', () => {
    const plan = planSourceUpdate({ previous, next, enabledKeys: everythingOn });
    expect(entryOf(plan, 'cli:fresh')).toMatchObject({ change: 'added', effect: 'added-off', wasEnabled: false });
    expect(entryOf(plan, 'cli:gone')).toMatchObject({ change: 'removed', effect: 'removed', wasEnabled: true });
    expect(plan.counts).toEqual({ unchanged: 2, 'data-changed': 1, 'code-changed': 1, added: 1, removed: 1 });
    expect(plan.noChanges).toBe(false);
  });

  it('a changed connection the user never turned on stays as it was: nothing to turn off', () => {
    const plan = planSourceUpdate({ previous, next, enabledKeys: new Set() });
    expect(entryOf(plan, 'hook:runner')).toMatchObject({
      change: 'code-changed',
      effect: 'keeps-state',
      wasEnabled: false,
    });
    expect(entryOf(plan, 'command:docs')).toMatchObject({ change: 'data-changed', effect: 'keeps-state' });
    expect(plan.needsReapproval).toEqual([]);
  });

  it('treats every kind that is not plain content as code: a changed address needs approval too', () => {
    const before = document([mcpHttp('docs', 'https://one.example.com/mcp')]);
    const after = document([mcpHttp('docs', 'https://two.example.com/mcp')]);
    const plan = planSourceUpdate({ previous: before, next: after, enabledKeys: new Set(['mcp:docs']) });
    expect(plan.connections[0]).toMatchObject({ change: 'code-changed', effect: 'turns-off-needs-approval' });
  });

  it('ignores key order inside a connection', () => {
    const before = document([cli('tool')]);
    const reordered = document([{ display: 'terminal', command: 'tool', title: 'tool', id: 'tool', kind: 'cli' }]);
    expect(planSourceUpdate({ previous: before, next: reordered, enabledKeys: new Set() }).noChanges).toBe(true);
  });

  it('gives the same plan whatever order the connections are listed in', () => {
    const forward = planSourceUpdate({ previous, next, enabledKeys: everythingOn });
    const backward = planSourceUpdate({
      previous: document(previous.connections.toReversed()),
      next: document(next.connections.toReversed()),
      enabledKeys: everythingOn,
    });
    expect(backward).toEqual(forward);
    const keys = forward.connections.map((entry) => entry.key);
    expect(keys).toEqual(keys.toSorted());
  });

  it('reports no changes for an identical source', () => {
    const plan = planSourceUpdate({ previous, next: previous, enabledKeys: everythingOn });
    expect(plan.noChanges).toBe(true);
    expect(plan.needsReapproval).toEqual([]);
  });
});

describe('diffOpenItems', () => {
  it('lists added, removed and changed items and counts the rest', () => {
    const diff = diffOpenItems(
      document([], [unrecognized('source/a.json'), unrecognized('source/b.json'), envValue('TOKEN')]).openItems ?? [],
      document([], [unrecognized('source/a.json'), unrecognized('source/b.json', 'Different note'), envValue('KEY')])
        .openItems ?? []
    );
    expect(diff.unchanged).toBe(1);
    expect(diff.changed.map((item) => item.next.path)).toEqual(['source/b.json']);
    expect(diff.added.map((item) => item.name)).toEqual(['KEY']);
    expect(diff.removed.map((item) => item.name)).toEqual(['TOKEN']);
  });

  it('counts a repeated identical item instead of merging it away', () => {
    const one = document([], [unrecognized('source/a.json')]).openItems ?? [];
    const two = document([], [unrecognized('source/a.json'), unrecognized('source/a.json')]).openItems ?? [];
    expect(diffOpenItems(one, two).added).toHaveLength(1);
    expect(diffOpenItems(two, one).removed).toHaveLength(1);
  });

  it('a new open item alone makes the plan report a change', () => {
    const plan = planSourceUpdate({
      previous: document([cli('tool')]),
      next: document([cli('tool')], [envValue('TOKEN')]),
      enabledKeys: new Set(),
    });
    expect(plan.noChanges).toBe(false);
    expect(plan.openItems.added).toHaveLength(1);
  });
});

describe('resolveUpdatableSource', () => {
  const base = { packagedAt: 1 };
  it('accepts a Git source with an address and carries ref, folder and commit', () => {
    const commit = 'a'.repeat(40);
    expect(
      resolveUpdatableSource({
        ...base,
        kind: 'git',
        url: 'https://github.com/o/r.git',
        ref: 'main',
        subdirectory: 'pkg',
        commit,
      })
    ).toEqual({ ok: true, url: 'https://github.com/o/r.git', ref: 'main', subdirectory: 'pkg', commit });
  });

  it('refuses a missing record, a folder and a Git record without an address, each for its own reason', () => {
    expect(resolveUpdatableSource(undefined)).toMatchObject({ ok: false, reason: 'NO_PROVENANCE' });
    expect(resolveUpdatableSource({ ...base, kind: 'local' })).toMatchObject({
      ok: false,
      reason: 'SOURCE_NOT_UPDATABLE',
    });
    expect(resolveUpdatableSource({ ...base, kind: 'git' })).toMatchObject({
      ok: false,
      reason: 'SOURCE_NOT_UPDATABLE',
    });
    expect(
      resolveUpdatableSource({ ...base, kind: 'chrome-web-store', url: 'https://chromewebstore.google.com/x' })
    ).toMatchObject({ ok: false, reason: 'SOURCE_NOT_UPDATABLE' });
  });
});

describe('versions', () => {
  it('only a higher version is an upgrade', () => {
    expect(isUpgradeVersion('1.0.0', '1.0.1')).toBe(true);
    expect(isUpgradeVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isUpgradeVersion('1.2.0', '1.1.9')).toBe(false);
    expect(isUpgradeVersion('1.0.0', 'not-a-version')).toBe(false);
  });

  it('counts the patch number up and refuses a version it cannot read', () => {
    expect(bumpPatchVersion('1.4.9')).toBe('1.4.10');
    expect(bumpPatchVersion('banana')).toBeUndefined();
  });
});
