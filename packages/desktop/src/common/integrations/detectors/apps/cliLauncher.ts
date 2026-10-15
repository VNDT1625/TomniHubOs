/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `cli-launcher` detector (design sections 6.2 and 7.3): the programs and desktop apps a repository declares.
 * - `package.json` `bin` (npm). A published package (has a version, not `private`) with one bin becomes
 *   `npx -y <package>`; with several bins the host installs the package and runs the named bin. An unpublished one
 *   becomes `node <file>` in its own folder, after `npm install`, and only when the file is JavaScript.
 * - `pyproject.toml` `[project.scripts]`. A published project runs through `uvx` (or the named script of the
 *   package); an unpublished one through `uv run <script>` in its folder.
 * - `Cargo.toml` binaries and Go `main` packages need a toolchain Tomny does not run yet: open items.
 * - Desktop apps (the `build` block of `package.json`, `electron-builder.yml`, `tauri.conf.json`) become one
 *   `launcher` connection that names the installed executable by its product name. No download happens here.
 * - Godot projects need the editor: open item.
 * Every command is an argument vector built from validated tokens; no shell string is ever produced. Nothing is run.
 */

import { parse as parseToml } from 'smol-toml';
import { COMMAND_TOKEN, packageName } from '@/common/packages/adapter/primitives';
import { npmSpeaksMcp } from '../agent/mcpPublished';
import { isDeclarationFile } from '../inventory';
import type { Detector, DetectorResult, RepoInventory } from '../types';
import {
  addConnection,
  cleanRelative,
  createContext,
  field,
  isRecord,
  listField,
  loadJson,
  packagePathOf,
  plain,
  report,
  stringField,
  toId,
  uniqueId,
  type Context,
} from '../agent/plugin/support';

type Table = Readonly<Record<string, unknown>>;
type Used = { cli: Set<string>; launcher: Set<string> };

/** Entries read from one manifest; more than this is reported, not read. */
const MAX_ENTRIES = 8;
/** A JavaScript bin file: the only bin kind an unpublished npm package runs without a build. */
const JAVASCRIPT_FILE = /\.(?:c|m)?js$/u;
/** Electron Builder product name in YAML: a top-level `productName:` scalar, quoted or not. */
const YAML_PRODUCT_NAME =
  /^productName:[ \t]*(?:"([^"\n]{1,120})"|'([^'\n]{1,120})'|([^\s#"'][^\n#]{0,119}?))[ \t]*(?:#.*)?$/mu;

const folderOf = (file: string): string => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
const joined = (folder: string, relative: string): string => (folder === '' ? relative : `${folder}/${relative}`);
const recordOf = (value: unknown): Table => (isRecord(value) ? value : {});

/** A valid package name of a registry, or `undefined`. Scoped names are allowed, flags and shell syntax are not. */
const registryName = (value: string | undefined): string | undefined =>
  value !== undefined && !value.startsWith('-') && packageName.safeParse(value).success ? value : undefined;

/** Parses a TOML declaration (already read by the inventory). A missing, cut or invalid file is reported. */
const loadToml = (context: Context, file: string): Table | undefined => {
  context.claimed.add(file);
  const text = context.inventory.text(file);
  if (text === undefined) {
    report(context, 'unrecognized', 'Tệp khai báo không đọc được (quá lớn hoặc vượt ngân sách đọc)', { path: file });
    return undefined;
  }
  try {
    return recordOf(parseToml(text));
  } catch {
    report(context, 'unrecognized', 'Tệp TOML hỏng, không phân tích được', { path: file });
    return undefined;
  }
};

