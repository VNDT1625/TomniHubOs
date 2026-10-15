/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Works out how an MCP server repository is started once it is published: a launcher (`npx`, `uvx`) plus a
 * pinned package name. Nothing from the repository is executed or copied; the recipe is only the name and
 * version that the repository's own metadata declares.
 */

import { readFile } from 'node:fs/promises';
import {
  npmLaunchRecipe,
  npmSpeaksMcp,
  pythonLaunchRecipe,
  pythonSpeaksMcp,
  MAX_WORKSPACE_DEPTH,
} from '../../../../common/integrations/detectors/agent/mcpPublished';
import type { McpLaunchRecipe } from '../../../../common/packages';
import type { ScreenedFile } from './fileScreen';
import { RepoPackagingError } from './types';

const MAX_METADATA_BYTES = 256 * 1024;

type Candidate = Readonly<{ recipe: McpLaunchRecipe; source: string; speaksMcp: boolean }>;

const readSmall = async (file: ScreenedFile): Promise<string | undefined> => {
  if (file.size > MAX_METADATA_BYTES) return undefined;
  try {
    return await readFile(file.absolutePath, 'utf8');
  } catch {
    return undefined;
  }
};

/**
 * Finds the launch recipe of the MCP server in a source tree. A root package wins; otherwise a single
 * publishable package in a workspace folder is used. Several candidates are refused, naming them, so the
 * user picks one with `--path`.
 */
export type McpLaunchChoice = Readonly<{
  recipe: McpLaunchRecipe;
  /** Metadata file the recipe came from, relative to the source root. */
  source: string;
  /** Other publishable packages that were left out, so the user can pick one with --path. */
  skipped: readonly string[];
}>;

export const deriveMcpLaunch = async (files: readonly ScreenedFile[]): Promise<McpLaunchChoice | undefined> => {
  const candidates: Candidate[] = [];
  for (const file of files) {
    const base = file.relativePath.split('/').at(-1);
    const depth = file.relativePath.split('/').length - 1;
    if (depth > MAX_WORKSPACE_DEPTH || (base !== 'package.json' && base !== 'pyproject.toml')) continue;
    // oxlint-disable-next-line no-await-in-loop -- a handful of small metadata files.
    const raw = await readSmall(file);
    if (raw === undefined) continue;
    const recipe = base === 'package.json' ? npmLaunchRecipe(raw) : pythonLaunchRecipe(raw);
    if (recipe) {
      const speaksMcp = base === 'package.json' ? npmSpeaksMcp(raw) : pythonSpeaksMcp(raw);
      candidates.push({ recipe, source: file.relativePath, speaksMcp });
    }
  }
  const root = candidates.find((candidate) => !candidate.source.includes('/'));
  const choice = (picked: Candidate): McpLaunchChoice => ({
    recipe: picked.recipe,
    source: picked.source,
    skipped: candidates.filter((candidate) => candidate !== picked).map((candidate) => candidate.source),
  });
  if (root) return choice(root);
  if (candidates.length <= 1) return candidates[0] ? choice(candidates[0]) : undefined;
  // A command line tool next to the server (for example a CLI package) does not depend on the MCP SDK.
  const servers = candidates.filter((candidate) => candidate.speaksMcp);
  if (servers.length === 1) return choice(servers[0]);
  const listed = (servers.length > 1 ? servers : candidates).map((candidate) => candidate.source);
  throw new RepoPackagingError(
    'MCP_AMBIGUOUS',
    `Repository có nhiều package MCP có thể chạy: ${listed.join(', ')}. Chọn một bằng --path <thư-mục>.`,
    { candidates: listed }
  );
};
