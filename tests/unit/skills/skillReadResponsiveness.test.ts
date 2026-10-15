import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NativeSkillCatalog } from '@process/resources/nativePlatform/skillCatalog';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

const skillFile = (name: string, description: string, body: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`;

/** A package-shaped skill folder with 586 files, several nested skills and one large SKILL.md (under the read cap). */
const bigPackageFixture = async (): Promise<{ catalog: NativeSkillCatalog; userRoot: string }> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-skill-responsive-'));
  temporary.push(root);
  const userRoot = path.join(root, 'skills');
  const packageFolder = path.join(userRoot, '.tomny-packages', 'context-mode', 'a'.repeat(32));
  await mkdir(packageFolder, { recursive: true });
  const body = `# Context Mode\n\n${'Use the sandbox tools for large output. '.repeat(2400)}`;
  await writeFile(
    path.join(packageFolder, 'SKILL.md'),
    skillFile('context-mode', 'Keep large output out of context', body)
  );
  const src = path.join(packageFolder, 'src');
  await mkdir(src, { recursive: true });
  const nested = Array.from({ length: 5 }, (_, index) => path.join(packageFolder, 'skills', `sub-${index}`));
  await Promise.all(
    nested.map(async (folder, index) => {
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, 'SKILL.md'), skillFile(`context-sub-${index}`, `Sub skill ${index}`, '# Sub'));
    })
  );
  await Promise.all(
    Array.from({ length: 580 }, (_, index) =>
      writeFile(path.join(src, `module-${index}.ts`), `export const value${index} = ${index};\n`.repeat(40))
    )
  );
  const catalog = new NativeSkillCatalog(userRoot, [], path.join(root, 'materialized'));
  return { catalog, userRoot };
};

describe('skill read responsiveness on a big installed package', () => {
  it('returns a package skill and keeps the event loop responsive', async () => {
    const { catalog } = await bigPackageFixture();
    const delay = monitorEventLoopDelay({ resolution: 5 });
    delay.enable();
    const started = performance.now();
    const resource = await catalog.read('context-mode', 'SKILL.md');
    const elapsedMs = performance.now() - started;
    delay.disable();
    const maxLoopBlockMs = delay.max / 1e6;
    console.info(`[skill-read] elapsed=${elapsedMs.toFixed(0)}ms maxLoopBlock=${maxLoopBlockMs.toFixed(0)}ms`);
    expect(resource.content).toContain('# Context Mode');
    expect(elapsedMs).toBeLessThan(10_000);
    expect(maxLoopBlockMs).toBeLessThan(1_000);
  });
});
