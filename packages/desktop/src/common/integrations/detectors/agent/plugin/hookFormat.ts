/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which hook files are written in the Claude Code format, the only format this version runs. A file is Claude format
 * when it is `.claude/settings*.json`, a Claude plugin manifest (`.claude-plugin/plugin.json`, `marketplace.json`), a
 * plugin's `hooks/hooks.json` in a folder with `.claude-plugin/plugin.json`, or a file a Claude plugin manifest names
 * with its `hooks` key. Every other hook file (Codex, Copilot, Cursor, Gemini, Kiro... under `configs/`, `hooks/<host>/`,
 * `.<host>-plugin/` or `.codex/`) belongs to another host and is reported once per file, never parsed entry by entry.
 */

import type { RepoInventory } from '../../types';
import { cleanRelative, joinPath } from './support';

export type HookFileFormat = Readonly<{ format: 'claude' }> | Readonly<{ format: 'other'; host: string }>;

const CLAUDE_SETTINGS = /(?:^|\/)\.claude\/settings(?:\.local)?\.json$/u;
/** A Claude plugin manifest: its inline `hooks` value is Claude format wherever the manifest is read. */
const CLAUDE_MANIFEST = /(?:^|\/)\.claude-plugin\/(?:plugin|marketplace)\.json$/u;
const CLAUDE_PLUGIN_MANIFEST = '.claude-plugin/plugin.json';
const PLUGIN_SUFFIX = '-plugin';

/** Best guess of the host a non-Claude hook file was written for, from its path. Only used in the note. */
export const hostOfHookFile = (file: string): string => {
  const parts = file.toLowerCase().split('/');
  for (const [index, part] of parts.entries()) {
    const next = parts[index + 1];
    if (part.startsWith('.') && part.endsWith(PLUGIN_SUFFIX) && part.length > PLUGIN_SUFFIX.length + 1) {
      return part.slice(1, -PLUGIN_SUFFIX.length);
    }
    if (part === 'configs' && next !== undefined) return next;
    if (part === 'hooks' && next !== undefined && next !== 'hooks.json') return next;
    if ((part === '.codex' || part === '.gemini') && next !== undefined) return part.slice(1);
  }
  return 'unknown';
};

/** The `hooks` values of one Claude plugin manifest that name files (a string or a list of strings). */
const namedHookFiles = (folder: string, text: string | undefined): string[] => {
  if (text === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const value = (parsed as Readonly<Record<string, unknown>>).hooks;
  const values: unknown[] = Array.isArray(value) ? value : [value];
  const files: string[] = [];
  for (const entry of values) {
    if (typeof entry !== 'string') continue;
    const relative = cleanRelative(entry);
    if (relative !== undefined) files.push(joinPath(folder, relative));
  }
  return files;
};

/**
 * Repository paths of the hook files that Claude plugin manifests name with their `hooks` key. Read from every
 * `.claude-plugin/plugin.json` in the inventory; the plugin folder is the folder above `.claude-plugin/`.
 */
export const claudeManifestHookFiles = (inventory: RepoInventory): ReadonlySet<string> => {
  const named = new Set<string>();
  for (const file of inventory.files) {
    const lower = file.toLowerCase();
    if (lower !== CLAUDE_PLUGIN_MANIFEST && !lower.endsWith(`/${CLAUDE_PLUGIN_MANIFEST}`)) continue;
    const folder = file.slice(0, file.length - CLAUDE_PLUGIN_MANIFEST.length).replace(/\/$/u, '');
    for (const path of namedHookFiles(folder, inventory.text(file))) named.add(path);
  }
  return named;
};

/**
 * The format of one hook file. `hasFile` answers whether a repository path exists; `named` is the set from
 * {@link claudeManifestHookFiles}. Paths are repository-relative with `/`.
 */
export const hookFileFormat = (
  file: string,
  hasFile: (path: string) => boolean,
  named: ReadonlySet<string>
): HookFileFormat => {
  const lower = file.toLowerCase();
  if (CLAUDE_SETTINGS.test(lower) || CLAUDE_MANIFEST.test(lower) || named.has(file)) return { format: 'claude' };
  const parts = file.split('/');
  const count = parts.length;
  if (count >= 2 && parts[count - 1]?.toLowerCase() === 'hooks.json' && parts[count - 2]?.toLowerCase() === 'hooks') {
    const pluginFolder = parts.slice(0, -2).join('/');
    if (hasFile(joinPath(pluginFolder, CLAUDE_PLUGIN_MANIFEST))) return { format: 'claude' };
  }
  return { format: 'other', host: hostOfHookFile(file) };
};

/** The one note a non-Claude hook file gets. The same text for the same file from any reader, so it is listed once. */
export const otherHookFileNote = (host: string): string =>
  `hook config for ${host}, not used (Claude Code format only)`;
