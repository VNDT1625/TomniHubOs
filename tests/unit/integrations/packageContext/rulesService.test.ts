import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAdapterDocument, type AdapterConnection } from '@/common/packages/adapter';
import type { ConnectionRegistry, EnabledConnection } from '@process/integrations/connections/core/registry';
import {
  createRulesService,
  MAX_RULES_BYTES,
  RulesError,
  truncateUtf8,
  workspaceKeyOf,
  type RulesService,
  type RulesServiceOptions,
} from '@process/integrations/packageContext/rulesService';

const PACKAGE_ID = 'com.community.rules';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const WORKSPACE = path.resolve(os.tmpdir(), 'tomny-ws-one');
const OTHER_WORKSPACE = path.resolve(os.tmpdir(), 'tomny-ws-two');

const rulesConnection = (id: string, format = 'agents-md', file = `source/${id}.md`): AdapterConnection => {
  const [connection] = parseAdapterDocument({
    schemaVersion: 1,
    generatedBy: 'classifier',
    connections: [{ kind: 'rules', id, title: `Rules ${id}`, path: file, format }],
  }).connections;
  if (connection?.kind !== 'rules') throw new Error('fixture is not valid');
  return connection;
};

type World = {
  files: Record<string, string | Buffer>;
  on: Set<string>;
  service: RulesService;
  view: ReturnType<typeof vi.fn>;
  file: string;
  build: (extra?: Partial<RulesServiceOptions>) => RulesService;
};

const makeWorld = async (connections: AdapterConnection[]): Promise<World> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-rules-'));
  roots.push(root);
  const files: World['files'] = {};
  const on = new Set<string>(connections.flatMap((connection) => (connection.kind === 'rules' ? [connection.id] : [])));
  const view = vi.fn(async (packageId: string) => {
    if (packageId !== PACKAGE_ID) throw new Error('not installed');
    return connections.map((connection) => ({
      connection,
      key: `rules:${connection.kind === 'rules' ? connection.id : ''}`,
      state: {} as never,
    }));
  });
  const registry: Pick<ConnectionRegistry, 'view' | 'enabledOfKind'> = {
    view: view as unknown as ConnectionRegistry['view'],
    enabledOfKind: async (kind) =>
      kind !== 'rules'
        ? []
        : connections
            .filter((connection) => connection.kind === 'rules' && on.has(connection.id))
            .map(
              (connection): EnabledConnection => ({
                packageId: PACKAGE_ID,
                packageVersion: '1.0.0',
                key: `rules:${connection.kind === 'rules' ? connection.id : ''}`,
                connection,
                context: {
                  packageId: PACKAGE_ID,
                  packageVersion: '1.0.0',
                  packageDirectory: root,
                  readPackageFile: async (relative) => {
                    const content = files[relative];
                    if (content === undefined) throw new Error('missing');
                    return Buffer.from(content);
                  },
                },
              })
            ),
  };
  const file = path.join(root, 'rules-attachments.json');
  const build = (extra: Partial<RulesServiceOptions> = {}): RulesService =>
    createRulesService({ registry, file, ...extra });
  return { files, on, service: build(), view, file, build };
};