/** The `bin` entries of a package as `[command, relative path]`. Unsafe entries are reported and dropped. */
const npmBinEntries = (context: Context, file: string, raw: unknown, name: string | undefined): [string, string][] => {
  if (raw === undefined) return [];
  if (typeof raw !== 'string' && !isRecord(raw)) {
    report(context, 'unrecognized', 'Trường bin không phải chuỗi hay đối tượng', { path: file });
    return [];
  }
  const pairs: [string, unknown][] =
    typeof raw === 'string'
      ? [[(name ?? '').replace(/^@[^/]+\//u, ''), raw]]
      : Object.entries(raw as Readonly<Record<string, unknown>>);
  if (pairs.length > MAX_ENTRIES) {
    report(context, 'unrecognized', `Quá ${MAX_ENTRIES} lệnh bin; chỉ đọc ${MAX_ENTRIES} lệnh đầu`, { path: file });
  }
  const entries: [string, string][] = [];
  for (const [command, path] of pairs.slice(0, MAX_ENTRIES)) {
    const relative = typeof path === 'string' ? cleanRelative(path) : undefined;
    if (!COMMAND_TOKEN.test(command) || relative === undefined || relative === '') {
      report(context, 'unrecognized', 'Lệnh bin có tên hoặc đường dẫn không an toàn; không tạo kết nối', {
        path: file,
      });
      continue;
    }
    entries.push([command, relative]);
  }
  return entries;
};

const emitNpm = (context: Context, file: string, folder: string, manifest: Table, used: Used): void => {
  const name = stringField(manifest, 'name');
  const version = stringField(manifest, 'version');
  const registry = registryName(name);
  const published = registry !== undefined && version !== undefined && field(manifest, 'private') !== true;
  const entries = npmBinEntries(context, file, field(manifest, 'bin'), name);
  for (const [command, relative] of entries) {
    const id = uniqueId(used.cli, toId(command));
    if (published && registry !== undefined) {
      const launch =
        entries.length === 1 ? { command: 'npx', args: ['-y', registry] } : { command, args: [] as string[] };
      addConnection(
        context,
        {
          kind: 'cli',
          id,
          title: command,
          command: launch.command,
          ...(launch.args.length > 0 ? { args: launch.args } : {}),
          display: 'terminal',
          source: 'npm',
          package: registry,
          origin: 'package-json',
        },
        file
      );
      continue;
    }
    if (!JAVASCRIPT_FILE.test(relative.toLowerCase())) {
      report(context, 'needs-runtime', `Lệnh ${command}: bin không phải JavaScript; cần runtime để chạy`, {
        path: file,
      });
      continue;
    }
    const cwd = packagePathOf(folder);
    if (cwd === undefined) {
      report(context, 'unrecognized', 'Thư mục gói quá dài để đưa vào gói', { path: file });
      continue;
    }
    addConnection(
      context,
      {
        kind: 'cli',
        id,
        title: command,
        command: 'node',
        args: [relative],
        cwd,
        display: 'terminal',
        source: 'source',
        setup: [['npm', 'install', '--ignore-scripts']],
        origin: 'package-json',
      },
      file
    );
  }
};

const emitPython = (context: Context, file: string, folder: string, document: Table, used: Used): void => {
  const project = recordOf(document.project);
  const name = stringField(project, 'name');
  const registry = registryName(name);
  const version = stringField(project, 'version');
  const dynamicVersion = listField(project, 'dynamic').includes('version');
  const published = registry !== undefined && version !== undefined && !dynamicVersion;
  const scripts = Object.entries(recordOf(project.scripts));
  if (scripts.length > MAX_ENTRIES) {
    report(context, 'unrecognized', `Quá ${MAX_ENTRIES} lệnh [project.scripts]; chỉ đọc ${MAX_ENTRIES} lệnh đầu`, {
      path: file,
    });
  }
  for (const [script, target] of scripts.slice(0, MAX_ENTRIES)) {
    if (!COMMAND_TOKEN.test(script) || typeof target !== 'string') {
      report(context, 'unrecognized', 'Lệnh [project.scripts] có tên hoặc giá trị không hợp lệ', { path: file });
      continue;
    }
    const id = uniqueId(used.cli, toId(script));
    if (published && registry !== undefined) {
      const launch =
        script === registry ? { command: 'uvx', args: [registry] } : { command: script, args: [] as string[] };
      addConnection(
        context,
        {
          kind: 'cli',
          id,
          title: script,
          command: launch.command,
          ...(launch.args.length > 0 ? { args: launch.args } : {}),
          display: 'terminal',
          source: 'pypi',
          package: registry,
          origin: 'pyproject',
        },
        file
      );
      continue;
    }
    const cwd = packagePathOf(folder);
    if (cwd === undefined) {
      report(context, 'unrecognized', 'Thư mục dự án quá dài để đưa vào gói', { path: file });
      continue;
    }
    addConnection(
      context,
      {
        kind: 'cli',
        id,
        title: script,
        command: 'uv',
        args: ['run', script],
        cwd,
        display: 'terminal',
        source: 'source',
        setup: [['uv', 'sync']],
        origin: 'pyproject',
      },
      file
    );
  }
  const poetry = recordOf(recordOf(document.tool).poetry);
  if (poetry.scripts !== undefined) {
    report(context, 'unrecognized', '[tool.poetry.scripts] chưa được đọc ở bản này; không tạo kết nối', { path: file });
  }
};

const emitCargo = (context: Context, file: string, folder: string, document: Table): void => {
  const crate = stringField(recordOf(document.package), 'name');
  const names: string[] = [];
  for (const entry of listField(document, 'bin').slice(0, MAX_ENTRIES)) {
    const name = isRecord(entry) ? stringField(entry, 'name') : undefined;
    if (name === undefined) report(context, 'unrecognized', '[[bin]] không có name', { path: file });
    else names.push(name);
  }
  if (crate !== undefined && context.files.has(joined(folder, 'src/main.rs')) && !names.includes(crate)) {
    names.push(crate);
  }
  for (const name of names) {
    report(context, 'needs-runtime', `Chương trình Rust ${plain(name, 60)}: cần toolchain Rust mà Tomny chưa chạy`, {
      path: file,
    });
  }
};

/** Go `main` packages: `main.go` at the module root or directly under `cmd/`. Only file names are read. */
const emitGo = (context: Context, file: string, folder: string): void => {
  context.claimed.add(file);
  const cmd = joined(folder, 'cmd/');
  for (const candidate of context.inventory.files) {
    if (/(?:^|\/)(?:vendor|testdata)\//u.test(candidate) || !/(?:^|\/)main\.go$/u.test(candidate)) continue;
    const dir = folderOf(candidate);
    const isRoot = candidate === joined(folder, 'main.go');
    const isCmd = dir.startsWith(cmd) && dir.length > cmd.length && !dir.slice(cmd.length).includes('/');
    if (!isRoot && !isCmd) continue;
    report(context, 'needs-runtime', `Chương trình Go ${plain(dir || '.', 80)}: cần Go toolchain mà Tomny chưa chạy`, {
      path: candidate,
    });
  }
};

const emitDesktop = (
  context: Context,
  file: string,
  productName: string | undefined,
  origin: 'package-json' | 'classifier',
  used: Used
): void => {
  if (productName === undefined) {
    report(context, 'unrecognized', 'Ứng dụng desktop không có productName; không tạo mục khởi chạy', { path: file });
    return;
  }
  const id = uniqueId(used.launcher, toId(productName));
  addConnection(
    context,
    { kind: 'launcher', id, title: productName, target: { kind: 'installed', executable: productName }, origin },
    file
  );
};

/** Product name of a desktop app's Tauri configuration: root `productName` or `package.productName`. */
const tauriProductName = (document: Table): string | undefined =>
  stringField(document, 'productName') ?? stringField(recordOf(document.package), 'productName');

export const cliLauncher: Detector = {
  id: 'cli-launcher',
  version: 1,
  detect: (inventory: RepoInventory): DetectorResult => {
    const context = createContext(inventory);
    const used: Used = { cli: new Set(), launcher: new Set() };
    for (const file of inventory.files) {
      if (!isDeclarationFile(file)) continue;
      const lower = file.toLowerCase();
      const base = lower.slice(lower.lastIndexOf('/') + 1);
      const folder = folderOf(file);
      // C2 (merge.ts withCoverage): a claimed file that produced nothing is reported, so a plain manifest is not claimed.
      const produced = context.connections.length + context.openItems.length;
      if (base === 'package.json') {
        const loaded = loadJson(context, file);
        if (loaded.state !== 'ok' || !isRecord(loaded.value)) continue;
        const manifest = loaded.value;
        if (npmSpeaksMcp(inventory.text(file) ?? '')) {
          context.reasons.push('Gói npm là máy chủ MCP: bin được nhận như kết nối MCP, không tạo lệnh CLI');
        } else {
          emitNpm(context, file, folder, manifest, used);
        }
        if (isRecord(field(manifest, 'build'))) {
          const build = recordOf(field(manifest, 'build'));
          emitDesktop(
            context,
            file,
            stringField(build, 'productName') ?? stringField(manifest, 'name'),
            'package-json',
            used
          );
        }
      } else if (base === 'pyproject.toml') {
        const document = loadToml(context, file);
        if (document !== undefined) emitPython(context, file, folder, document, used);
      } else if (base === 'cargo.toml') {
        const document = loadToml(context, file);
        if (document !== undefined) emitCargo(context, file, folder, document);
      } else if (base === 'go.mod') {
        emitGo(context, file, folder);
      } else if (/^electron-builder\.ya?ml$/u.test(base)) {
        context.claimed.add(file);
        const text = inventory.text(file);
        const match = text === undefined ? undefined : YAML_PRODUCT_NAME.exec(text);
        const productName =
          match === null || match === undefined ? undefined : (match[1] ?? match[2] ?? match[3])?.trim();
        emitDesktop(context, file, productName, 'classifier', used);
      } else if (base === 'tauri.conf.json') {
        const loaded = loadJson(context, file);
        if (loaded.state === 'ok' && isRecord(loaded.value)) {
          emitDesktop(context, file, tauriProductName(loaded.value), 'classifier', used);
        }
      } else if (base === 'project.godot') {
        context.claimed.add(file);
        report(context, 'needs-runtime', 'Dự án Godot: cần trình soạn thảo Godot; chưa có mục khởi chạy', {
          path: file,
        });
      }
      if (context.connections.length + context.openItems.length === produced) context.claimed.delete(file);
    }
    const cli = context.connections.filter((connection) => connection.kind === 'cli').length;
    const launchers = context.connections.filter((connection) => connection.kind === 'launcher').length;
    return {
      connections: context.connections,
      openItems: context.openItems,
      reasons: [
        ...context.reasons,
        ...(cli + launchers > 0 ? [`Detected ${cli} command-line entries and ${launchers} desktop launchers`] : []),
      ],
      claimed: [...context.claimed].toSorted(),
    };
  },
};
