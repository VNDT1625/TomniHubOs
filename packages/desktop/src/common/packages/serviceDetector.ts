/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Finds the parts of a repository that can be started and shown, with plain rules and no model: a web
 * front end (Next.js, Vite, Streamlit, Gradio, Flask…) and the back ends beside it. The commands come
 * from fixed templates for each framework, never from text found in the repository, and each service
 * lists the variables its `.env.example` asks for so an agent can fill them in later.
 *
 * Whatever is not recognised (a mobile app, a notebook, data) is simply not connected; it stays in `source/`.
 */

export type DetectedEnvironmentVariable = Readonly<{ name: string; required: boolean; hint?: string }>;

export type DetectedService = Readonly<{
  id: string;
  /** Folder of the service, relative to the repository root; '' is the root. */
  directory: string;
  setup: readonly (readonly string[])[];
  start: readonly string[];
  port: number;
  /** True when the service serves a page worth showing; false for an API behind it. */
  embeddable: boolean;
  framework: string;
  env: readonly DetectedEnvironmentVariable[];
}>;

export type ServiceDetection = Readonly<{
  services: readonly DetectedService[];
  /** The service whose page is shown. */
  embed?: string;
  /** Things the user should know that are not a service (a compose file that may start a database). */
  notes: readonly string[];
}>;

type NodeFramework = Readonly<{ dependency: string; label: string; scripts: readonly string[]; port: number }>;

// Order matters: a Next.js app also depends on React, a Nuxt app on Vite, and so on.
const NODE_FRAMEWORKS: readonly NodeFramework[] = [
  { dependency: 'next', label: 'Next.js', scripts: ['dev'], port: 3000 },
  { dependency: 'nuxt', label: 'Nuxt', scripts: ['dev'], port: 3000 },
  { dependency: 'astro', label: 'Astro', scripts: ['dev'], port: 4321 },
  { dependency: '@sveltejs/kit', label: 'SvelteKit', scripts: ['dev'], port: 5173 },
  { dependency: 'vite', label: 'Vite', scripts: ['dev'], port: 5173 },
  { dependency: 'react-scripts', label: 'Create React App', scripts: ['start'], port: 3000 },
  { dependency: '@angular/cli', label: 'Angular', scripts: ['start'], port: 4200 },
  { dependency: '@vue/cli-service', label: 'Vue CLI', scripts: ['serve'], port: 8080 },
];

const MAX_SERVICES = 8;
const MAX_ENVIRONMENT_VARIABLES = 20;
const ENV_LINE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u;
const PORT_FLAG = /(?:--port|-p)[ =](\d{4,5})\b|\bPORT=(\d{4,5})\b/u;
const STREAMLIT_ENTRIES = ['streamlit_app.py', 'app.py', 'main.py', 'Home.py'] as const;
const GRADIO_ENTRIES = ['app.py', 'main.py', 'demo.py', 'gradio_app.py', 'webui.py'] as const;
const FLASK_ENTRIES = ['app.py', 'main.py'] as const;

/** A variable the source reads, found in one file. */
export type EnvironmentUsage = Readonly<{ path: string; name: string; required: boolean }>;

