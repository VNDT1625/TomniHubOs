/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Chrome extensions of the `browser-ext` detector (design sections 7.3, 12.2 and 12.3): a built extension folder
 * (`manifest.json`) and a project that still has to be built (WXT, Plasmo, `@crxjs/vite-plugin`).
 *
 * Nothing here runs a build. For an unbuilt project the connection is marked `needsBuild`, its `root` is the folder
 * the build normally writes, and an open item records the build command for the user or an agent to run.
 */

import { z } from 'zod';
import { baseName, dirName, parseLooseJson, sourcePath } from '../agent/mcpShared';
import { supportOfPermission, UNSUPPORTED_MANIFEST_KEYS, unsupportedReason } from './chromeApiSupport';
import {
  addConnection,
  capList,
  isAllHosts,
  isRecord,
  report,
  reportUnrecognized,
  stringList,
  titleOf,
  uniqueId,
  type Context,
} from './support';

type Tool = 'wxt' | 'plasmo' | 'crxjs';

/** Where each build tool writes its Chrome build and how to build when the package has no `build` script. */
const TOOLS: Readonly<Record<Tool, Readonly<{ label: string; output: string; direct: string }>>> = {
  wxt: { label: 'WXT', output: '.output/chrome-mv3', direct: 'wxt build' },
  plasmo: { label: 'Plasmo', output: 'build/chrome-mv3-prod', direct: 'plasmo build' },
  crxjs: { label: '@crxjs/vite-plugin', output: 'dist', direct: 'vite build' },
};
const TOOL_PACKAGES: readonly (readonly [string, Tool])[] = [
  ['wxt', 'wxt'],
  ['plasmo', 'plasmo'],
  ['@crxjs/vite-plugin', 'crxjs'],
];
const WXT_CONFIG = /^wxt\.config\.[a-z]+$/iu;
const OUTPUT_FOLDERS: ReadonlySet<string> = new Set(['.output', 'build', 'dist', 'out']);
/** Keys that mark a `manifest.json` as a browser extension (design 7.3), plus `host_permissions` of Manifest V3. */
const SIGNAL_KEYS = [
  'background',
  'content_scripts',
  'action',
  'browser_action',
  'page_action',
  'permissions',
  'host_permissions',
  'chrome_url_overrides',
] as const;
const HOST_PATTERN = /^(?:<all_urls>|[A-Za-z*][A-Za-z0-9+.*-]*:\/\/)/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const MAX_PUBLIC_KEY = 1000;

const text = (max: number) => z.string().max(max).optional().catch(undefined);
const list = z.array(z.unknown()).optional().catch(undefined);
/** The fields of a manifest the detector reads. Anything else in the file is ignored; bad values become absent. */
const manifestSchema = z.object({
  name: text(300),
  version: text(64),
  key: text(2000),
  permissions: list,
  optional_permissions: list,
  host_permissions: list,
  content_scripts: list,
});

type Manifest = Readonly<{ file: string; dir: string; record: Record<string, unknown>; version: number }>;
type Project = {
  readonly dir: string;
  readonly tool: Tool;
  readonly packageFile?: string;
  readonly pkg?: Record<string, unknown>;
};

const join = (dir: string, sub: string): string => (dir === '' ? sub : `${dir}/${sub}`);
const hasKey = (record: Record<string, unknown>, key: string): boolean =>
  Object.hasOwn(record, key) && record[key] !== null && record[key] !== undefined;

/** Manifests that are browser extensions; a malformed one is reported. MCPB bundles (`server`) and web manifests are skipped. */
const findManifests = (context: Context): Manifest[] => {
  const found: Manifest[] = [];
  for (const file of context.inventory.files) {
    if (baseName(file) !== 'manifest.json') continue;
    const body = context.inventory.text(file);
    if (body === undefined) continue;
    const record = parseLooseJson(body);
    if (record === undefined) {
      if (/"manifest_version"\s*:\s*\d/u.test(body)) {
        context.claimed.add(file);
        reportUnrecognized(context, file, 'manifest.json của extension không đọc được (JSON hỏng hoặc bị cắt).');
      }
      continue;
    }
    if (!isRecord(record) || typeof record.manifest_version !== 'number' || isRecord(record.server)) continue;
    if (!SIGNAL_KEYS.some((key) => hasKey(record, key))) continue;
    found.push({ file, dir: dirName(file), record, version: record.manifest_version });
  }
  return found;
};

const parsePackage = (context: Context, file: string): Record<string, unknown> | undefined => {
  const body = context.inventory.text(file);
  const parsed = body === undefined ? undefined : parseLooseJson(body);
  return isRecord(parsed) ? parsed : undefined;
};