describe('rules service: attaching', () => {
  it('lists the rules that are on, attached to nothing, and adds them to no workspace by itself', async () => {
    const world = await makeWorld([rulesConnection('style')]);
    world.files['source/style.md'] = 'Use tabs.';
    expect(await world.service.list()).toEqual([
      { packageId: PACKAGE_ID, connectionId: 'style', title: 'Rules style', format: 'agents-md', workspaces: [] },
    ]);
    expect(await world.service.attachedTo(WORKSPACE)).toEqual([]);
    expect(await world.service.contextFor(WORKSPACE)).toBeUndefined();
  });

  it('adds the rules to the workspace they were attached to, and to no other', async () => {
    const world = await makeWorld([rulesConnection('style')]);
    world.files['source/style.md'] = 'Use tabs.';
    await world.service.attach({ packageId: PACKAGE_ID, connectionId: 'style', workspace: WORKSPACE });

    const context = await world.service.contextFor(WORKSPACE);
    expect(context?.text).toContain('Use tabs.');
    expect(context?.text).toContain('Rules style');
    expect(context?.sources).toEqual([{ packageId: PACKAGE_ID, connectionId: 'style' }]);
    expect(await world.service.contextFor(OTHER_WORKSPACE)).toBeUndefined();
    expect((await world.service.list())[0]?.workspaces).toEqual([WORKSPACE]);

    // Same workspace written another way, attaching twice, and a relative path.
    await world.service.attach({ packageId: PACKAGE_ID, connectionId: 'style', workspace: `${WORKSPACE}${path.sep}` });
    expect(await world.service.attachedTo(WORKSPACE)).toHaveLength(1);
    await expect(
      world.service.attach({ packageId: PACKAGE_ID, connectionId: 'style', workspace: 'relative/dir' })
    ).rejects.toMatchObject({ code: 'INVALID_WORKSPACE' });
    expect(workspaceKeyOf('relative/dir')).toBeUndefined();

    await world.service.detach({ packageId: PACKAGE_ID, connectionId: 'style', workspace: WORKSPACE });
    await world.service.detach({ packageId: PACKAGE_ID, connectionId: 'style', workspace: WORKSPACE });
    expect(await world.service.contextFor(WORKSPACE)).toBeUndefined();
  });

  it('refuses to attach rules that are not turned on, and stops using them when they are turned off', async () => {
    const world = await makeWorld([rulesConnection('style')]);
    world.files['source/style.md'] = 'Use tabs.';
    await expect(
      world.service.attach({ packageId: PACKAGE_ID, connectionId: 'nope', workspace: WORKSPACE })
    ).rejects.toBeInstanceOf(RulesError);
    await expect(
      world.service.attach({ packageId: 'Bad Id', connectionId: 'style', workspace: WORKSPACE })
    ).rejects.toMatchObject({ code: 'NOT_ENABLED' });

    await world.service.attach({ packageId: PACKAGE_ID, connectionId: 'style', workspace: WORKSPACE });
    world.on.delete('style');
    expect(await world.service.contextFor(WORKSPACE)).toBeUndefined();
    // Turned on again (an update turns a data connection off and on): the attachment is still there.
    world.on.add('style');
    expect((await world.service.contextFor(WORKSPACE))?.text).toContain('Use tabs.');
  });

  it('keeps attachments in its file across a restart and reads a damaged file as none', async () => {
    const world = await makeWorld([rulesConnection('style')]);
    world.files['source/style.md'] = 'Use tabs.';
    await world.service.attach({ packageId: PACKAGE_ID, connectionId: 'style', workspace: WORKSPACE });
    const saved = await readFile(world.file, 'utf8');
    expect(saved).toContain('"style"');
    expect(saved).not.toContain('Use tabs.');

    const restarted = world.build();
    expect(await restarted.attachedTo(WORKSPACE)).toEqual([{ packageId: PACKAGE_ID, connectionId: 'style' }]);
    expect((await restarted.contextFor(WORKSPACE))?.text).toContain('Use tabs.');

    const damaged = world.build({
      jsonFile: { read: async () => ({ schemaVersion: 9 }), write: async () => undefined },
    });
    expect(await damaged.attachedTo(WORKSPACE)).toEqual([]);
  });

  it('puts the previous state back when the attachment cannot be saved', async () => {
    const world = await makeWorld([rulesConnection('style')]);
    const failing = world.build({
      jsonFile: { read: async () => undefined, write: async () => Promise.reject(new Error('read-only disk')) },
    });
    await expect(
      failing.attach({ packageId: PACKAGE_ID, connectionId: 'style', workspace: WORKSPACE })
    ).rejects.toThrow('read-only disk');
    expect(await failing.attachedTo(WORKSPACE)).toEqual([]);
  });

  it('forgets attachments of a package or connection that is gone, and keeps the ones that are only off', async () => {
    const world = await makeWorld([rulesConnection('style'), rulesConnection('other')]);
    world.files['source/style.md'] = 'a';
    world.files['source/other.md'] = 'b';
    await world.service.attach({ packageId: PACKAGE_ID, connectionId: 'style', workspace: WORKSPACE });
    await world.service.attach({ packageId: PACKAGE_ID, connectionId: 'other', workspace: WORKSPACE });

    world.on.delete('other');
    await world.service.prune();
    expect(await world.service.attachedTo(WORKSPACE)).toHaveLength(2);

    world.view.mockImplementation(async () => [
      { connection: rulesConnection('style'), key: 'rules:style', state: {} as never },
    ]);
    await world.service.prune();
    expect(await world.service.attachedTo(WORKSPACE)).toEqual([{ packageId: PACKAGE_ID, connectionId: 'style' }]);

    world.view.mockRejectedValue(new Error('not installed'));
    await world.service.prune();
    expect(await world.service.attachedTo(WORKSPACE)).toEqual([]);
  });
});

