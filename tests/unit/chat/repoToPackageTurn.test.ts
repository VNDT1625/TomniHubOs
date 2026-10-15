import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitted = vi.hoisted(() => ({
  stream: [] as unknown[],
  completed: [] as unknown[],
  packageState: [] as unknown[],
}));
const runner = vi.hoisted(() => ({ run: vi.fn(), register: vi.fn(), install: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      responseStream: { emit: (event: unknown) => emitted.stream.push(event) },
      turnCompleted: { emit: (event: unknown) => emitted.completed.push(event) },
    },
    packagePlatform: {
      stateChanged: { emit: (event: unknown) => emitted.packageState.push(event) },
    },
  },
}));
vi.mock('@process/extensions/package-manager/repoPackaging', () => ({ runRepoToPackageChat: runner.run }));
vi.mock('@process/resources/mcpRegistry/mcpRegistryBridge', () => ({ getMcpRegistry: () => ({}) }));
vi.mock('@process/extensions/package-manager/packageBridge', () => ({ installLocalBuiltPackage: runner.install }));
vi.mock('../../../packages/desktop/src/process/services/database/nativeConversation/repoToPackageEnvironment', () => ({
  createRepoToPackageEnvironment: (workspaceRoot: string | undefined) => ({ workspaceRoot }),
}));

import {
  parseRepoToPackageSlash,
  startRepoToPackageTurn,
} from '../../../packages/desktop/src/process/services/database/nativeConversation/repoPackagingTurn';

/** Waits for the whole turn, including the dynamic import of the package bridge. */
const settled = (): Promise<void> => vi.waitFor(() => expect(emitted.completed).toHaveLength(1));

const flush = async (): Promise<void> => {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
};

describe('recognising the /repotopackage command', () => {
  it.each([
    ['/repotopackage https://github.com/upstash/context7', 'https://github.com/upstash/context7'],
    ['  /RepoToPackage  site --path dist ', 'site --path dist'],
    ['/repotopackage', '.'],
    ['/repotopackage   ', '.'],
  ])('reads %j as a command with target %j', (input, target) => {
    expect(parseRepoToPackageSlash(input)).toBe(target);
  });

  it.each([
    ['plain text', 'hello'],
    ['another command', '/goal ship it'],
    ['a longer command name', '/repotopackages x'],
    ['the command in the middle of a sentence', 'please run /repotopackage x'],
  ])('leaves %s to the normal chat', (_label, input) => {
    expect(parseRepoToPackageSlash(input)).toBeUndefined();
  });
});

