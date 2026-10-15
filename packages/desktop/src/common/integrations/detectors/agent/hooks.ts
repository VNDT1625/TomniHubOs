/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `hooks` detector (design sections 7.3 and 11.2): hook declarations kept in the repository itself. It reads
 * Claude Code hook declarations: `hooks.json` files of a Claude plugin and the `hooks` block of `.claude/settings*.json`.
 * Hook files written for another host (Codex, Copilot, Cursor, Gemini...) are reported once per file and not parsed.
 * Plugin hooks are also read by the plugin reader; the merge step drops the duplicates by their hash key (design section 7.5). Parsing and open items are the hook runner's own
 * (`readHooksDocument`). Nothing is run, and the other keys of a settings file (environment, permissions) are never
 * copied into the output.
 */

import { isDeclarationFile } from '../inventory';
import type { Detector, DetectorResult, RepoInventory } from '../types';
import { claudeManifestHookFiles, hookFileFormat, otherHookFileNote } from './plugin/hookFormat';
import { readHooksDocument } from './plugin/hooks';
import { createContext, loadJson, packagePathOf, report, type RootScope } from './plugin/support';

/** `hooks.json` at any depth. Paths are compared lowercase, as in `isDeclarationFile`. */
const HOOKS_FILE = /(?:^|\/)hooks\.json$/u;
/** Settings files that may carry a `hooks` block. */
const SETTINGS_FILE = /(?:^|\/)\.(?:claude|codex|gemini)\/settings(?:\.local)?\.json$/u;
/** A settings file is read only when it mentions `hooks` as a key; otherwise it is not this detector's business. */
const HOOKS_KEY = /"hooks"\s*:/u;

const isHooksSource = (file: string): boolean => {
  const lower = file.toLowerCase();
  return HOOKS_FILE.test(lower) || SETTINGS_FILE.test(lower);
};

/**
 * The folder a hooks file belongs to. For `hooks/hooks.json` that is the folder above `hooks/`; for `.claude/settings.json`
 * or `.codex/hooks.json` it is the folder above the dot folder, which holds the settings rather than being the plugin.
 */
export const ownerFolderOf = (file: string): string => {
  const parts = file.split('/').slice(0, -1);
  const last = parts.at(-1);
  if (last === 'hooks' || last?.startsWith('.') === true) parts.pop();
  return parts.join('/');
};

/** The settings text mentions `hooks`, or the text is unavailable (then `loadJson` reports it as unreadable). */
const mayHoldHooks = (inventory: RepoInventory, file: string): boolean => {
  const text = inventory.text(file);
  return text === undefined || HOOKS_KEY.test(text);
};

export const hooks: Detector = {
  id: 'hooks',
  version: 1,
  detect: (inventory: RepoInventory): DetectorResult => {
    const context = createContext(inventory);
    const hookIndex = { next: 0 };
    const named = claudeManifestHookFiles(inventory);
    const candidates = inventory.files.filter((file) => isDeclarationFile(file) && isHooksSource(file));
    let documents = 0;
    for (const file of candidates) {
      if (SETTINGS_FILE.test(file.toLowerCase()) && !mayHoldHooks(inventory, file)) continue;
      const format = hookFileFormat(file, (path) => context.files.has(path), named);
      if (format.format === 'other') {
        report(context, 'unrecognized', otherHookFileNote(format.host), { path: file });
        context.claimed.add(file);
        continue;
      }
      const root = ownerFolderOf(file);
      const plugin = packagePathOf(root);
      if (plugin === undefined) {
        report(context, 'unrecognized', 'Hook không đưa vào gói: đường dẫn quá dài', { path: file });
        context.claimed.add(file);
        continue;
      }
      const loaded = loadJson(context, file);
      if (loaded.state !== 'ok') continue;
      const scope: RootScope = {
        root,
        plugin,
        origin: 'classifier',
        used: { mcp: new Set(), command: new Set(), agent: new Set(), cli: new Set() },
        hookIndex,
      };
      readHooksDocument(context, scope, loaded.value, file);
      documents += 1;
    }
    const count = context.connections.filter((connection) => connection.kind === 'hook').length;
    return {
      connections: context.connections,
      openItems: context.openItems,
      reasons: count > 0 ? [`Detected ${count} hook declarations in ${documents} files`] : [],
      claimed: [...context.claimed].toSorted(),
    };
  },
};
