/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Writes a generated userscript extension to a staging folder so the normal extension path can use it as `sourceRoot`
 * (`prepareWorkingCopy` copies it, adds the `key` and verifies the manifest). The only file-system code of the
 * userscript converter; the converter itself stays pure.
 *
 * The folder must be new and owned by the caller. Every path is checked to stay inside it, and a file is created with
 * the exclusive flag so nothing is ever written through an existing file or link.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GeneratedFile } from '@process/integrations/browserExtensions/userscript/types';

const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export class StageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StageError';
  }
}

export const stageGeneratedExtension = async (files: readonly GeneratedFile[], directory: string): Promise<void> => {
  const root = path.resolve(directory);
  for (const file of files) {
    if (!SAFE_PATH.test(file.path)) throw new StageError(`Đường dẫn tệp sinh ra không hợp lệ: ${file.path}`);
  }
  const made = new Set<string>();
  for (const file of files) {
    const destination = path.join(root, ...file.path.split('/'));
    const folder = path.dirname(destination);
    if (!made.has(folder)) {
      // oxlint-disable-next-line no-await-in-loop -- folders are created in order
      await mkdir(folder, { recursive: true });
      made.add(folder);
    }
    try {
      // oxlint-disable-next-line no-await-in-loop -- one file at a time bounds open handles
      await writeFile(destination, file.content, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      throw new StageError(`Không ghi được tệp ${file.path}: ${(error as Error).message}`, { cause: error });
    }
  }
};
