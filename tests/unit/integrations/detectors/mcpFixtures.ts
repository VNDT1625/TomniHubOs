/**
 * Helpers of the MCP detector tests: an inventory from inline files, and one from a hand-written fixture folder
 * under tests/fixtures/repotopackage/.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInventory } from '@/common/integrations/detectors/inventory';
import type { RepoInventory } from '@/common/integrations/detectors/types';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/repotopackage/', import.meta.url));

/** Inventory of inline files; `extraFiles` are listed but have no text (a path the detectors must not read). */
export const inventoryOf = (
  texts: Readonly<Record<string, string>>,
  extraFiles: readonly string[] = [],
  readText: (path: string) => string | undefined = (path) => texts[path]
): RepoInventory => createInventory({ files: [...Object.keys(texts), ...extraFiles], readText });

const walk = (root: string, folder = ''): string[] =>
  readdirSync(join(root, folder)).flatMap((entry) => {
    const relative = folder === '' ? entry : `${folder}/${entry}`;
    return statSync(join(root, relative)).isDirectory() ? walk(root, relative) : [relative];
  });

/**
 * Loads a fixture folder as the packager would hand it to the detectors. `onRead` sees every path whose text was
 * requested, so a test can prove that a file outside the declaration list was never opened.
 */
export const fixtureInventory = (
  name: string,
  extraFiles: readonly string[] = [],
  onRead: (path: string) => void = () => undefined
): RepoInventory => {
  const root = join(FIXTURES, name);
  return createInventory({
    files: [...walk(root), ...extraFiles],
    readText: (path) => {
      onRead(path);
      try {
        return readFileSync(join(root, path), 'utf8');
      } catch {
        return undefined;
      }
    },
  });
};
