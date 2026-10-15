/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseAdapterDocument } from '@/common/packages/adapter';
import { createConnectionRegistry } from '@process/integrations/connections/core/registry';
import { createJsonConnectionStateStore } from '@process/integrations/connections/core/state';
import { createKnowledgeHost } from '@process/integrations/connections/hosts/data/knowledgeHost';
import { createRulesHost } from '@process/integrations/connections/hosts/data/rulesHost';
import { createKnowledgeIndex } from '@process/integrations/packageContext/knowledgeIndex';
import { createRulesService, MAX_RULES_FILE_BYTES } from '@process/integrations/packageContext/rulesService';

const PACKAGE_ID = 'com.community.awesome';
const WORKSPACE = path.resolve(os.tmpdir(), 'tomny-ws-hosts');

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const rulesRaw = (extra: Record<string, unknown> = {}) => ({
  kind: 'rules',
  id: 'style',
  title: 'House style',
  path: 'source/rules/style.md',
  format: 'agents-md',
  ...extra,
});
const knowledgeRaw = (extra: Record<string, unknown> = {}) => ({
  kind: 'knowledge',
  id: 'docs',
  title: 'Guides',
  paths: ['source/docs/getting-started.md', 'source/docs/api-reference.md'],
  ...extra,
});

/** A real registry and state store, the two hosts, the rules service and the index, over a package on disk. */
const makeWorld = async (connections: unknown[]) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-datahosts-'));
  roots.push(root);
  const packageDirectory = path.join(root, 'pkg');
  await mkdir(path.join(packageDirectory, 'source', 'rules'), { recursive: true });
  await mkdir(path.join(packageDirectory, 'source', 'docs'), { recursive: true });
  await writeFile(path.join(packageDirectory, 'source', 'rules', 'style.md'), 'Always write tests first.');
  await writeFile(
    path.join(packageDirectory, 'source', 'docs', 'getting-started.md'),
    'Install the CLI, then run the quickstart command.'
  );
  await writeFile(
    path.join(packageDirectory, 'source', 'docs', 'api-reference.md'),
    'The widget endpoint returns a list of widgets.'
  );
  const adapter = parseAdapterDocument({ schemaVersion: 1, generatedBy: 'classifier', connections });
  const installed = { value: true };

  /** `build` is also the restart: new reader of the files, hosts, registry and services over the same data. */
  const build = async () => {
    const store = createJsonConnectionStateStore(path.join(root, 'state.json'));
    await store.initialize();
    let registry: ReturnType<typeof createConnectionRegistry> | undefined;
    const lazy = {
      view: (packageId: string) => registry?.view(packageId) ?? Promise.resolve([]),
      enabledOfKind: (kind: Parameters<NonNullable<typeof registry>['enabledOfKind']>[0]) =>
        registry?.enabledOfKind(kind) ?? Promise.resolve([]),
    };
    const knowledge = createKnowledgeIndex({
      file: path.join(root, 'knowledge-index.json'),
      readText: async (owner, documentPath) => {
        const found = (await lazy.enabledOfKind('knowledge')).find(
          (item) => item.packageId === owner.packageId && item.key === `knowledge:${owner.collectionId}`
        );
        if (found === undefined) return undefined;
        return (await found.context.readPackageFile(documentPath)).toString('utf8');
      },
    });
    const rules = createRulesService({ registry: lazy, file: path.join(root, 'rules-attachments.json') });
    registry = createConnectionRegistry({
      store,
      hosts: [
        createRulesHost({ control: { prune: () => rules.prune() } }),
        createKnowledgeHost({ library: knowledge, enabledKnowledge: () => lazy.enabledOfKind('knowledge') }),
      ],
      loadPackage: async (packageId) =>
        packageId === PACKAGE_ID && installed.value
          ? { packageId, packageVersion: '1.0.0', packageDirectory, adapter }
          : undefined,
      listInstalledPackageIds: async () => (installed.value ? [PACKAGE_ID] : []),
    });
    return { store, registry, rules, knowledge };
  };

  const first = await build();
  await first.registry.syncPackage(PACKAGE_ID);
  const turnOn = async (key: string, registry = first.registry) => {
    const approval = await registry.describe(PACKAGE_ID, key);
    return registry.enable(PACKAGE_ID, key, approval.approvalHash);
  };
  return { root, packageDirectory, installed, build, turnOn, ...first };
};

