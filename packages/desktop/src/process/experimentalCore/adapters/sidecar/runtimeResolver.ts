/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';

export const TOMNY_RUST_SIDECAR_PATH_ENV = 'TOMNY_RUST_SIDECAR_PATH';
export const TOMNY_RUST_SIDECAR_ENABLED_ENV = 'TOMNY_RUST_SIDECAR_ENABLED';
export const TOMNY_RUST_SIDECAR_FALLBACK_ENV = 'TOMNY_RUST_SIDECAR_FALLBACK';

export type RustSidecarFallbackMode = 'typescript' | 'disabled';

export type ResolvedRustSidecar = {
  command: string;
  source: 'environment' | 'bundled';
};

export type RustSidecarResolverOptions = {
  resourcesPath?: string;
  developmentRoot?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  accessFile?: (filePath: string, mode?: number) => Promise<void>;
};

const binaryName = (platform: NodeJS.Platform): string =>
  platform === 'win32' ? 'tomny-runtime.exe' : 'tomny-runtime';

export const rustSidecarFallbackMode = (env: NodeJS.ProcessEnv = process.env): RustSidecarFallbackMode =>
  env[TOMNY_RUST_SIDECAR_FALLBACK_ENV]?.trim().toLowerCase() === 'disabled' ? 'disabled' : 'typescript';

export const isRustSidecarEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  !['0', 'false', 'off'].includes(env[TOMNY_RUST_SIDECAR_ENABLED_ENV]?.trim().toLowerCase() ?? '');

/** Resolve only an explicit override or a packaged runtime; never search PATH or invoke a shell. */
export const resolveRustSidecarExecutable = async (
  options: RustSidecarResolverOptions = {}
): Promise<ResolvedRustSidecar | null> => {
  const env = options.env ?? process.env;
  if (!isRustSidecarEnabled(env)) return null;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const runtimeKey = `${platform}-${arch}`;
  const accessFile = options.accessFile ?? access;
  const mode = platform === 'win32' ? constants.F_OK : constants.X_OK;
  const isAccessible = async (candidate: ResolvedRustSidecar): Promise<ResolvedRustSidecar | null> => {
    try {
      await accessFile(candidate.command, mode);
      return candidate;
    } catch {
      return null;
    }
  };
  const override = env[TOMNY_RUST_SIDECAR_PATH_ENV]?.trim();
  if (override) {
    return isAccessible({
      command: path.isAbsolute(override) ? path.normalize(override) : path.resolve(override),
      source: 'environment',
    });
  }

  const candidates: ResolvedRustSidecar[] = [];
  if (options.resourcesPath) {
    candidates.push({
      command: path.join(options.resourcesPath, 'bundled-tomny-runtime', runtimeKey, binaryName(platform)),
      source: 'bundled',
    });
  }
  if (options.developmentRoot) {
    candidates.push({
      command: path.join(
        options.developmentRoot,
        'resources',
        'bundled-tomny-runtime',
        runtimeKey,
        binaryName(platform)
      ),
      source: 'bundled',
    });
  }
  const resolved = await Promise.all(candidates.map(isAccessible));
  return resolved.find((candidate): candidate is ResolvedRustSidecar => candidate !== null) ?? null;
};