describe('rules service: what enters the context', () => {
  it('cuts the rules of a workspace to 16 KB in total and says so', async () => {
    const world = await makeWorld([rulesConnection('big'), rulesConnection('second')]);
    world.files['source/big.md'] = `${'long rule line\n'.repeat(3_000)}`;
    world.files['source/second.md'] = 'second rules';
    await world.service.attach({ packageId: PACKAGE_ID, connectionId: 'big', workspace: WORKSPACE });
    await world.service.attach({ packageId: PACKAGE_ID, connectionId: 'second', workspace: WORKSPACE });

    const context = await world.service.contextFor(WORKSPACE);
    expect(context?.truncated).toBe(true);
    expect(context?.text).toContain('[Rules cut:');
    const withoutNote = context?.text.split('\n[Rules cut:')[0] ?? '';
    expect(Buffer.byteLength(withoutNote, 'utf8')).toBeLessThanOrEqual(MAX_RULES_BYTES);

    const small = await makeWorld([rulesConnection('tiny')]);
    small.files['source/tiny.md'] = 'tiny';
    await small.service.attach({ packageId: PACKAGE_ID, connectionId: 'tiny', workspace: WORKSPACE });
    expect((await small.service.contextFor(WORKSPACE))?.truncated).toBe(false);
  });

  it('cuts at a character boundary', () => {
    expect(truncateUtf8('aé', 2)).toBe('a');
    expect(truncateUtf8('ab', 2)).toBe('ab');
    expect(Buffer.byteLength(truncateUtf8('é'.repeat(100), 51), 'utf8')).toBeLessThanOrEqual(51);
  });

  it('passes the text through the outbound inspection: a secret is masked, a blocked text is left out', async () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    const world = await makeWorld([rulesConnection('leaky')]);
    world.files['source/leaky.md'] = `Deploy with key ${secret} please.`;
    await world.service.attach({ packageId: PACKAGE_ID, connectionId: 'leaky', workspace: WORKSPACE });

    const masked = await world.service.contextFor(WORKSPACE);
    expect(masked?.text).toContain('Deploy with key');
    expect(masked?.text).not.toContain(secret);

    const inspect = vi.fn<NonNullable<RulesServiceOptions['inspect']>>(async (request) => ({
      schemaVersion: 1,
      requestId: request.requestId,
      decision: 'block',
      safeParts: [],
      findings: [],
      reasonCode: 'secret_detected',
      requiresUserDecision: false,
      receipt: {} as never,
    }));
    const blocked = world.build({ inspect });
    expect(await blocked.contextFor(WORKSPACE)).toBeUndefined();
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(inspect.mock.calls[0]?.[0]).toMatchObject({ surface: 'file', sensitivity: 'normal' });
    expect(inspect.mock.calls[0]?.[1]).toMatchObject({ allowSanitize: true, requireApprovalForFindings: false });
  });

  it('skips a file that is missing or empty, drops the header of a Cursor rule, and reads nothing for an unknown workspace', async () => {
    const world = await makeWorld([
      rulesConnection('gone'),
      rulesConnection('empty'),
      rulesConnection('cursor', 'cursor-mdc', 'source/cursor.mdc'),
    ]);
    world.files['source/empty.md'] = '   \n';
    world.files['source/cursor.mdc'] = '---\nglobs: "**/*.ts"\nalwaysApply: false\n---\nPrefer const.';
    for (const connectionId of ['gone', 'empty', 'cursor']) {
      // oxlint-disable-next-line no-await-in-loop -- attach in order
      await world.service.attach({ packageId: PACKAGE_ID, connectionId, workspace: WORKSPACE });
    }
    const context = await world.service.contextFor(WORKSPACE);
    expect(context?.sources).toEqual([{ packageId: PACKAGE_ID, connectionId: 'cursor' }]);
    expect(context?.text).toContain('Prefer const.');
    expect(context?.text).not.toContain('alwaysApply');
    expect(await world.service.contextFor('relative')).toBeUndefined();
    expect(await world.service.contextFor('')).toBeUndefined();
  });

  it('stops when the turn is aborted', async () => {
    const world = await makeWorld([rulesConnection('style')]);
    world.files['source/style.md'] = 'Use tabs.';
    await world.service.attach({ packageId: PACKAGE_ID, connectionId: 'style', workspace: WORKSPACE });
    const controller = new AbortController();
    controller.abort();
    expect(await world.service.contextFor(WORKSPACE, controller.signal)).toBeUndefined();
  });
});
