import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SKILL_DOCUMENT_MAX_BYTES, SKILL_DOCUMENT_CHANNEL } from '@/common/skills/skillDocument';
import { NativeSkillCatalog } from '@process/resources/nativePlatform/skillCatalog';
import { registerSkillDocumentBridge } from '@process/resources/skillDocument/skillDocumentBridge';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

const skillFile = (name: string, description: string, body: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`;

/** user root holds one standalone skill, one package skill, an oversized skill and a link that leaves its folder. */
const fixture = async (): Promise<{ catalog: NativeSkillCatalog; outside: string; linked: boolean }> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-skill-doc-'));
  temporary.push(root);
  const userRoot = path.join(root, 'skills');
  const packageFolder = path.join(userRoot, '.tomny-packages', 'context-mode', 'abc');
  await mkdir(packageFolder, { recursive: true });
  await writeFile(path.join(packageFolder, 'SKILL.md'), skillFile('ctx-skill', 'Package skill', '# Package body'));
  await mkdir(path.join(userRoot, 'mine'), { recursive: true });
  await writeFile(path.join(userRoot, 'mine', 'SKILL.md'), skillFile('my-skill', 'Standalone skill', '# Mine'));
  await mkdir(path.join(userRoot, 'big'), { recursive: true });
  await writeFile(
    path.join(userRoot, 'big', 'SKILL.md'),
    skillFile('big-skill', 'Too large', 'x'.repeat(SKILL_DOCUMENT_MAX_BYTES + 1))
  );
  const outside = path.join(root, 'outside-secret.md');
  await writeFile(outside, 'TOP SECRET');
  await mkdir(path.join(userRoot, 'escape'), { recursive: true });
  let linked = true;
  try {
    await symlink(outside, path.join(userRoot, 'escape', 'SKILL.md'));
  } catch {
    // Symlinks may need elevated rights on Windows; the escape assertions are skipped then.
    linked = false;
  }
  const catalog = new NativeSkillCatalog(userRoot, [], path.join(root, 'materialized'));
  return { catalog, outside, linked };
};

describe('skill catalog readDocument', () => {
  it('returns a package skill with its owner and the full SKILL.md', async () => {
    const { catalog } = await fixture();
    const doc = await catalog.readDocument('ctx-skill', 'context-mode');
    expect(doc.name).toBe('ctx-skill');
    expect(doc.description).toBe('Package skill');
    expect(doc.packageId).toBe('context-mode');
    expect(doc.content).toContain('# Package body');
  });

  it('returns a standalone skill without a package owner', async () => {
    const { catalog } = await fixture();
    const doc = await catalog.readDocument('my-skill');
    expect(doc.packageId).toBeUndefined();
    expect(doc.content).toContain('# Mine');
  });

  it('does not resolve a skill under another package id', async () => {
    const { catalog } = await fixture();
    await expect(catalog.readDocument('ctx-skill', 'other-package')).rejects.toThrow('NOT_FOUND');
    await expect(catalog.readDocument('my-skill', 'context-mode')).rejects.toThrow('NOT_FOUND');
  });

  it('refuses names that are not catalog entries, including path-like names', async () => {
    const { catalog } = await fixture();
    await expect(catalog.readDocument('../../outside-secret.md')).rejects.toThrow('NOT_FOUND');
    await expect(catalog.readDocument('')).rejects.toThrow('NOT_FOUND');
    await expect(catalog.readDocument('missing-skill')).rejects.toThrow('NOT_FOUND');
  });

  it('refuses a SKILL.md larger than the cap', async () => {
    const { catalog } = await fixture();
    await expect(catalog.readDocument('big-skill')).rejects.toThrow('TOO_LARGE');
  });

  it('never reads a SKILL.md that links outside its skill folder', async () => {
    const { catalog, linked } = await fixture();
    if (!linked) return;
    // The linked folder is listed by name but its SKILL.md resolves outside the skill folder, so it is refused.
    await expect(catalog.readDocument('escape')).rejects.toThrow('NOT_FOUND');
    expect((await catalog.list()).map((skill) => skill.name)).not.toContain('escape');
  });
});

describe('skill document IPC bridge', () => {
  const setup = async (verify: boolean) => {
    const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (event: unknown, raw: unknown) => Promise<unknown>) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn(),
    };
    const readDocument = vi.fn(async (name: string, packageId?: string) => ({
      name,
      description: 'd',
      packageId,
      content: 'body',
    }));
    const verifySender = vi.fn(() => verify);
    const dispose = registerSkillDocumentBridge({
      ipcMain: ipcMain as never,
      verifySender: verifySender as never,
      skills: { readDocument },
    });
    const handler = handlers.get(SKILL_DOCUMENT_CHANNEL);
    if (!handler) throw new Error('handler not registered');
    return { handler, readDocument, dispose, ipcMain };
  };

  it('returns the document for a valid request from the trusted frame', async () => {
    const { handler, readDocument } = await setup(true);
    const result = await handler({}, { name: 'ctx-skill', packageId: 'context-mode' });
    expect(result).toEqual({
      ok: true,
      data: { name: 'ctx-skill', description: 'd', packageId: 'context-mode', content: 'body' },
    });
    expect(readDocument).toHaveBeenCalledWith('ctx-skill', 'context-mode');
  });

  it('denies every request from an untrusted sender without reading', async () => {
    const { handler, readDocument } = await setup(false);
    expect(await handler({}, { name: 'ctx-skill' })).toEqual({ ok: false, code: 'DENIED' });
    expect(readDocument).not.toHaveBeenCalled();
  });

  it('rejects payloads with extra keys or a path-shaped package id', async () => {
    const { handler, readDocument } = await setup(true);
    expect(await handler({}, { name: 'ctx-skill', path: '/etc/passwd' })).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    expect(await handler({}, { name: 'ctx-skill', packageId: '../escape' })).toEqual({
      ok: false,
      code: 'INVALID_REQUEST',
    });
    expect(await handler({}, 'not-an-object')).toEqual({ ok: false, code: 'INVALID_REQUEST' });
    expect(readDocument).not.toHaveBeenCalled();
  });

  it('maps catalog codes and hides unknown internal errors', async () => {
    const ipcMain = { handle: vi.fn(), removeHandler: vi.fn() };
    let handler: ((event: unknown, raw: unknown) => Promise<unknown>) | undefined;
    ipcMain.handle.mockImplementation((_channel: string, next: (event: unknown, raw: unknown) => Promise<unknown>) => {
      handler = next;
    });
    const skills = {
      readDocument: vi
        .fn<(name: string) => Promise<never>>()
        .mockRejectedValueOnce(new Error('NOT_FOUND'))
        .mockRejectedValueOnce(new Error('EACCES: /secret/path leaked')),
    };
    registerSkillDocumentBridge({ ipcMain: ipcMain as never, verifySender: () => true, skills });
    expect(await handler?.({}, { name: 'a' })).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await handler?.({}, { name: 'b' })).toEqual({ ok: false, code: 'UNREADABLE' });
  });

  it('removes the handler when disposed', async () => {
    const { dispose, ipcMain } = await setup(true);
    dispose();
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(SKILL_DOCUMENT_CHANNEL);
  });
});
