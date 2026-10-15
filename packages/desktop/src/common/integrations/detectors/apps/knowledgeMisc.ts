/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `knowledge-misc` detector (design sections 6.2 and 7.3): collections of documents the agent may search.
 * - `docs/` folders (the outermost of each), notebooks (`.ipynb`) and large Markdown folders become `knowledge`
 *   connections. Folders that hold agent prompts, rules or skills, and dot folders, belong to other detectors.
 * - A root file named `awesome*.md` is taken as an awesome list. README text is not read (design section 7.1).
 * - Model weights (`.gguf`, `.safetensors`, `.onnx`, `.pt`, `.pth`, `.ckpt`, `.h5`) are never packaged: each one becomes
 *   an open item that asks the person for a model folder on their machine.
 * Only file names are used; nothing is read beyond the declaration files, and nothing is executed.
 */

import { addConnection, createContext, packagePathOf, plain, report, toId, uniqueId } from '../agent/plugin/support';
import type { Detector, DetectorResult, RepoInventory } from '../types';

/** A `knowledge` connection lists at most this many paths. */
const MAX_PATHS = 200;
/** A Markdown folder becomes knowledge only with at least this many documents. */
const MIN_MARKDOWN = 5;
const MAX_MODEL_NOTES = 8;
const MODEL_FILE = /\.(?:gguf|safetensors|onnx|pt|pth|ckpt|h5)$/u;
const AWESOME_FILE = /^awesome[^/]*\.md$/iu;
/** Folders other detectors read, or that hold tooling rather than documents. */
const OWNED_FOLDERS: ReadonlySet<string> = new Set([
  'commands',
  'agents',
  'prompts',
  'rules',
  'skills',
  'node_modules',
  'vendor',
]);

/** Text files the Library reads (the same extensions as its text index); other listed files match by name only. */
const DOCUMENT_FILE = /\.(?:md|mdx|markdown|txt|rst|adoc|json|ya?ml|toml)$/iu;

/**
 * The document files under a folder, as package paths. `paths` names files: a folder would be read as one file and
 * found missing, so each document is listed on its own (capped at `MAX_PATHS`).
 */
const documentsUnder = (files: readonly string[], folder: string, matches: RegExp): string[] =>
  files
    .filter((file) => file.startsWith(`${folder}/`) && matches.test(file) && !isOwned(file))
    .slice(0, MAX_PATHS)
    .map((file) => packagePathOf(file))
    .filter((path): path is string => path !== undefined);

const folderOf = (file: string): string => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');

/** True for a file inside a dot folder or a folder another detector owns. */
const isOwned = (file: string): boolean =>
  file
    .toLowerCase()
    .split('/')
    .slice(0, -1)
    .some((part) => part.startsWith('.') || OWNED_FOLDERS.has(part));

/** Outermost `docs` folders: the folder through the first `docs` segment of each file, nested ones dropped. */
const docsRootsOf = (files: readonly string[]): string[] => {
  const roots = new Set<string>();
  for (const file of files) {
    if (isOwned(file)) continue;
    const parts = file.split('/').slice(0, -1);
    const index = parts.findIndex((part) => part.toLowerCase() === 'docs');
    if (index !== -1) roots.add(parts.slice(0, index + 1).join('/'));
  }
  const sorted = [...roots].toSorted();
  return sorted.filter((root) => !sorted.some((other) => other !== root && root.startsWith(`${other}/`)));
};

const insideAny = (folder: string, roots: readonly string[]): boolean =>
  roots.some((root) => folder === root || folder.startsWith(`${root}/`));

export const knowledgeMisc: Detector = {
  id: 'knowledge-misc',
  version: 1,
  detect: (inventory: RepoInventory): DetectorResult => {
    const context = createContext(inventory);
    const used = new Set<string>();
    const files = inventory.files;
    const fileSet = new Set(files);

    const awesome = files.find((file) => folderOf(file) === '' && AWESOME_FILE.test(file));
    const awesomePath = awesome === undefined ? undefined : packagePathOf(awesome);
    if (awesome !== undefined && awesomePath !== undefined) {
      addConnection(
        context,
        {
          kind: 'knowledge',
          id: uniqueId(used, 'awesome-list'),
          title: 'Awesome list',
          paths: [awesomePath],
          origin: 'classifier',
        },
        awesome
      );
    }

    const docRoots = docsRootsOf(files);
    for (const root of docRoots) {
      const paths = documentsUnder(files, root, DOCUMENT_FILE);
      if (paths.length === 0) continue;
      addConnection(
        context,
        {
          kind: 'knowledge',
          id: uniqueId(used, toId(root) || 'docs'),
          title: plain(root, 120) || 'docs',
          paths,
          origin: 'classifier',
        },
        root
      );
    }

    const notebooks = files.filter((file) => /\.ipynb$/iu.test(file) && !isOwned(file));
    const notebookPaths = notebooks
      .slice(0, MAX_PATHS)
      .map((file) => packagePathOf(file))
      .filter((path): path is string => path !== undefined);
    if (notebookPaths.length > 0) {
      addConnection(
        context,
        {
          kind: 'knowledge',
          id: uniqueId(used, 'notebooks'),
          title: 'Notebooks',
          paths: notebookPaths,
          origin: 'classifier',
        },
        notebooks[0] ?? ''
      );
    }

    const markdown = new Map<string, number>();
    for (const file of files) {
      if (!/\.md$/iu.test(file) || isOwned(file)) continue;
      const folder = folderOf(file);
      if (folder === '' || insideAny(folder, docRoots)) continue;
      markdown.set(folder, (markdown.get(folder) ?? 0) + 1);
    }
    for (const [folder, count] of [...markdown].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (count < MIN_MARKDOWN || fileSet.has(`${folder}/SKILL.md`)) continue;
      const paths = documentsUnder(files, folder, /\.md$/iu);
      if (paths.length === 0) continue;
      addConnection(
        context,
        {
          kind: 'knowledge',
          id: uniqueId(used, toId(`md-${folder}`) || 'md'),
          title: plain(folder, 120),
          paths,
          origin: 'classifier',
        },
        folder
      );
    }

    const models = files.filter((file) => MODEL_FILE.test(file.toLowerCase()) && !isOwned(file));
    for (const file of models.slice(0, MAX_MODEL_NOTES)) {
      report(context, 'unrecognized', 'Tệp mô hình: chọn thư mục model trên máy; không đóng gói trọng số', {
        path: file,
      });
    }
    if (models.length > MAX_MODEL_NOTES) {
      report(
        context,
        'unrecognized',
        `Còn ${models.length - MAX_MODEL_NOTES} tệp mô hình khác; không đóng gói trọng số`
      );
    }

    const count = context.connections.filter((connection) => connection.kind === 'knowledge').length;
    return {
      connections: context.connections,
      openItems: context.openItems,
      reasons: count > 0 ? [`Detected ${count} knowledge collections`] : [],
      claimed: [...context.claimed].toSorted(),
    };
  },
};
