/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `gemini` detector (design section 7.3): a Gemini CLI extension, its `gemini-extension.json` and the `commands/`
 * folder beside it.
 * - `mcpServers` go through the same converter as `.mcp.json` (`readConfigFile` of `mcp-config`), so there is one set
 *   of MCP rules. Gemini's placeholders are rewritten first: `${extensionPath}` is the extension folder, `${/}` is the
 *   path separator, and `httpUrl` is the streamable HTTP form of `url`. Origin is `gemini-extension`.
 * - `settings[].envVar` names become `env-value` open items. The value is the person's to supply and is never read.
 * - `commands/**\/*.toml` (`prompt`, `description`) become `command` connections in the `gemini-toml` format.
 * `contextFileName` is turned into a rules connection by `commands-agents`, which already reads this file.
 */

import { parse as parseToml } from 'smol-toml';
import { ENV_KEY } from '@/common/packages/adapter/primitives';
import { readConfigFile } from './mcpConfig';
import { isDeclarationFile } from '../inventory';
import type { Detector, DetectorResult, RepoInventory } from '../types';
import {
  addConnection,
  createContext,
  isRecord,
  packagePathOf,
  plain,
  report,
  toId,
  uniqueId,
  type Context,
} from './plugin/support';
import type { AdapterConnection } from '@/common/packages/adapter';

const MAX_SETTINGS = 32;
const MAX_COMMANDS = 64;
const EXTENSION_PATH = /\$\{extensionPath\}/gu;
const PATH_SEPARATOR = /\$\{\/\}/gu;

const folderOf = (file: string): string => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
const joined = (folder: string, relative: string): string => (folder === '' ? relative : `${folder}/${relative}`);
const baseOf = (file: string): string => file.slice(file.lastIndexOf('/') + 1);

/** Gemini placeholders rewritten into the form the shared MCP converter already understands. */
const portable = (value: unknown): unknown => {
  if (typeof value === 'string') return value.replace(EXTENSION_PATH, '.').replace(PATH_SEPARATOR, '/');
  if (Array.isArray(value)) return value.map(portable);
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'httpUrl' && typeof entry === 'string' && value.url === undefined) result.url = portable(entry);
    else if (key !== 'httpUrl') result[key] = portable(entry);
  }
  return result;
};

const withOrigin = (connection: AdapterConnection): AdapterConnection =>
  ({ ...connection, origin: 'gemini-extension' }) as AdapterConnection;

/** Connections the extension's servers become, through the MCP converter. */
const emitServers = (
  context: Context,
  file: string,
  manifest: Record<string, unknown>,
  files: ReadonlySet<string>
): void => {
  const servers = manifest.mcpServers;
  if (!isRecord(servers)) return;
  const outcome = readConfigFile(file, JSON.stringify({ mcpServers: portable(servers) }), files);
  for (const connection of outcome.connections) context.connections.push(withOrigin(connection));
  context.openItems.push(...outcome.openItems);
  context.reasons.push(...outcome.reasons);
};

/** Each setting's `envVar` becomes an open item: a name the person must give a value to. */
const emitSettings = (context: Context, file: string, manifest: Record<string, unknown>): void => {
  const settings = Array.isArray(manifest.settings) ? (manifest.settings as readonly unknown[]) : [];
  for (const entry of settings.slice(0, MAX_SETTINGS)) {
    const envVar = isRecord(entry) ? entry.envVar : undefined;
    if (typeof envVar !== 'string') continue;
    if (!ENV_KEY.test(envVar)) {
      report(context, 'unrecognized', 'Cài đặt của extension có envVar không hợp lệ; bỏ qua', { path: file });
      continue;
    }
    report(context, 'env-value', `Cần giá trị cho ${envVar} (cài đặt của gemini-extension)`, {
      name: envVar,
      path: file,
    });
  }
};

/** One `commands/**\/*.toml` file: a prompt template. It runs nothing and grants nothing. */
const emitCommand = (
  context: Context,
  inventory: RepoInventory,
  file: string,
  prefix: string,
  used: Set<string>
): void => {
  context.claimed.add(file);
  const relative = file.slice(prefix.length, -'.toml'.length);
  const title = plain(relative, 120);
  const packagePath = packagePathOf(file);
  const text = inventory.text(file);
  if (text === undefined || packagePath === undefined) {
    report(context, 'unrecognized', 'Lệnh gemini không đọc được (quá lớn hoặc đường dẫn quá dài)', { path: file });
    return;
  }
  let document: Record<string, unknown>;
  try {
    document = parseToml(text) as Record<string, unknown>;
  } catch {
    report(context, 'unrecognized', 'Lệnh gemini: TOML hỏng, không phân tích được', { path: file });
    return;
  }
  if (typeof document.prompt !== 'string') {
    report(context, 'unrecognized', 'Lệnh gemini thiếu trường prompt; không tạo lệnh', { path: file });
    return;
  }
  const description = typeof document.description === 'string' ? plain(document.description, 1000) : '';
  addConnection(
    context,
    {
      kind: 'command',
      id: uniqueId(used, toId(relative.replace(/\//gu, '-')) || 'command'),
      title: title || 'command',
      ...(description === '' ? {} : { description }),
      path: packagePath,
      format: 'gemini-toml',
      origin: 'gemini-extension',
    },
    file
  );
};

export const gemini: Detector = {
  id: 'gemini',
  version: 1,
  detect: (inventory: RepoInventory): DetectorResult => {
    const context = createContext(inventory);
    const used = new Set<string>();
    const files = new Set(inventory.files);
    for (const file of inventory.files) {
      if (!isDeclarationFile(file) || baseOf(file).toLowerCase() !== 'gemini-extension.json') continue;
      const produced = context.connections.length + context.openItems.length;
      context.claimed.add(file);
      const text = inventory.text(file);
      if (text === undefined) {
        report(context, 'unrecognized', 'gemini-extension.json không đọc được (quá lớn hoặc vượt ngân sách đọc)', {
          path: file,
        });
        continue;
      }
      let manifest: unknown;
      try {
        manifest = JSON.parse(text.replace(/^﻿/u, '')) as unknown;
      } catch {
        report(context, 'unrecognized', 'gemini-extension.json: JSON hỏng, không phân tích được', { path: file });
        continue;
      }
      if (isRecord(manifest)) {
        emitServers(context, file, manifest, files);
        emitSettings(context, file, manifest);
      }
      const prefix = joined(folderOf(file), 'commands/');
      const commands = inventory.files
        .filter((candidate) => candidate.startsWith(prefix) && candidate.toLowerCase().endsWith('.toml'))
        .slice(0, MAX_COMMANDS);
      for (const command of commands) emitCommand(context, inventory, command, prefix, used);
      // C2 (merge.ts withCoverage): a claimed file with nothing to show is reported, so a manifest with only a
      // context file name (handled by commands-agents) is not claimed here.
      if (context.connections.length + context.openItems.length === produced) context.claimed.delete(file);
    }
    const count = context.connections.length;
    return {
      connections: context.connections,
      openItems: context.openItems,
      reasons: [...context.reasons, ...(count > 0 ? [`Detected ${count} gemini extension entries`] : [])],
      claimed: [...context.claimed].toSorted(),
    };
  },
};