// Variables every program reads that are not the project's own configuration.
const IGNORED_VARIABLES: ReadonlySet<string> = new Set([
  'NODE_ENV',
  'PATH',
  'HOME',
  'USER',
  'USERNAME',
  'PWD',
  'SHELL',
  'TERM',
  'LANG',
  'TMP',
  'TEMP',
  'TMPDIR',
  'CI',
  'HOSTNAME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PYTHONPATH',
  'VIRTUAL_ENV',
]);
const PY_ENVIRON_INDEX = /os\.environ\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/gu;
const PY_GETTER = /os\.(?:environ\.get|getenv)\(\s*["']([A-Z][A-Z0-9_]*)["']\s*(,[^)]*)?\)/gu;
const JS_DOT = /(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)(!?)(\s*(?:\?\?|\|\|))?/gu;
const JS_INDEX = /(?:process\.env|import\.meta\.env)\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\](!?)(\s*(?:\?\?|\|\|))?/gu;
const PY_SETTINGS_CLASS = /^class\s+\w+\([^)]*BaseSettings[^)]*\)\s*:\s*$/u;
const PY_SETTINGS_FIELD = /^ {4}([a-z][a-z0-9_]*)\s*:\s*[^=#\n]+?(=.*)?$/u;

/** The variables one source file reads, and whether it fails without them. */
export const scanEnvironmentUsage = (path: string, content: string): EnvironmentUsage[] => {
  const usage = new Map<string, boolean>();
  const add = (name: string | undefined, required: boolean): void => {
    if (name === undefined || IGNORED_VARIABLES.has(name)) return;
    usage.set(name, (usage.get(name) ?? false) || required);
  };
  if (path.endsWith('.py')) {
    for (const match of content.matchAll(PY_ENVIRON_INDEX)) add(match[1], true);
    // A second argument is a default, so the program still starts without the variable.
    for (const match of content.matchAll(PY_GETTER)) add(match[1], match[2] === undefined);
    let inSettings = false;
    for (const line of content.split(/\r?\n/u)) {
      if (PY_SETTINGS_CLASS.test(line)) inSettings = true;
      else if (/^\S/u.test(line)) inSettings = false;
      else if (inSettings) {
        const field = PY_SETTINGS_FIELD.exec(line);
        if (field?.[1] !== undefined) add(field[1].toUpperCase(), field[2] === undefined);
      }
    }
  } else {
    for (const pattern of [JS_DOT, JS_INDEX]) {
      for (const match of content.matchAll(pattern)) add(match[1], match[3] === undefined);
    }
  }
  return [...usage].map(([name, required]) => ({ path, name, required }));
};

const parseRecord = (raw: string | undefined): Record<string, unknown> | undefined => {
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const join = (directory: string, name: string): string => (directory === '' ? name : `${directory}/${name}`);
const directoryOf = (file: string): string => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
const baseName = (file: string): string => file.slice(file.lastIndexOf('/') + 1);

export const serviceIdFor = (directory: string, fallback: string): string => {
  const raw = directory === '' ? fallback : baseName(directory);
  const id = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z0-9]+|-+$/gu, '')
    .slice(0, 40);
  return id === '' ? fallback : id;
};

const ENV_EXAMPLE_NAMES = ['.env.example', '.env.sample', '.env.template', 'example.env'] as const;

/**
 * Variables of one service: the example file first (it is the author's own list; an empty value means the
 * user must supply it), then the ones the code of that folder reads that the example does not mention.
 */
const environmentFor = (
  directory: string,
  snippets: Readonly<Record<string, string>>,
  usage: readonly EnvironmentUsage[]
): DetectedEnvironmentVariable[] => {
  const variables = new Map<string, DetectedEnvironmentVariable>();
  const raw = ENV_EXAMPLE_NAMES.map(
    (name) => snippets[join(directory, name)] ?? (directory === '' ? undefined : snippets[name])
  ).find((text) => text !== undefined);
  for (const line of (raw ?? '').split(/\r?\n/u)) {
    if (line.trimStart().startsWith('#')) continue;
    const match = ENV_LINE.exec(line);
    if (!match?.[1]) continue;
    const value = (match[2] ?? '').replace(/^["']|["']$/gu, '');
    if (!variables.has(match[1]))
      variables.set(match[1], { name: match[1], required: value === '', hint: '.env.example' });
  }
  const prefix = directory === '' ? '' : `${directory}/`;
  const fromCode = new Map<string, EnvironmentUsage>();
  for (const entry of usage) {
    if (!entry.path.startsWith(prefix) || variables.has(entry.name)) continue;
    const earlier = fromCode.get(entry.name);
    if (earlier === undefined || (entry.required && !earlier.required)) fromCode.set(entry.name, entry);
  }
  for (const entry of [...fromCode.values()].toSorted(
    (a, b) => Number(b.required) - Number(a.required) || (a.name < b.name ? -1 : 1)
  )) {
    variables.set(entry.name, { name: entry.name, required: entry.required, hint: entry.path });
  }
  return [...variables.values()].slice(0, MAX_ENVIRONMENT_VARIABLES);
};

export const packageManagerFor = (directory: string, files: ReadonlySet<string>): 'npm' | 'pnpm' | 'yarn' | 'bun' => {
  const has = (name: string): boolean => files.has(join(directory, name)) || (directory !== '' && files.has(name));
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  return 'npm';
};

const nodeService = (
  directory: string,
  manifest: Record<string, unknown>,
  files: ReadonlySet<string>,
  snippets: Readonly<Record<string, string>>,
  usage: readonly EnvironmentUsage[]
): DetectedService | undefined => {
  const dependencies = new Set<string>();
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const key of Object.keys(record(manifest[field]))) dependencies.add(key.toLowerCase());
  }
  const scripts = record(manifest.scripts);
  for (const framework of NODE_FRAMEWORKS) {
    if (!dependencies.has(framework.dependency)) continue;
    const script = framework.scripts.find((name) => typeof scripts[name] === 'string');
    if (script === undefined) continue;
    const scriptText = String(scripts[script]);
    const portMatch = PORT_FLAG.exec(scriptText);
    const port = Number(portMatch?.[1] ?? portMatch?.[2] ?? framework.port);
    const manager = packageManagerFor(directory, files);
    const start =
      manager === 'yarn' ? ['yarn', script] : manager === 'npm' ? ['npm', 'run', script] : [manager, 'run', script];
    return {
      id: serviceIdFor(directory, 'web'),
      directory,
      setup: [[manager, 'install']],
      start,
      port: port >= 1024 && port <= 65_535 ? port : framework.port,
      embeddable: true,
      framework: framework.label,
      env: environmentFor(directory, snippets, usage),
    };
  }
  return undefined;
};

