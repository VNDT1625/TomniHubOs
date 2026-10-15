import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runRepoToPackageChat } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/chatRunner';
import { parseRepoToPackageCommand } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/command';
import {
  progressPercent,
  renderFailure,
  renderProgress,
} from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/report';
import {
  RepoPackagingError,
  type RepoPackagingProgress,
} from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/types';
import { fakeSecrets, withTemp, writeTree } from './helpers';

const PAGE = '<!doctype html><html><body><script src="app.js"></script></body></html>';

describe('the /repotopackage command line', () => {
  it('reads a source and options, keeping quoted text and Windows paths intact', () => {
    expect(parseRepoToPackageCommand('')).toEqual({ source: '' });
    expect(parseRepoToPackageCommand('https://github.com/acme/site --ref v2 --path dist')).toEqual({
      source: 'https://github.com/acme/site',
      ref: 'v2',
      subdirectory: 'dist',
    });
    expect(
      parseRepoToPackageCommand(
        '"C:\\My Projects\\site" --name "My Site" --id com.me.site --version 1.2.3 --publisher com.me'
      )
    ).toEqual({
      source: 'C:\\My Projects\\site',
      name: 'My Site',
      packageId: 'com.me.site',
      version: '1.2.3',
      publisherId: 'com.me',
    });
    expect(parseRepoToPackageCommand('--path dist')).toEqual({ source: '', subdirectory: 'dist' });
  });

  it.each([
    ['an unknown option', 'site --bogus 1'],
    ['a flag with no value', 'site --ref'],
    ['a flag followed by another flag', 'site --ref --path x'],
    ['two sources', 'one two'],
    ['an unclosed quote', '"site'],
  ])('rejects %s', (_label, input) => {
    expect(() => parseRepoToPackageCommand(input)).toThrowError(expect.objectContaining({ code: 'SOURCE_INVALID' }));
  });
});

describe('chat messages', () => {
  it('shows a stage as done only after it finished, and the percentage follows', () => {
    const events: RepoPackagingProgress[] = [
      { stage: 'resolve', status: 'started' },
      { stage: 'resolve', status: 'done' },
      { stage: 'fetch', status: 'started' },
    ];
    const text = renderProgress('site', events);
    expect(text).toContain('- [x] Chuẩn bị khoá ký');
    expect(text).toContain('- [ ] Lấy mã nguồn — đang chạy…');
    expect(text).toContain('- [ ] Ký số Ed25519');
    expect(progressPercent(events)).toBe(11);
    expect(progressPercent([])).toBe(0);
  });

  it('explains a refusal and a refused host in plain terms', () => {
    const outside = renderFailure(
      '../x',
      new RepoPackagingError('SOURCE_OUTSIDE_WORKSPACE', 'Thư mục nằm ngoài workspace hiện tại.')
    );
    expect(outside).toContain('❌');
    expect(outside).toContain('workspace');
    expect(outside).toContain('https://github.com');
    const host = renderFailure(
      'https://evil.example/a/b',
      new RepoPackagingError('SOURCE_HOST_NOT_ALLOWED', 'Máy chủ không được phép.', {
        allowed: ['github.com', 'gitlab.com'],
      })
    );
    expect(host).toContain('github.com, gitlab.com');
    expect(renderFailure('', new Error('boom'))).toContain('Lý do: boom');
  });
});

