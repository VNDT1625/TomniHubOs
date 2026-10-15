/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The repository inventory (design section 7.1): the tree of safe files plus the text of a fixed set of small
 * declaration files. Text is never read for any other path, and never because a README suggested it.
 */

import type { RepoInventory } from './types';

/** Per-file cap of a declaration file's text. Longer text is cut; a cut JSON file then fails to parse (open item). */
export const MAX_DECLARATION_CHARS = 256 * 1024;
/** Userscripts only need the `==UserScript==` header, so only their first 8 KB is kept. */
export const MAX_USERSCRIPT_CHARS = 8 * 1024;
/** Total text kept for one repository. Sizes are counted in UTF-16 code units, a close approximation of bytes. */
export const MAX_TOTAL_CHARS = 32 * 1024 * 1024;

/**
 * Fixed name patterns of the declaration files, matched against the lowercase normalized path. Detectors may read
 * only these. Folders such as `commands/` match at any depth because plugins and `.claude/`-style folders nest them.
 */
export const DECLARATION_FILES: readonly RegExp[] = [
  /(?:^|\/)package\.json$/u,
  /(?:^|\/)pyproject\.toml$/u,
  /(?:^|\/)cargo\.toml$/u,
  /(?:^|\/)go\.mod$/u,
  /(?:^|\/)requirements[^/]*\.txt$/u,
  /(?:^|\/)\.env\.example$/u,
  /(?:^|\/)(?:docker-)?compose\.ya?ml$/u,
  /(?:^|\/)manifest\.json$/u,
  /(?:^|\/)(?:plugin|marketplace|hooks|gemini-extension|mcp|\.mcp|mcp_config)\.json$/u,
  /(?:^|\/)\.(?:claude|codex|gemini)\/settings(?:\.local)?\.json$/u,
  /(?:^|\/)skill\.md$/u,

  /\.user\.js$/u,
  // Build and launch tool configuration read by the app and extension detectors.
  /(?:^|\/)(?:wxt\.config\.[a-z]+|electron-builder\.ya?ml|project\.godot|tauri\.conf\.json)$/u,
  // Rules and context files (design section 5, row 12).
  /(?:^|\/)(?:agents|claude|gemini)\.md$/u,
  /(?:^|\/)\.cursorrules$/u,
  /(?:^|\/)\.github\/copilot-instructions\.md$/u,
  /(?:^|\/)\.github\/instructions\/.+\.md$/u,
  /(?:^|\/)\.kiro\/steering\/.+\.md$/u,
  /(?:^|\/)\.clinerules(?:\/.+\.(?:md|txt))?$/u,
  // Prompt, agent and rule folders.
  /(?:^|\/)(?:commands|agents|prompts|rules)\/.+\.(?:md|mdc|toml)$/u,
  /(?:^|\/)\.opencode\/(?:command|agent)\/.+\.md$/u,
];

const USERSCRIPT = /\.user\.js$/iu;
const VENDORED_FOLDER = /(?:^|\/)(?:node_modules|\.git)\//u;
const DRIVE_PREFIX = /^[A-Za-z]:/u;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

/**
 * Normalizes a repository path: `/` separators, no `.` or empty parts. Returns `undefined` for a path that is
 * absolute, has a drive, contains `..` or control characters, or is empty. Such paths are dropped, never repaired.
 */
export const normalizeRepoPath = (path: string): string | undefined => {
  if (CONTROL_CHARACTER.test(path)) return undefined;
  const slashed = path.replace(/\\/gu, '/');
  if (slashed.startsWith('/') || DRIVE_PREFIX.test(slashed)) return undefined;
  const parts = slashed.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.length === 0 || parts.includes('..')) return undefined;
  return parts.join('/');
};

/** True when `path` (already normalized) is a file detectors may read. Never true for vendored folders. */
export const isDeclarationFile = (path: string): boolean => {
  if (VENDORED_FOLDER.test(path)) return false;
  const lower = path.toLowerCase();
  return DECLARATION_FILES.some((pattern) => pattern.test(lower));
};

/** Characters of text kept for a declaration file. */
const limitFor = (path: string): number => (USERSCRIPT.test(path) ? MAX_USERSCRIPT_CHARS : MAX_DECLARATION_CHARS);

const compareStrings = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export type CreateInventoryInput = Readonly<{
  files: readonly string[];
  sizes?: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  /** Called only for declaration files, once each, in sorted path order. May return `undefined` or throw. */
  readText: (path: string) => string | undefined;
}>;

const sizeMap = (input: CreateInventoryInput['sizes']): Map<string, number> => {
  const result = new Map<string, number>();
  if (input === undefined) return result;
  const entries: Iterable<readonly [string, number]> =
    input instanceof Map ? input.entries() : Object.entries(input as Readonly<Record<string, number>>);
  for (const [path, size] of entries) {
    const normalized = normalizeRepoPath(path);
    if (normalized !== undefined && Number.isFinite(size) && size >= 0) result.set(normalized, size);
  }
  return result;
};

/**
 * Builds the inventory. Declaration files are read eagerly, in sorted order, so which files fall over the total
 * budget (`overflow`) never depends on the order detectors later call `text` in.
 */
export const createInventory = (input: CreateInventoryInput): RepoInventory => {
  const files = [
    ...new Set(input.files.map(normalizeRepoPath).filter((path): path is string => path !== undefined)),
  ].toSorted(compareStrings);
  const known = sizeMap(input.sizes);
  const sizes = new Map<string, number>();
  const fileSet = new Set(files);
  for (const [path, size] of known) if (fileSet.has(path)) sizes.set(path, size);

  const contents = new Map<string, string>();
  const overflow: string[] = [];
  let total = 0;
  for (const path of files) {
    if (!isDeclarationFile(path)) continue;
    let raw: string | undefined;
    try {
      raw = input.readText(path);
    } catch {
      raw = undefined;
    }
    if (typeof raw !== 'string') continue;
    const limit = limitFor(path);
    const content = raw.length > limit ? raw.slice(0, limit) : raw;
    if (total + content.length > MAX_TOTAL_CHARS) {
      overflow.push(path);
      continue;
    }
    total += content.length;
    contents.set(path, content);
  }

  return {
    files,
    sizes,
    overflow,
    text: (path) => {
      const normalized = normalizeRepoPath(path);
      return normalized === undefined ? undefined : contents.get(normalized);
    },
  };
};