describe('rules host', () => {
  it('tells the person where the text goes and how much, and adds nothing to any workspace when turned on', async () => {
    const world = await makeWorld([rulesRaw()]);
    const { subject } = await world.registry.describe(PACKAGE_ID, 'rules:style');
    const text = subject.lines.map((line) => `${line.label}: ${line.value}`).join(' | ');
    expect(text).toContain('source/rules/style.md');
    expect(text).toContain('grant no permission');
    expect(text).toContain('only after you attach them to a workspace');
    expect(text).toContain('16 KB');
    expect(subject.files).toEqual(['source/rules/style.md']);

    expect(await world.turnOn('rules:style')).toMatchObject({
      enabled: true,
      status: 'on',
      installed: ['rules:style'],
    });
    expect((await world.rules.list())[0]).toMatchObject({ connectionId: 'style', workspaces: [] });
    expect(await world.rules.contextFor(WORKSPACE)).toBeUndefined();
  });

  it('reaches a workspace only after it is attached, and the attachment survives turning off and on', async () => {
    const world = await makeWorld([rulesRaw()]);
    await world.turnOn('rules:style');
    await world.rules.attach({ packageId: PACKAGE_ID, connectionId: 'style', workspace: WORKSPACE });
    expect((await world.rules.contextFor(WORKSPACE))?.text).toContain('Always write tests first.');

    await world.registry.disable(PACKAGE_ID, 'rules:style');
    expect(await world.rules.contextFor(WORKSPACE)).toBeUndefined();
    await world.turnOn('rules:style');
    expect((await world.rules.contextFor(WORKSPACE))?.text).toContain('Always write tests first.');
  });

  it('follows an updated file without asking again, and keeps the attachment', async () => {
    const world = await makeWorld([rulesRaw()]);
    await world.turnOn('rules:style');
    await world.rules.attach({ packageId: PACKAGE_ID, connectionId: 'style', workspace: WORKSPACE });
    await writeFile(path.join(world.packageDirectory, 'source', 'rules', 'style.md'), 'Always write docs first.');

    const [view] = await world.registry.syncPackage(PACKAGE_ID);
    expect(view?.state).toMatchObject({ enabled: true, status: 'on' });
    expect((await world.rules.contextFor(WORKSPACE))?.text).toContain('Always write docs first.');
  });

  it('is unsupported when the file is missing, empty, too large or outside the source folder', async () => {
    const world = await makeWorld([
      rulesRaw({ id: 'missing', path: 'source/rules/none.md' }),
      rulesRaw({ id: 'empty', path: 'source/rules/empty.md' }),
      rulesRaw({ id: 'huge', path: 'source/rules/huge.md' }),
      rulesRaw({ id: 'adapter-file', path: 'adapter/adapter.json' }),
    ]);
    await writeFile(path.join(world.packageDirectory, 'source', 'rules', 'empty.md'), '  \n');
    await writeFile(
      path.join(world.packageDirectory, 'source', 'rules', 'huge.md'),
      'x'.repeat(MAX_RULES_FILE_BYTES + 1)
    );
    const views = await world.registry.syncPackage(PACKAGE_ID);
    expect(views.map((view) => [view.key, view.state.status])).toEqual([
      ['rules:missing', 'unsupported'],
      ['rules:empty', 'unsupported'],
      ['rules:huge', 'unsupported'],
      ['rules:adapter-file', 'unsupported'],
    ]);
    expect(views.map((view) => view.state.reason)).toEqual([
      expect.stringContaining('missing'),
      expect.stringContaining('empty'),
      expect.stringContaining('larger'),
      expect.stringContaining('source folder'),
    ]);
    await expect(world.turnOn('rules:missing')).rejects.toMatchObject({ code: 'RUNTIME_MISSING' });
  });

  it('forgets the attachments of a package that was uninstalled at the next reconcile, but not those of one that is merely off', async () => {
    const world = await makeWorld([rulesRaw()]);
    await world.turnOn('rules:style');
    await world.rules.attach({ packageId: PACKAGE_ID, connectionId: 'style', workspace: WORKSPACE });
    await world.registry.disable(PACKAGE_ID, 'rules:style');
    await world.registry.reconcile();
    expect(await world.rules.attachedTo(WORKSPACE)).toHaveLength(1);

    world.installed.value = false;
    await world.registry.reconcile();
    expect(await world.rules.attachedTo(WORKSPACE)).toEqual([]);
  });
});

