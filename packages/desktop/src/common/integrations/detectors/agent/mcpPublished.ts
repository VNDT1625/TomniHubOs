/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Detector `mcp-published` (design section 7.3): an MCP server that is published as a package, so it can be started
 * with `npx -y <name>@<version>` or `uvx <name>==<version>` without building anything from the repository. This holds
 * the logic that used to live in the classifier's MCP branch and in `mcpLaunch.ts`: the repository's own metadata
 * (`package.json`, `pyproject.toml`) names the package and version; nothing is fetched or executed, and no value from
 * the repository other than that name and version reaches the command line.
 */

import semver from 'semver';
import type { AdapterConnection, AdapterOpenItem } from '@/common/packages/adapter';
import type { Detector, DetectorResult, RepoInventory } from '../types';
import { baseName, toConnectionId, unrecognizedItem, validateConnection } from './mcpShared';

export const MCP_PUBLISHED_DETECTOR_ID = 'mcp-published';
export const MCP_PUBLISHED_DETECTOR_VERSION = 1;

/** Deepest folder (counted in `/`) a workspace package may sit in. */
export const MAX_WORKSPACE_DEPTH = 3;
const MAX_PUBLISHED_SERVERS = 8;
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const PYPI_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const MCP_SDK_DEPENDENCY = /"(?:@modelcontextprotocol\/sdk|@modelcontextprotocol\/server)"/u;
const PYTHON_MENTIONS_MCP = /(?:^|["'\s])mcp\b/imu;

/** How an MCP server published as a package is started: a launcher plus a pinned package name. */
export type McpPublishedRecipe = Readonly<{
  command: 'npx' | 'uvx';
  args: readonly string[];
  /** The published package the launcher fetches, for display. */
  packageName: string;
}>;

const hasBin = (bin: unknown): boolean => {
  if (typeof bin === 'string') return bin.trim() !== '';
  return typeof bin === 'object' && bin !== null && Object.keys(bin).length > 0;
};

const parseObject = (raw: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

/** A package that can be fetched and started: public, named, versioned, and exposing a command. */
export const npmLaunchRecipe = (raw: string): McpPublishedRecipe | undefined => {
  const pkg = parseObject(raw);
  if (pkg === undefined) return undefined;
  const { name, version } = pkg;
  if (pkg.private === true || !hasBin(pkg.bin)) return undefined;
  if (typeof name !== 'string' || !NPM_NAME.test(name) || name.length > 214) return undefined;
  if (typeof version !== 'string' || semver.valid(version) === null) return undefined;
  return { command: 'npx', args: ['-y', `${name}@${version}`], packageName: name };
};

/** `[project]` name/version plus `[project.scripts]`, read without a TOML parser; anything unusual is refused. */
export const pythonLaunchRecipe = (raw: string): McpPublishedRecipe | undefined => {
  const project = /^\[project\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/mu.exec(raw)?.[1];
  if (project === undefined || !/^\[project\.scripts\]\s*$/mu.test(raw)) return undefined;
  const name = /^name\s*=\s*"([^"]+)"/mu.exec(project)?.[1];
  const version = /^version\s*=\s*"([^"]+)"/mu.exec(project)?.[1];
  if (name === undefined || !PYPI_NAME.test(name) || version === undefined || semver.coerce(version) === null) {
    return undefined;
  }
  if (!/^[0-9]+(?:\.[0-9]+)*(?:[A-Za-z0-9.+-]*)$/u.test(version)) return undefined;
  return { command: 'uvx', args: [`${name}==${version}`], packageName: name };
};

/** True when a package manifest says the package itself speaks MCP (it depends on the MCP SDK). */
export const npmSpeaksMcp = (raw: string): boolean => MCP_SDK_DEPENDENCY.test(raw);

/** True when a `pyproject.toml` mentions `mcp` (the Python SDK, `fastmcp`'s `mcp` extra, a script named mcp...). */
export const pythonSpeaksMcp = (raw: string): boolean => PYTHON_MENTIONS_MCP.test(raw);

export type McpRecipeFacts = Readonly<{
  id: string;
  title: string;
  description?: string;
  origin?: 'package-json' | 'pyproject' | 'classifier';
}>;

/**
 * The `mcp` connection that starts a published server. The classifier uses it for its single-server branch; the
 * detector uses it for every package it finds. It carries only the launcher, the pinned name and the display text.
 */
export const mcpConnectionFromRecipe = (recipe: McpPublishedRecipe, facts: McpRecipeFacts): AdapterConnection =>
  ({
    kind: 'mcp' as const,
    id: facts.id,
    title: facts.title.slice(0, 120),
    ...(facts.description === undefined ? {} : { description: facts.description.slice(0, 1000) }),
    command: recipe.command,
    args: [...recipe.args],
    ...(facts.origin === undefined ? {} : { origin: facts.origin }),
  }) satisfies AdapterConnection;