export const pythonSetup = (directory: string, files: ReadonlySet<string>): string[][] => {
  if (files.has(join(directory, 'requirements.txt'))) return [['pip', 'install', '-r', 'requirements.txt']];
  if (files.has(join(directory, 'pyproject.toml'))) return [['pip', 'install', '-e', '.']];
  return [];
};

const mentions = (text: string, name: string): boolean =>
  new RegExp(`(?:^|[^a-z0-9_-])${name}(?:[^a-z0-9_-]|$)`, 'u').test(text);

const pythonService = (
  directory: string,
  text: string,
  files: ReadonlySet<string>,
  snippets: Readonly<Record<string, string>>,
  usage: readonly EnvironmentUsage[]
): DetectedService | undefined => {
  const lower = text.toLowerCase();
  const entry = (candidates: readonly string[]): string | undefined =>
    candidates.find((name) => files.has(join(directory, name)));
  const common = { directory, setup: pythonSetup(directory, files), env: environmentFor(directory, snippets, usage) };

  if (mentions(lower, 'streamlit')) {
    const file = entry(STREAMLIT_ENTRIES);
    if (file !== undefined) {
      return {
        ...common,
        id: serviceIdFor(directory, 'streamlit'),
        start: ['streamlit', 'run', file, '--server.port', '8501', '--server.headless', 'true'],
        port: 8501,
        embeddable: true,
        framework: 'Streamlit',
      };
    }
  }
  if (mentions(lower, 'gradio')) {
    const file = entry(GRADIO_ENTRIES);
    if (file !== undefined) {
      return {
        ...common,
        id: serviceIdFor(directory, 'gradio'),
        start: ['python', file],
        port: 7860,
        embeddable: true,
        framework: 'Gradio',
      };
    }
  }
  if (mentions(lower, 'fastapi')) {
    const module = files.has(join(directory, 'app/main.py'))
      ? 'app.main:app'
      : files.has(join(directory, 'main.py'))
        ? 'main:app'
        : undefined;
    if (module !== undefined) {
      return {
        ...common,
        id: serviceIdFor(directory, 'api'),
        start: ['uvicorn', module, '--port', '8000'],
        port: 8000,
        embeddable: false,
        framework: 'FastAPI',
      };
    }
  }
  if (mentions(lower, 'flask')) {
    const file = entry(FLASK_ENTRIES);
    if (file !== undefined) {
      return {
        ...common,
        id: serviceIdFor(directory, 'flask'),
        start: ['flask', '--app', file.replace(/\.py$/u, ''), 'run', '--port', '5000'],
        port: 5000,
        embeddable: true,
        framework: 'Flask',
      };
    }
  }
  return undefined;
};