describe('knowledge host', () => {
  it('lists the documents it adds and says it is read-only, writes only paths, and makes them searchable', async () => {
    const world = await makeWorld([knowledgeRaw()]);
    const { subject } = await world.registry.describe(PACKAGE_ID, 'knowledge:docs');
    const text = subject.lines.map((line) => `${line.label}: ${line.value}`).join(' | ');
    expect(text).toContain('source/docs/getting-started.md');
    expect(text).toContain('read-only');
    expect(text).toContain('not copied');

    expect(await world.knowledge.search({ query: 'quickstart' })).toMatchObject({ hits: [] });
    expect(await world.turnOn('knowledge:docs')).toMatchObject({ enabled: true, installed: ['library:docs'] });

    const found = await world.knowledge.search({ query: 'quickstart' });
    expect(found.hits.map((hit) => [hit.packageId, hit.collectionTitle, hit.path, hit.title])).toEqual([
      [PACKAGE_ID, 'Guides', 'source/docs/getting-started.md', 'getting started'],
    ]);
    expect(found.hits[0]?.snippet).toContain('quickstart');
  });

  it('removes the documents when turned off or when the package is removed', async () => {
    const world = await makeWorld([knowledgeRaw()]);
    await world.turnOn('knowledge:docs');
    await world.registry.disable(PACKAGE_ID, 'knowledge:docs');
    expect(await world.knowledge.collections()).toEqual([]);
    await world.registry.disable(PACKAGE_ID, 'knowledge:docs');

    await world.turnOn('knowledge:docs');
    await world.registry.removePackage(PACKAGE_ID);
    expect(await world.knowledge.collections()).toEqual([]);
    expect((await world.knowledge.search({ query: 'widget' })).hits).toEqual([]);
  });

  it('puts the Library back after a restart from what is on, and drops what is not', async () => {
    const world = await makeWorld([
      knowledgeRaw(),
      knowledgeRaw({ id: 'extra', title: 'Extra', paths: ['source/docs/api-reference.md'] }),
    ]);
    await world.turnOn('knowledge:docs');
    await world.turnOn('knowledge:extra');

    const restarted = await world.build();
    await restarted.registry.reconcile();
    expect((await restarted.knowledge.collections()).map((collection) => collection.collectionId).toSorted()).toEqual([
      'docs',
      'extra',
    ]);
    expect((await restarted.knowledge.search({ query: 'widget' })).hits.length).toBeGreaterThan(0);

    await restarted.registry.disable(PACKAGE_ID, 'knowledge:extra');
    // A stale entry a crash left behind: reconcile removes what is no longer kept.
    await restarted.knowledge.replaceCollection(
      { packageId: PACKAGE_ID, collectionId: 'ghost' },
      { title: 'Ghost', documents: [{ path: 'source/docs/ghost.md', title: 'Ghost' }] }
    );
    await restarted.registry.reconcile();
    expect((await restarted.knowledge.collections()).map((collection) => collection.collectionId)).toEqual(['docs']);
  });

  it('is unsupported when none of the documents is in the package or one is outside the source folder', async () => {
    const world = await makeWorld([
      knowledgeRaw({ id: 'none', paths: ['source/docs/none-1.md', 'source/docs/none-2.md'] }),
      knowledgeRaw({ id: 'outside', paths: ['source/docs/getting-started.md', 'adapter/adapter.json'] }),
    ]);
    const views = await world.registry.syncPackage(PACKAGE_ID);
    expect(views.map((view) => view.state.status)).toEqual(['unsupported', 'unsupported']);
    expect(views[0]?.state.reason).toContain('None of the documents');
    expect(views[1]?.state.reason).toContain('source folder');
    expect(await world.knowledge.collections()).toEqual([]);
  });

  it('never reads a path outside the package, even if the index held one', async () => {
    const world = await makeWorld([knowledgeRaw()]);
    await world.turnOn('knowledge:docs');
    await world.knowledge.replaceCollection(
      { packageId: PACKAGE_ID, collectionId: 'docs' },
      { title: 'Guides', documents: [{ path: 'source/docs/../../../outside.md', title: 'Escape' }] }
    );
    // The index refuses the path before anything is read.
    expect((await world.knowledge.collections())[0]?.documents).toEqual([]);
  });
});