describe('running /repotopackage as a turn with no model', () => {
  beforeEach(() => {
    emitted.stream.length = 0;
    emitted.completed.length = 0;
    emitted.packageState.length = 0;
    runner.run.mockReset();
    runner.register.mockReset();
    runner.install.mockReset();
  });

  const repository = (workspace?: string) => ({
    saveMessage: vi.fn().mockResolvedValue(undefined),
    getConversation: vi.fn().mockResolvedValue({ extra: workspace ? { workspace } : {} }),
  });

  it('saves the user message, streams the real progress, saves the result and releases the chat', async () => {
    runner.run.mockImplementation(
      async (_target: string, _environment: unknown, onUpdate: (update: unknown) => void) => {
        onUpdate({ text: 'step 1', progress: 11, completed: false });
        return { ok: true, text: 'done', progress: 100, completed: true };
      }
    );
    const repo = repository('C:/work');
    const started = await startRepoToPackageTurn({
      repository: repo as never,
      conversationId: 'c1',
      input: '/repotopackage site',
      target: 'site',
    });
    expect(started.msg_id).toMatch(/^msg_direct_/u);
    await flush();

    expect(repo.saveMessage.mock.calls[0][0]).toMatchObject({
      position: 'right',
      conversation_id: 'c1',
      content: { content: '/repotopackage site' },
    });
    expect(runner.run).toHaveBeenCalledWith('site', { workspaceRoot: 'C:/work' }, expect.any(Function));
    const frames = emitted.stream as Array<{ data: { content: string; progress: number } }>;
    expect(frames[0].data.progress).toBe(0);
    expect(frames.map((frame) => frame.data.content)).toContain('step 1');
    expect(repo.saveMessage.mock.calls[1][0]).toMatchObject({ position: 'left', content: { content: 'done' } });
    expect(emitted.completed).toHaveLength(1);
    expect(emitted.completed[0]).toMatchObject({ state: 'stopped', can_send_message: true, session_id: 'c1' });
    // The chat page leaves its processing state only on a stream finish frame.
    const finishes = (emitted.stream as Array<{ type: string; conversation_id: string }>).filter(
      (event) => event.type === 'finish'
    );
    expect(finishes).toEqual([expect.objectContaining({ conversation_id: 'c1', data: { state: 'stopped' } })]);
    expect((emitted.stream.at(-1) as { type: string }).type).toBe('finish');
  });

  it('does not write a separate MCP catalog entry: the package MCP server is only its connection', async () => {
    const server = { id: 'context7', title: 'Context7', command: 'npx', args: ['-y', 'x@1.0.0'] };
    runner.run.mockResolvedValue({
      ok: true,
      text: 'done',
      progress: 100,
      completed: true,
      mcpServers: [server],
      artifactPath: 'C:/out/p.tomny',
    });
    runner.install.mockResolvedValue({
      packageId: 'com.community.demo',
      version: '1.0.0',
      connections: [{ key: 'mcp:context7', status: 'off' }],
      activation: { enabled: [{ key: 'mcp:context7', kind: 'mcp', autoStart: false }], stayedOff: [] },
    });
    const repo = repository();
    await startRepoToPackageTurn({
      repository: repo as never,
      conversationId: 'c4',
      input: '/repotopackage x',
      target: 'x',
    });
    await settled();
    expect(runner.register).not.toHaveBeenCalled();
    const saved = repo.saveMessage.mock.calls[1][0] as { content: { content: string } };
    expect(saved.content.content).not.toContain('đang tắt');
    expect(saved.content.content).toContain('Đã bật 1 kết nối');
    expect(saved.content.content).toContain('`mcp:context7`');
  });

  it('says per kind what the install turned on and what stayed off, with the reason (cancelled approval)', async () => {
    runner.run.mockResolvedValue({
      ok: true,
      text: 'done',
      progress: 100,
      completed: true,
      artifactPath: 'C:/out/p.tomny',
    });
    runner.install.mockResolvedValue({
      packageId: 'com.community.demo',
      version: '1.0.0',
      connections: [
        { key: 'mcp:context7', status: 'off' },
        { key: 'skill:source/skills/a', status: 'off' },
      ],
      activation: {
        enabled: [{ key: 'skill:source/skills/a', kind: 'skill', autoStart: false }],
        stayedOff: [
          { key: 'mcp:context7', reason: 'Bạn chưa duyệt, kết nối vẫn tắt. Có thể bật từng cái trong chi tiết gói.' },
        ],
      },
    });
    const repo = repository();
    await startRepoToPackageTurn({
      repository: repo as never,
      conversationId: 'c6',
      input: '/repotopackage x',
      target: 'x',
    });
    await settled();
    const saved = repo.saveMessage.mock.calls[1][0] as { content: { content: string } };
    expect(saved.content.content).toContain('Đã bật 1 kết nối');
    expect(saved.content.content).toContain('Còn tắt 1 kết nối');
    expect(saved.content.content).toContain('MCP (1): `mcp:context7` — Bạn chưa duyệt, kết nối vẫn tắt.');
    expect(saved.content.content).not.toContain('Cài đặt → MCP (đang tắt)');
  });

  it('installs the built package as local-built and reports it in the chat text', async () => {
    runner.run.mockResolvedValue({
      ok: true,
      text: 'done',
      progress: 100,
      completed: true,
      artifactPath: 'C:/out/p.tomny',
    });
    runner.install.mockResolvedValue({
      packageId: 'com.community.demo',
      version: '1.0.0',
      connections: [
        { key: 'skill:source/skills/a', status: 'off' },
        { key: 'cli:tool', status: 'unsupported', reason: 'no host' },
      ],
    });
    const repo = repository();
    await startRepoToPackageTurn({
      repository: repo as never,
      conversationId: 'c6',
      input: '/repotopackage x',
      target: 'x',
    });
    await settled();
    expect(runner.install).toHaveBeenCalledWith('C:/out/p.tomny', { activateConnections: true });
    // Open pages re-read their lists once the connections are on.
    expect(emitted.packageState).toEqual([{ id: 'com.community.demo', state: 'installed' }]);
    const saved = repo.saveMessage.mock.calls[1][0] as { content: { content: string } };
    expect(saved.content.content).toContain('com.community.demo');
    expect(saved.content.content).toContain('Tạo trên máy này');
    expect(saved.content.content).toContain('Chưa bật kết nối nào.');
    expect(saved.content.content).toContain('Còn tắt 2 kết nối');
    expect(saved.content.content).toContain('no host');
    expect(emitted.completed[0]).toMatchObject({ state: 'stopped' });
  });

  it('does not install anything when packaging gave no archive', async () => {
    runner.run.mockResolvedValue({ ok: true, text: 'done', progress: 100, completed: true });
    await startRepoToPackageTurn({
      repository: repository() as never,
      conversationId: 'c7',
      input: '/repotopackage x',
      target: 'x',
    });
    await settled();
    expect(runner.install).not.toHaveBeenCalled();
  });

  it('keeps the package result and writes no MCP entry when the local install fails', async () => {
    const server = { id: 'context7', title: 'Context7', command: 'npx', args: ['-y', 'x@1.0.0'] };
    runner.run.mockResolvedValue({
      ok: true,
      text: 'done',
      progress: 100,
      completed: true,
      mcpServers: [server],
      artifactPath: 'C:/out/p.tomny',
    });
    runner.install.mockRejectedValue(new Error('signature mismatch'));
    const repo = repository();
    await startRepoToPackageTurn({
      repository: repo as never,
      conversationId: 'c8',
      input: '/repotopackage x',
      target: 'x',
    });
    await settled();
    expect(runner.register).not.toHaveBeenCalled();
    const saved = repo.saveMessage.mock.calls[1][0] as { content: { content: string } };
    expect(saved.content.content).toContain('done');
    expect(saved.content.content).toContain('signature mismatch');
    expect(saved.content.content).not.toContain('Cài đặt → MCP');
    expect(emitted.completed[0]).toMatchObject({ state: 'stopped', can_send_message: true });
  });

  it('reports a failed packaging as an error turn, and still releases the chat', async () => {
    runner.run.mockResolvedValue({ ok: false, text: 'no', progress: 100, completed: true });
    await startRepoToPackageTurn({
      repository: repository() as never,
      conversationId: 'c2',
      input: '/repotopackage x',
      target: 'x',
    });
    await flush();
    expect(emitted.completed[0]).toMatchObject({ state: 'error', can_send_message: true });
    expect((emitted.stream.at(-1) as { type: string; data: unknown }).type).toBe('finish');
  });

  it('releases the chat even when saving the result fails', async () => {
    runner.run.mockResolvedValue({ ok: true, text: 'done', progress: 100, completed: true });
    const repo = repository();
    repo.saveMessage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disk full'));
    await startRepoToPackageTurn({
      repository: repo as never,
      conversationId: 'c3',
      input: '/repotopackage x',
      target: 'x',
    });
    await flush();
    expect(emitted.completed[0]).toMatchObject({ state: 'error', detail: 'disk full', can_send_message: true });
  });

  it('keeps what the run produced so far under the same id, so a reload still shows it', async () => {
    let finish: (value: unknown) => void = () => undefined;
    runner.run.mockImplementation(
      async (_target: string, _environment: unknown, onUpdate: (update: unknown) => void) => {
        onUpdate({ text: 'clone ok', progress: 20, completed: false });
        onUpdate({ text: 'classify ok', progress: 40, completed: false });
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
    );
    const repo = repository();
    await startRepoToPackageTurn({
      repository: repo as never,
      conversationId: 'c7',
      input: '/repotopackage x',
      target: 'x',
    });
    const runningSaves = () =>
      repo.saveMessage.mock.calls
        .map(([message]) => message as { id: string; content: { content: string; repoRun?: string } })
        .filter((message) => message.content.repoRun === 'running');
    // Saves are coalesced to about one a second while the run is going.
    await vi.waitFor(() => expect(runningSaves().length).toBeGreaterThan(0), { timeout: 3000 });
    const running = runningSaves().at(-1);
    expect(running?.content.content).toContain('classify ok');
    expect(running?.id).toMatch(/^msg_direct_/u);

    finish({ ok: false, text: 'stopped', progress: 40, completed: true });
    await settled();
    const last = repo.saveMessage.mock.calls.at(-1)?.[0] as {
      id: string;
      content: { content: string; repoRun?: string };
    };
    expect(last.id).toBe(running?.id);
    expect(last.content).toMatchObject({ content: 'stopped', repoRun: 'done' });
  });
});