describe('running the command', () => {
  const environment = (workspaceRoot: string | undefined, parent: string) => ({
    workspaceRoot,
    outputDirectory: path.join(parent, 'out'),
    keyStore: { directory: path.join(parent, 'keys') },
  });

  it('packages a folder in the workspace and reports only what happened', async () => {
    await withTemp(async (parent) => {
      const workspace = path.join(parent, 'workspace');
      await writeTree(workspace, {
        'site/index.html': PAGE,
        'site/app.js': 'x',
        'site/.env': 'A=1',
        'site/src/leak.js': `const k = "${fakeSecrets.awsKey}";`,
        'site/package.json': JSON.stringify({ name: 'chat-site', scripts: { postinstall: 'node x' } }),
      });
      const updates: Array<{ text: string; progress: number; completed: boolean }> = [];
      const final = await runRepoToPackageChat('site', environment(workspace, parent), (update) =>
        updates.push(update)
      );

      expect(final.ok).toBe(true);
      expect(final.completed).toBe(true);
      expect(final.progress).toBe(100);
      expect(updates.at(-1)).toMatchObject({ completed: true });
      const progress = updates.map((update) => update.progress);
      expect(progress).toEqual(progress.toSorted((a, b) => a - b));
      expect(updates.filter((update) => update.completed)).toHaveLength(1);

      expect(final.text).toContain('Đã tạo gói');
      expect(final.text).toContain('com.community.chat-site');
      expect(final.text).toContain('`.env`');
      expect(final.text).toContain('src/leak.js');
      expect(final.text).toContain('postinstall');
      expect(final.text).toContain('vượt qua kiểm tra toàn vẹn và chữ ký');
      expect(final.text).toContain(path.join(parent, 'out'));
      expect(final.text).not.toContain(fakeSecrets.awsKey);
      // Claims the old implementation made without any check behind them.
      for (const claim of ['Guardrail', 'slopsquatting', 'Không có mã độc', 'Passed']) {
        expect(final.text).not.toContain(claim);
      }
      expect(final.text).toContain('không phải quét mã độc');
    });
  });

  it('packages non-runnable source safely and explains it cannot run yet', async () => {
    await withTemp(async (parent) => {
      const workspace = path.join(parent, 'workspace');
      await writeTree(workspace, { 'lib/pyproject.toml': '[project]', 'lib/m/__init__.py': 'x=1' });
      const final = await runRepoToPackageChat('lib', environment(workspace, parent), () => undefined);
      expect(final.ok).toBe(true);
      expect(final.text).toContain('Đã tạo gói');
      expect(final.text).toContain('source-only');
      expect(final.text).toContain('Chỉ lưu mã nguồn');
      expect(final.text).toContain('Không có điểm vào chạy được');
      expect(final.text).not.toContain('❌');
    });
  });

  it('refuses a folder outside the workspace', async () => {
    await withTemp(async (parent) => {
      const workspace = path.join(parent, 'workspace');
      await writeTree(parent, { 'workspace/a.txt': 'x', 'other/index.html': PAGE });
      const final = await runRepoToPackageChat('../other', environment(workspace, parent), () => undefined);
      expect(final.ok).toBe(false);
      expect(final.text).toContain('ngoài workspace');
    });
  });

  it('asks for a workspace when a local folder is requested without one', async () => {
    await withTemp(async (parent) => {
      const final = await runRepoToPackageChat('site', environment(undefined, parent), () => undefined);
      expect(final.ok).toBe(false);
      expect(final.text).toContain('chưa có workspace');
    });
  });

  it('turns a bad command into a message instead of throwing', async () => {
    await withTemp(async (parent) => {
      const final = await runRepoToPackageChat('site --bogus 1', environment(parent, parent), () => undefined);
      expect(final.ok).toBe(false);
      expect(final.text).toContain('Tuỳ chọn không được hỗ trợ');
    });
  });

  it('turns a refused host into a message that lists the allowed hosts', async () => {
    await withTemp(async (parent) => {
      const final = await runRepoToPackageChat(
        'https://evil.example/a/b',
        environment(parent, parent),
        () => undefined
      );
      expect(final.ok).toBe(false);
      expect(final.text).toContain('github.com');
    });
  });

  it('packages the workspace itself when no source is given', async () => {
    await withTemp(async (parent) => {
      const workspace = path.join(parent, 'workspace');
      await writeTree(workspace, { 'index.html': PAGE });
      const final = await runRepoToPackageChat('', environment(workspace, parent), () => undefined);
      expect(final.ok).toBe(true);
      expect(final.text).toContain('Đã loại: không có');
    });
  });
});
