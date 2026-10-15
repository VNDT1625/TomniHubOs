/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `services` detector (design sections 6.2 and 7.3): programs the repository runs in the background or shows as an
 * app. It wraps the classifier's own recognition (`detectServices`, which reads package manifests and compose files
 * and never runs anything) and adds what it does not produce:
 * - Docker Compose files: a `launcher` with a `compose` target in `source/`. The first published host port also gives a
 *   `web-embed` `url` on the loopback address (`http://127.0.0.1:<port>/`); the others are reported as an open item.
 * - Chat bots (Discord or Telegram libraries): a headless `service` (no window, no port) started from the bot's folder.
 *   Its start command comes from the `start` script or the `main` file of a Node bot, or from a `bot.py` or `main.py` of a
 *   Python bot. A bot whose entry point cannot be read is an open item instead. Each token variable is an `env-value`
 *   open item, and the service names it as a required variable; values are never read or stored.
 * A detected front end becomes one `web-embed` whose `process.services` are the front end and its back ends; with no
 * front end, each back end is a `service`. Environment values are never read: only variable names are kept.
 */

import {
  detectServices,
  packageManagerFor,
  pythonSetup,
  serviceIdFor,
  type DetectedService,
} from '@/common/packages/serviceDetector';
import { addConnection, createContext, packagePathOf, report, uniqueId, type Context } from '../agent/plugin/support';
import { isDeclarationFile } from '../inventory';
import type { Detector, DetectorResult, RepoInventory } from '../types';