/**
 * @param files Relative paths with forward slashes.
 * @param snippets Contents of the small files that decide the answer (package.json, pyproject.toml,
 *   requirements.txt, .env.example, compose files), keyed by relative path.
 * @param usage Variables the source files read, from {@link scanEnvironmentUsage}.
 */
export const detectServices = (
  files: readonly string[],
  snippets: Readonly<Record<string, string>>,
  usage: readonly EnvironmentUsage[] = []
): ServiceDetection => {
  const fileSet = new Set(files);
  const found: DetectedService[] = [];
  const notes: string[] = [];
  const usedIds = new Set<string>();

  for (const path of Object.keys(snippets).toSorted()) {
    if (found.length >= MAX_SERVICES) break;
    const name = baseName(path);
    const directory = directoryOf(path);
    let service: DetectedService | undefined;
    if (name === 'package.json') {
      const manifest = parseRecord(snippets[path]);
      if (manifest !== undefined) service = nodeService(directory, manifest, fileSet, snippets, usage);
    } else if (name === 'pyproject.toml' || name === 'requirements.txt') {
      // pyproject.toml and requirements.txt of one folder describe the same service; the first one wins.
      const sibling = name === 'requirements.txt' ? 'pyproject.toml' : undefined;
      if (sibling !== undefined && snippets[join(directory, sibling)] !== undefined) continue;
      const combined = `${snippets[join(directory, 'pyproject.toml')] ?? ''}\n${snippets[join(directory, 'requirements.txt')] ?? ''}`;
      service = pythonService(directory, combined, fileSet, snippets, usage);
    } else if (/^(?:docker-)?compose\.ya?ml$/u.test(name)) {
      notes.push(`Có ${path}: dịch vụ đi kèm (ví dụ cơ sở dữ liệu) có thể cần Docker; Hub không tự chạy compose.`);
    }
    if (service === undefined || usedIds.has(service.id)) continue;
    usedIds.add(service.id);
    found.push(service);
  }

  // Back ends start first so the page that needs them finds them ready.
  const services = [
    ...found.filter((service) => !service.embeddable),
    ...found.filter((service) => service.embeddable),
  ];
  const embed = services.find((service) => service.embeddable)?.id;
  return { services, ...(embed === undefined ? {} : { embed }), notes };
};

export type UnclaimedProject = Readonly<{ directory: string; marker: string }>;

// Files that mark a folder as a project of its own.
const PROJECT_MARKERS: ReadonlySet<string> = new Set([
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'Dockerfile',
  'go.mod',
  'Cargo.toml',
  'pubspec.yaml',
  'pom.xml',
  'build.gradle',
  'composer.json',
  'Gemfile',
]);
const MAX_UNCLAIMED = 10;
const MAX_PROJECT_DEPTH = 3;

/**
 * Project folders (a package.json, a Dockerfile, a pubspec.yaml…) that no service or skill accounts for. They
 * stay in source/, and the caller hands them to the agent or the user as open items. Only the outermost
 * folder of nested projects is returned.
 */
export const findUnclaimedProjects = (
  files: readonly string[],
  claimedDirectories: readonly string[]
): UnclaimedProject[] => {
  const claimed = claimedDirectories.filter((directory) => directory !== '');
  const isClaimed = (directory: string): boolean =>
    claimed.some((other) => directory === other || directory.startsWith(`${other}/`));
  const found = new Map<string, string>();
  for (const file of files.toSorted()) {
    const directory = directoryOf(file);
    if (directory === '' || directory.split('/').length > MAX_PROJECT_DEPTH) continue;
    if (!PROJECT_MARKERS.has(baseName(file)) || isClaimed(directory)) continue;
    if (/(?:^|\/)(?:node_modules|tests?|__tests__|fixtures|examples?)(?:\/|$)/u.test(directory)) continue;
    if (!found.has(directory)) found.set(directory, baseName(file));
  }
  const directories = [...found.keys()];
  return directories
    .filter((directory) => !directories.some((other) => other !== directory && directory.startsWith(`${other}/`)))
    .slice(0, MAX_UNCLAIMED)
    .map((directory) => ({ directory, marker: found.get(directory) ?? '' }));
};
