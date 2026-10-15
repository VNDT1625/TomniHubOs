import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NativeSkillCatalog } from '@process/resources/nativePlatform/skillCatalog';
import { closeMatches, skillLookupKey } from '@process/resources/skillDocument/nameMatch';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

const skillFile = (name: string, description: string, body: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`;

const catalogWithSkills = async (): Promise<NativeSkillCatalog> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-skill-names-'));
  temporary.push(root);
  const userRoot = path.join(root, 'skills');
  const packageFolder = path.join(userRoot, '.tomny-packages', 'context-mode', 'b'.repeat(32));
  await mkdir(packageFolder, { recursive: true });
  await writeFile(path.join(packageFolder, 'SKILL.md'), skillFile('context-mode', 'Package skill', '# Context Mode'));
  await mkdir(path.join(userRoot, 'pptx'), { recursive: true });
  await writeFile(path.join(userRoot, 'pptx', 'SKILL.md'), skillFile('pptx', 'Slides', '# Slides body'));
  return new NativeSkillCatalog(userRoot, [], path.join(root, 'materialized'));
};

describe('skill lookup names', () => {
  it('normalises the id form and the bare name the same way', () => {
    expect(skillLookupKey('skill:Context-Mode')).toBe('context-mode');
    expect(skillLookupKey('  pptx ')).toBe('pptx');
  });

  it('reads a skill by its bare name and by its skill: id', async () => {
    const catalog = await catalogWithSkills();
    const bare = await catalog.read('context-mode');
    const withId = await catalog.read('skill:context-mode');
    expect(bare.content).toContain('# Context Mode');
    expect(withId.name).toBe('context-mode');
  });

  it('names close candidates when a skill does not resolve', async () => {
    const catalog = await catalogWithSkills();
    await expect(catalog.read('context-mod')).rejects.toThrow('Close names: context-mode');
    await expect(catalog.read('skill:nothing-like-it')).rejects.toThrow('Pass the exact skill name');
  });

  it('suggests nothing for a query with no shared text', () => {
    expect(closeMatches('zzz', ['context-mode', 'pptx'])).toEqual([]);
  });
});