/** What the classifier's MCP branch looked for. Kept as one pure function so the branch only delegates. */
export type McpServerSignals = Readonly<{
  isMcpServer: boolean;
  hasMcpJson: boolean;
  reasons: readonly string[];
}>;

/**
 * Does this repository look like an MCP server? `files` are repository-relative paths, `dependencies` the lowercase
 * dependency names of the root `package.json`, `snippets` the sample file contents the caller has.
 */
export const findMcpServerSignals = (input: {
  files: readonly string[];
  dependencies: ReadonlySet<string>;
  snippets: Readonly<Record<string, string>>;
}): McpServerSignals => {
  const hasMcpJson =
    input.files.some((file) => file.toLowerCase() === 'mcp.json') ||
    input.files.some((file) => file.includes('/mcp.json'));
  const hasMcpSdk =
    input.dependencies.has('@modelcontextprotocol/sdk') || input.dependencies.has('@modelcontextprotocol/server');
  const hasMcpSnippets = Object.values(input.snippets).some(
    (content) => content.includes('@modelcontextprotocol/sdk') || content.includes('Server("')
  );
  const reasons: string[] = [];
  if (hasMcpJson) reasons.push('Detected mcp.json configuration file');
  if (hasMcpSdk) reasons.push('Detected @modelcontextprotocol/sdk in dependencies');
  if (hasMcpSnippets) reasons.push('Detected Model Context Protocol Server instantiation in code');
  return { isMcpServer: hasMcpJson || hasMcpSdk || hasMcpSnippets, hasMcpJson, reasons };
};

type Candidate = Readonly<{
  file: string;
  recipe: McpPublishedRecipe | undefined;
  speaksMcp: boolean;
  origin: 'package-json' | 'pyproject';
  description?: string;
}>;

const readCandidate = (file: string, text: string): Candidate => {
  if (baseName(file) === 'package.json') {
    const description = parseObject(text)?.description;
    return {
      file,
      recipe: npmLaunchRecipe(text),
      speaksMcp: npmSpeaksMcp(text),
      origin: 'package-json',
      ...(typeof description === 'string' && description.trim() !== '' ? { description: description.trim() } : {}),
    };
  }
  const description = /^description\s*=\s*"([^"]+)"/mu.exec(text)?.[1]?.trim();
  return {
    file,
    recipe: pythonLaunchRecipe(text),
    speaksMcp: pythonSpeaksMcp(text),
    origin: 'pyproject',
    ...(description === undefined || description === '' ? {} : { description }),
  };
};

const detect = (inventory: RepoInventory): DetectorResult => {
  const connections: AdapterConnection[] = [];
  const openItems: AdapterOpenItem[] = [];
  const reasons: string[] = [];
  const claimed: string[] = [];
  const usedIds = new Set<string>();
  for (const file of inventory.files) {
    const name = baseName(file);
    if ((name !== 'package.json' && name !== 'pyproject.toml') || file.split('/').length - 1 > MAX_WORKSPACE_DEPTH) {
      continue;
    }
    const text = inventory.text(file);
    if (text === undefined) continue;
    try {
      const candidate = readCandidate(file, text);
      if (!candidate.speaksMcp) continue;
      claimed.push(file);
      const { recipe } = candidate;
      if (recipe === undefined) {
        openItems.push(
          unrecognizedItem(
            file,
            'Có thư viện MCP nhưng package chưa phát hành được (private, thiếu bin, tên hoặc phiên bản).'
          )
        );
        continue;
      }
      const id = toConnectionId(recipe.packageName);
      if (id === undefined || usedIds.has(id)) continue;
      if (connections.length >= MAX_PUBLISHED_SERVERS) {
        openItems.push(unrecognizedItem(file, `Chỉ giữ ${MAX_PUBLISHED_SERVERS} server MCP đầu tiên.`));
        continue;
      }
      const checked = validateConnection(
        mcpConnectionFromRecipe(recipe, {
          id,
          title: recipe.packageName,
          origin: candidate.origin,
          ...(candidate.description === undefined ? {} : { description: candidate.description }),
        }),
        file
      );
      if ('problem' in checked) {
        openItems.push(checked.problem);
        continue;
      }
      usedIds.add(id);
      connections.push(checked.connection);
      reasons.push(`Published MCP server ${recipe.packageName}: ${recipe.command} ${recipe.args.join(' ')}`);
    } catch {
      claimed.push(file);
      openItems.push(unrecognizedItem(file, 'Không phân tích được tệp khai báo package MCP.'));
    }
  }
  return { connections, openItems, reasons, claimed };
};

export const mcpPublished: Detector = {
  id: MCP_PUBLISHED_DETECTOR_ID,
  version: MCP_PUBLISHED_DETECTOR_VERSION,
  detect,
};
