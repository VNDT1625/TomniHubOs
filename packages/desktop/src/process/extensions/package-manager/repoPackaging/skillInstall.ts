/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unpacks the skill folders of a `.tomny` package into a temporary directory so the skill catalog can import
 * them. A skill is a folder of instructions and templates; nothing in it is executed here.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { PACKAGE_MANIFEST_FILE } from '../artifactSecurity';
import { isSafeEntryPath } from './fileScreen';

export type ExtractedSkills = Readonly<{
  /** One directory per skill, each holding its SKILL.md at the top. */
  directories: readonly string[];
  /** Removes the temporary directory. Call it once the skills are imported. */
  cleanup: () => Promise<void>;
}>;

/**
 * Puts the outermost skill folders first. A repository often ships the same skill once per host plugin
 * (`skills/x` and `plugins/cursor/x/skills/x`); importing in this order lets the installer keep the first
 * copy of each name.
 */
export const orderSkillRoots = (roots: readonly string[]): string[] =>
  roots.toSorted(
    (left, right) => left.split('/').length - right.split('/').length || (left < right ? -1 : left > right ? 1 : 0)
  );

const folderName = (root: string): string => {
  const name = path.posix.basename(root).replace(/[^a-zA-Z0-9._-]+/g, '-');
  return name === '' || name === '.' ? 'skill' : name;
};

/**
 * @param skillRoots Folders inside the package that hold a SKILL.md; an empty string means the package root.
 */
export const extractSkillsFromPackage = async (
  artifactPath: string,
  skillRoots: readonly string[]
): Promise<ExtractedSkills> => {
  const zip = await JSZip.loadAsync(await readFile(artifactPath));
  const temporary = await mkdtemp(path.join(tmpdir(), 'tomny-skill-'));
  const cleanup = (): Promise<void> => rm(temporary, { recursive: true, force: true });
  try {
    const directories: string[] = [];
    for (const [index, root] of skillRoots.entries()) {
      const prefix = root === '' ? '' : `${root}/`;
      const target = path.join(temporary, String(index), folderName(root));
      let wrote = false;
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || entry.name === PACKAGE_MANIFEST_FILE || !entry.name.startsWith(prefix)) continue;
        const relative = entry.name.slice(prefix.length);
        if (!isSafeEntryPath(relative)) continue;
        const destination = path.join(target, ...relative.split('/'));
        // oxlint-disable-next-line no-await-in-loop -- entries are written one at a time to bound memory.
        await mkdir(path.dirname(destination), { recursive: true });
        // oxlint-disable-next-line no-await-in-loop -- same.
        await writeFile(destination, await entry.async('uint8array'));
        wrote = true;
      }
      if (wrote) directories.push(target);
    }
    return { directories, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
};