/** Build-tool projects: a folder with `wxt.config.*`, or a `package.json` that depends on WXT, Plasmo or crxjs. */
const findProjects = (context: Context): Project[] => {
  const byDir = new Map<string, Project>();
  for (const file of context.inventory.files) {
    const name = baseName(file);
    const dir = dirName(file);
    if (WXT_CONFIG.test(name)) {
      context.claimed.add(file);
      if (!byDir.has(dir)) byDir.set(dir, { dir, tool: 'wxt' });
    }
  }
  for (const file of context.inventory.files) {
    if (baseName(file) !== 'package.json') continue;
    const pkg = parsePackage(context, file);
    if (pkg === undefined) continue;
    const dependencies = [pkg.dependencies, pkg.devDependencies].filter(isRecord);
    const tool = TOOL_PACKAGES.find(([name]) => dependencies.some((deps) => Object.hasOwn(deps, name)))?.[1];
    const dir = dirName(file);
    const existing = byDir.get(dir);
    if (tool === undefined && existing === undefined) continue;
    context.claimed.add(file);
    byDir.set(dir, { dir, tool: existing?.tool ?? tool ?? 'wxt', packageFile: file, pkg });
  }
  return [...byDir.values()];
};

const packageManagerOf = (context: Context, dir: string): string => {
  const has = (name: string): boolean => context.inventory.files.includes(join(dir, name));
  if (has('bun.lock') || has('bun.lockb')) return 'bun';
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  return 'npm';
};

const buildOpenItem = (context: Context, project: Project, id: string, title: string, outputDir: string): void => {
  const tool = TOOLS[project.tool];
  const scripts = project.pkg?.scripts;
  const manager = packageManagerOf(context, project.dir);
  const build = isRecord(scripts) && typeof scripts.build === 'string' ? `${manager} run build` : `npx ${tool.direct}`;
  report(context, {
    kind: 'needs-build',
    connection: id,
    path: sourcePath(project.dir),
    note: `Extension "${title}" (${tool.label}) chưa build. Trong ${sourcePath(project.dir)} chạy \`${manager} install\` rồi \`${build}\`, sau đó trỏ kết nối vào ${sourcePath(outputDir)}. Bộ nhận diện không chạy lệnh này.`,
  });
};

type BuildOptions = Readonly<{
  /** Set for a project that is not built yet: the connection points at the folder its build will write. */
  build?: Readonly<{ project: Project; outputDir: string }>;
  fallbackName?: string;
}>;

const toExtension = (context: Context, manifest: Manifest, options: BuildOptions = {}): void => {
  const { file, dir, record } = manifest;
  context.claimed.add(file);
  if (manifest.version !== 2 && manifest.version !== 3) {
    reportUnrecognized(
      context,
      file,
      `Extension dùng manifest_version ${manifest.version}; chỉ nhận Manifest V3, và ghi nhận V2 để báo.`
    );
    return;
  }
  const parsed = manifestSchema.parse(record);
  const declared = stringList(parsed.permissions);
  const optional = stringList(parsed.optional_permissions);
  const hostLike = [...declared, ...optional].filter((value) => HOST_PATTERN.test(value));
  const [permissions, permissionsCut] = capList(declared.filter((value) => !HOST_PATTERN.test(value)));
  const [hostPermissions] = capList([
    ...new Set([...stringList(parsed.host_permissions, 500), ...hostLike.filter((value) => value.length <= 500)]),
  ]);
  const scripts = (parsed.content_scripts ?? []).filter(isRecord);
  const [matches] = capList([...new Set(scripts.flatMap((script) => stringList(script.matches, 500)))]);

  const apiProblems = [
    ...permissions,
    ...optional.filter((value) => !HOST_PATTERN.test(value)),
    ...Object.entries(UNSUPPORTED_MANIFEST_KEYS)
      .filter(([key]) => hasKey(record, key))
      .map(([, api]) => api),
  ].filter((value, index, all) => all.indexOf(value) === index && supportOfPermission(value) === 'unsupported');
  const backgroundV2 = manifest.version === 2 && hasKey(record, 'background');
  const background = record.background;
  const workerless = manifest.version === 3 && isRecord(background) && typeof background.service_worker !== 'string';
  const unsupported = [
    ...apiProblems,
    ...(backgroundV2 ? ['background (cần bản Manifest V3)'] : []),
    ...(workerless ? ['background.scripts (cần service_worker)'] : []),
  ];
  const [unsupportedKept] = capList(unsupported);

  const plainName = parsed.name !== undefined && !parsed.name.startsWith('__MSG_') ? parsed.name : undefined;
  const id = uniqueId(context, [plainName ?? '', options.fallbackName ?? '', dir.split('/').at(-1) ?? '', 'extension']);
  const title = titleOf(plainName, options.fallbackName ?? id);
  const publicKey =
    parsed.key !== undefined && parsed.key.length <= MAX_PUBLIC_KEY && BASE64.test(parsed.key) ? parsed.key : undefined;
  const needsBuild = options.build !== undefined;
  const root = sourcePath(options.build?.outputDir ?? dir);

  const connection = addConnection(
    context,
    {
      kind: 'extension',
      id,
      title,
      format: manifest.version === 3 ? 'chrome-mv3' : 'chrome-mv2',
      root,
      ...(parsed.version !== undefined && parsed.version !== '' ? { version: parsed.version } : {}),
      permissions,
      hostPermissions,
      ...(matches.length > 0 ? { matches } : {}),
      unsupported: unsupportedKept,
      ...(needsBuild ? { needsBuild: true } : {}),
      ...(publicKey === undefined ? {} : { publicKey }),
      origin: 'chrome-extension',
    },
    file
  );
  if (connection === undefined) return;

  context.reasons.push(
    `Extension ${manifest.version === 3 ? 'MV3' : 'MV2'} "${title}" (${dir === '' ? 'gốc repo' : dir}): ${permissions.length} quyền, ${unsupportedKept.length} mục chưa hỗ trợ${needsBuild ? ', chưa build' : ''}`
  );
  if (backgroundV2) {
    report(context, {
      kind: 'needs-runtime',
      connection: id,
      path: sourcePath(file),
      note: `Extension "${title}" dùng Manifest V2 có background: Electron không chạy background script, cần bản Manifest V3.`,
    });
  }
  if (apiProblems.length > 0 || workerless) {
    const names = [
      ...apiProblems.map((api) => `${api} (${unsupportedReason(api)})`),
      ...(workerless ? ['background.scripts'] : []),
    ];
    report(context, {
      kind: 'needs-runtime',
      connection: id,
      path: sourcePath(file),
      note: `Extension "${title}" cần API Hub chưa có ở v1, nên chỉ dùng được một phần: ${names.join('; ')}.`,
    });
  }
  if (permissionsCut) reportUnrecognized(context, file, 'Extension khai báo hơn 100 quyền; chỉ giữ 100 quyền đầu.');
  if ([...hostPermissions, ...matches].some(isAllHosts)) {
    report(context, {
      kind: 'needs-consent',
      connection: id,
      path: sourcePath(file),
      note: `Extension "${title}" xin quyền trên mọi trang (<all_urls> hoặc *://*/*); cần người dùng đồng ý riêng, mặc định chỉ chạy khi bấm.`,
    });
  }
  if (options.build !== undefined) buildOpenItem(context, options.build.project, id, title, options.build.outputDir);
};

