/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { RepoProcessError } from './repoProcessPorts';

/**
 * Resolves a service working folder and proves it lies inside the package directory. Same rules as the connection
 * registry's file reader: no backslash, drive, absolute path, `..` or empty part, and the real path (after symlinks
 * and junctions) must stay below the real package directory.
 */
export const resolveCwdInsidePackage = async (
  packageDirectory: string,
  relativePath: string,
  serviceId: string
): Promise<string> => {
  const forbidden = (why: string): RepoProcessError =>
    new RepoProcessError('CWD_FORBIDDEN', `Working folder is not allowed (${why}): ${relativePath}`, serviceId);
  if (
    relativePath === '' ||
    relativePath.includes('\\') ||
    path.isAbsolute(relativePath) ||
    /^[A-Za-z]:/u.test(relativePath) ||
    relativePath.split('/').some((part) => part === '..' || part === '' || part === '.')
  ) {
    throw forbidden('unsafe path');
  }
  let resolvedRoot: string;
  let real: string;
  try {
    resolvedRoot = await realpath(packageDirectory);
    real = await realpath(path.resolve(resolvedRoot, relativePath));
  } catch {
    throw forbidden('missing');
  }
  const inside = path.relative(resolvedRoot, real);
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) throw forbidden('leaves the package');
  if (!(await stat(real)).isDirectory()) throw forbidden('not a folder');
  return real;
};
