import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../../../../packages/desktop/src/process/integrations/browserExtensions');
const PRELOAD_FILES = ['bridge', 'bootFrame', 'bootWorker', 'frame', 'serviceWorker'].map((name) =>
  path.join(ROOT, 'preload', `${name}.ts`)
);
const CONTRACT = path.join(ROOT, 'api', 'contract.ts');

const specifiers = async (file: string): Promise<string[]> => {
  const source = await readFile(file, 'utf8');
  return [...source.matchAll(/^(?:import|export)\s[^;]*?from\s+'([^']+)'/gm)].map((match) => match[1] ?? '');
};

const ALLOWED = /^(electron|@\/process\/integrations\/browserExtensions\/(api\/contract|preload\/[A-Za-z]+))$/;

describe('the preload bundles stay standalone', () => {
  it.each(PRELOAD_FILES.map((file) => [path.basename(file), file] as const))(
    '%s imports only electron, the wire contract and its siblings',
    async (_name, file) => {
      const found = await specifiers(file);
      expect(found.filter((specifier) => !ALLOWED.test(specifier))).toEqual([]);
    }
  );

  it('declares an explicit catch callback result in the service-worker entry', async () => {
    const source = await readFile(path.join(ROOT, 'preload', 'serviceWorker.ts'), 'utf8');
    expect(source).toContain('catch((): undefined => undefined)');
  });

  it('keeps the wire contract free of imports, since both Main and the preloads load it', async () => {
    expect(await specifiers(CONTRACT)).toEqual([]);
  });

  it('keeps the path alias that the preload build resolves, never @process', async () => {
    const all = (await Promise.all(PRELOAD_FILES.map(specifiers))).flat();
    expect(all.some((specifier) => specifier.startsWith('@process/'))).toBe(false);
  });
});