/** The innermost build project that contains `dir`. */
const projectFor = (projects: readonly Project[], dir: string): Project | undefined =>
  projects
    .filter((project) => project.dir === '' || dir === project.dir || dir.startsWith(`${project.dir}/`))
    .toSorted((left, right) => right.dir.length - left.dir.length)[0];

/** A project with no source manifest: what is known comes from its `package.json` (Plasmo keeps permissions there). */
const fallbackManifest = (project: Project, output: string): Manifest => {
  const pkg = project.pkg ?? {};
  const own = isRecord(pkg.manifest) ? pkg.manifest : {};
  const name = typeof pkg.displayName === 'string' ? pkg.displayName : pkg.name;
  const record: Record<string, unknown> = {
    manifest_version: 3,
    ...(typeof name === 'string' ? { name } : {}),
    ...(typeof pkg.version === 'string' ? { version: pkg.version } : {}),
    ...(Array.isArray(own.permissions) ? { permissions: own.permissions } : {}),
    ...(Array.isArray(own.host_permissions) ? { host_permissions: own.host_permissions } : {}),
  };
  return { file: project.packageFile ?? join(project.dir, 'package.json'), dir: output, record, version: 3 };
};

/** Finds Chrome extensions and unbuilt extension projects. */
export const detectChromeExtensions = (context: Context): void => {
  const manifests = findManifests(context);
  const projects = findProjects(context);
  const built = new Set<string>();
  const sources = new Map<string, Manifest>();

  for (const manifest of manifests) {
    const project = projectFor(projects, manifest.dir);
    if (project === undefined) {
      toExtension(context, manifest);
      continue;
    }
    const inside = project.dir === '' ? manifest.dir : manifest.dir.slice(project.dir.length + 1);
    if (OUTPUT_FOLDERS.has(inside.split('/')[0] ?? '')) {
      built.add(project.dir);
      toExtension(context, manifest);
    } else if (manifest.dir === project.dir || inside === 'src') {
      if (!sources.has(project.dir)) sources.set(project.dir, manifest);
      context.claimed.add(manifest.file);
    } else {
      toExtension(context, manifest);
    }
  }

  for (const project of projects) {
    if (built.has(project.dir)) continue;
    const output = join(project.dir, TOOLS[project.tool].output);
    const source = sources.get(project.dir);
    const manifest = source ?? fallbackManifest(project, output);
    const fallbackName = typeof project.pkg?.name === 'string' ? project.pkg.name : project.dir.split('/').at(-1);
    toExtension(context, manifest, {
      build: { project, outputDir: output },
      ...(fallbackName === undefined ? {} : { fallbackName }),
    });
  }
};