const MAX_PORTS = 16;
const COMPOSE_FILE = /(?:^|\/)(?:docker-)?compose\.ya?ml$/u;
const NODE_BOT = /"(?:discord\.js|telegraf|grammy|node-telegram-bot-api)"\s*:/u;
const PYTHON_BOT = /\b(?:discord\.py|python-telegram-bot|aiogram)\b/iu;
const TOKEN_NAME = /^((?:DISCORD|TELEGRAM|BOT)_[A-Z0-9_]*TOKEN)[ \t]*=/gmu;
const PUBLISHED_PORT = /^[ \t]*-[ \t]*["']?(?:[\d.]+:)?(\d{1,5}):\d{1,5}/gmu;
/** Files a Python bot may be started from, in order; the first one in the bot's folder wins. */
const PYTHON_BOT_ENTRIES: readonly string[] = ['bot.py', 'main.py'];
/** A Node `main` file: a plain relative path of a script, without `..` (checked again below). */
const NODE_MAIN = /^[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:js|mjs|cjs)$/u;

const folderOf = (file: string): string => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
const baseOf = (file: string): string => file.slice(file.lastIndexOf('/') + 1).toLowerCase();
const inFolder = (folder: string, name: string): string => (folder === '' ? name : `${folder}/${name}`);
const cwdOf = (directory: string): string => (directory === '' ? 'source' : `source/${directory}`);

const isManifest = (base: string): boolean =>
  base === 'package.json' || base === 'pyproject.toml' || /^requirements[^/]*\.txt$/u.test(base);

/** Variable names of bot tokens, read from an example file. Values are never kept. */
const tokenNames = (text: string | undefined): string[] => {
  if (text === undefined) return [];
  const names = [...text.matchAll(TOKEN_NAME)].map((match) => match[1] ?? '').filter((name) => name !== '');
  return [...new Set(names)].slice(0, 8);
};

/** Host ports a compose file publishes (`"8080:80"`, `127.0.0.1:8080:80`). Only the host side is kept. */
const publishedPorts = (text: string): number[] => {
  const ports = [...text.matchAll(PUBLISHED_PORT)]
    .map((match) => Number(match[1]))
    .filter((port) => Number.isInteger(port) && port > 0 && port < 65536);
  return [...new Set(ports)].slice(0, MAX_PORTS);
};

const parseJsonObject = (text: string): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

/** A detected service as the process entry of a `web-embed` or `service` connection. */
const processOf = (service: DetectedService) => ({
  id: service.id,
  cwd: cwdOf(service.directory),
  ...(service.setup.length > 0 ? { setup: service.setup.map((command) => [...command]) } : {}),
  start: [...service.start],
  ready: { port: service.port },
  ...(service.env.length > 0
    ? {
        env: service.env.map((variable) => ({
          name: variable.name,
          required: variable.required,
          ...(variable.hint === undefined ? {} : { hint: variable.hint }),
        })),
      }
    : {}),
});

const emitServices = (context: Context, used: Set<string>, detection: ReturnType<typeof detectServices>): void => {
  const embeddable = detection.services.filter((service) => service.embeddable);
  const embedId = detection.embed;
  if (embedId !== undefined) {
    const embedded = detection.services.find((service) => service.id === embedId);
    const id = uniqueId(used, embedId);
    addConnection(
      context,
      {
        kind: 'web-embed',
        id,
        title: embedId,
        process: { services: detection.services.map(processOf), embed: { service: embedId } },
        origin: 'framework',
      },
      embedded?.directory ?? ''
    );
    if (embeddable.length > 1) {
      context.openItems.push({
        kind: 'choose',
        connection: id,
        note: `Có ${embeddable.length} giao diện có thể nhúng; đang hiển thị "${embedId}".`,
        options: embeddable.map((service) => service.id).slice(0, 8),
      });
    }
    return;
  }
  for (const service of detection.services) {
    const id = uniqueId(used, service.id);
    addConnection(
      context,
      { kind: 'service', id, title: service.id, process: { services: [processOf(service)] }, origin: 'framework' },
      service.directory
    );
  }
};

const emitCompose = (context: Context, file: string, text: string | undefined, used: Set<string>): void => {
  context.claimed.add(file);
  if (text === undefined) {
    report(context, 'unrecognized', 'Compose không đọc được (quá lớn hoặc vượt ngân sách đọc)', { path: file });
    return;
  }
  const packageFile = packagePathOf(file);
  if (packageFile === undefined) {
    report(context, 'unrecognized', 'Compose có đường dẫn quá dài để đưa vào gói', { path: file });
    return;
  }
  const id = uniqueId(used, 'compose');
  addConnection(
    context,
    {
      kind: 'launcher',
      id,
      title: 'Docker Compose',
      target: { kind: 'compose', file: packageFile },
      origin: 'compose',
    },
    file
  );
  const ports = publishedPorts(text);
  const first = ports[0];
  if (first === undefined) return;
  // The first published port is shown on loopback only (the schema allows nothing else for plain http).
  const webId = uniqueId(used, 'compose-web');
  addConnection(
    context,
    {
      kind: 'web-embed',
      id: webId,
      title: 'Docker Compose app',
      url: `http://127.0.0.1:${first}/`,
      origin: 'compose',
    },
    file
  );
  if (ports.length > 1) {
    report(context, 'unrecognized', `Compose mở cổng ${ports.join(', ')} trên máy; Tomny chỉ hiển thị cổng ${first}`, {
      path: file,
      connection: webId,
    });
  }
};

/** How a bot program starts: an install once in its folder, then one command. */
type BotProgram = Readonly<{ setup: readonly (readonly string[])[]; start: readonly string[] }>;

/** A Node bot starts with its `start` script, else with its `main` file. */
const nodeBotProgram = (folder: string, text: string, files: ReadonlySet<string>): BotProgram | undefined => {
  const manifest = parseJsonObject(text);
  if (manifest === undefined) return undefined;
  const manager = packageManagerFor(folder, files);
  const setup = [[manager, 'install']];
  const scripts = manifest.scripts;
  if (
    typeof scripts === 'object' &&
    scripts !== null &&
    typeof (scripts as Record<string, unknown>).start === 'string'
  ) {
    return { setup, start: manager === 'yarn' ? ['yarn', 'start'] : [manager, 'run', 'start'] };
  }
  const main = manifest.main;
  if (typeof main === 'string' && NODE_MAIN.test(main) && !main.split('/').includes('..')) {
    return { setup, start: ['node', main] };
  }
  return undefined;
};

/** A Python bot starts from `bot.py` or `main.py` next to its manifest, after the install its folder declares. */
const pythonBotProgram = (folder: string, files: ReadonlySet<string>): BotProgram | undefined => {
  const entry = PYTHON_BOT_ENTRIES.find((name) => files.has(inFolder(folder, name)));
  if (entry === undefined) return undefined;
  return { setup: pythonSetup(folder, files), start: ['python', entry] };
};

const emitBots = (
  context: Context,
  inventory: RepoInventory,
  file: string,
  used: Set<string>,
  files: ReadonlySet<string>
): void => {
  const text = inventory.text(file);
  if (text === undefined) return;
  const nodeMatch = baseOf(file) === 'package.json' ? NODE_BOT.exec(text) : null;
  const pythonMatch = baseOf(file) === 'package.json' ? null : PYTHON_BOT.exec(text);
  const match = nodeMatch ?? pythonMatch;
  if (match === null) return;
  context.claimed.add(file);
  const folder = folderOf(file);
  const label = /discord/iu.test(match[0]) ? 'Discord' : 'Telegram';
  const example = inFolder(folder, '.env.example');
  if (inventory.files.includes(example)) context.claimed.add(example);
  const names = tokenNames(inventory.text(example));
  for (const name of names) {
    report(context, 'env-value', `Cần giá trị cho ${name} (bot)`, { name, path: file });
  }
  const program = nodeMatch === null ? pythonBotProgram(folder, files) : nodeBotProgram(folder, text, files);
  if (program === undefined) {
    report(context, 'needs-runtime', `Chưa rõ tệp khởi động của bot ${label}: cần script start hoặc main`, {
      path: file,
    });
    return;
  }
  const id = uniqueId(used, serviceIdFor(folder, `${label.toLowerCase()}-bot`));
  const added = addConnection(
    context,
    {
      kind: 'service',
      id,
      title: `${label} bot`,
      headless: true,
      process: {
        services: [
          {
            id,
            cwd: cwdOf(folder),
            ...(program.setup.length > 0 ? { setup: program.setup.map((command) => [...command]) } : {}),
            start: [...program.start],
            ...(names.length > 0 ? { env: names.map((name) => ({ name, required: true, hint: '.env.example' })) } : {}),
          },
        ],
      },
      origin: 'framework',
    },
    file
  );
  if (added !== undefined) {
    report(context, 'needs-consent', 'Bot chạy nền (Discord hoặc Telegram): cần đồng ý trước khi bật', { path: file });
  }
};

export const services: Detector = {
  id: 'services',
  version: 1,
  detect: (inventory: RepoInventory): DetectorResult => {
    const context = createContext(inventory);
    const used = new Set<string>();
    const files = new Set(inventory.files);
    const snippets: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const file of inventory.files) {
      if (!isDeclarationFile(file)) continue;
      const text = inventory.text(file);
      if (text !== undefined) snippets[file] = text;
    }

    const detection = detectServices(inventory.files, snippets);
    const serviceFolders = new Set(detection.services.map((service) => service.directory));
    emitServices(context, used, detection);

    for (const file of inventory.files) {
      if (!isDeclarationFile(file)) continue;
      const base = baseOf(file);
      if (COMPOSE_FILE.test(file.toLowerCase())) {
        emitCompose(context, file, inventory.text(file), used);
      } else if (isManifest(base)) {
        // A manifest in a service folder is the one that described the service; the others are not ours to claim.
        if (serviceFolders.has(folderOf(file))) context.claimed.add(file);
        emitBots(context, inventory, file, used, files);
      }
    }

    const count = context.connections.filter((c) => c.kind === 'service' || c.kind === 'web-embed').length;
    return {
      connections: context.connections,
      openItems: context.openItems,
      reasons: [...detection.notes, ...(count > 0 ? [`Detected ${count} runnable services`] : [])],
      claimed: [...context.claimed].toSorted(),
    };
  },
};
