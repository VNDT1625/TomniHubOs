/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main-side catalog of the prompt commands that installed packages offer (design sections 10.3 and 14, S7): the list
 * for the `/` menu and the expansion of a typed `/name args` line into the text the agent receives.
 *
 * Everything is derived from the connection registry on each call, so turning a command off, updating a package or
 * uninstalling it is reflected at once and there is no second copy to keep in step. The list carries no template
 * text; a template file is read only when its command is used, through the registry's guarded reader and the host's
 * size cap. The renderer sees names, descriptions and hints, never paths or file content.
 */

import { GOAL_ALL_COMMAND_NAME, GOAL_COMMAND_NAME } from '@/common/chat/slash/goalCommand';
import { BUILD0_COMMAND_NAME } from '@/common/chat/slash/build0Command';
import { SLASH_MODES } from '@/common/chat/slash/modes';
import type { PackageCommandSummary } from '@/common/chat/slash/types';
import {
  assignPackageCommandNames,
  expandCommandTemplate,
  parsePackageSlash,
  type PackageCommandIdentity,
} from '@/common/integrations/commands/commandTemplate';
import type { ConnectionOf, HostContext } from '@process/integrations/connections/core/types';
import type { ConnectionRegistry } from '@process/integrations/connections/core/registry';
import { loadCommandTemplate } from '@process/integrations/connections/hosts/data/commandHost';

type CommandConnection = ConnectionOf<'command'>;
const isCommand = (connection: { kind?: string }): connection is CommandConnection => connection.kind === 'command';

/** Names the application already uses for `/`; a package command with one of these is offered as `<plugin>:<name>`. */
export const RESERVED_SLASH_NAMES: ReadonlySet<string> = new Set([
  ...SLASH_MODES.map((mode) => mode.name),
  'repotopackage',
  'guide',
  'schedule',
  'remember',
  'forget',
  'export',
  'copy',
  'btw',
  'open',
  'execute',
  GOAL_COMMAND_NAME,
  GOAL_ALL_COMMAND_NAME,
  BUILD0_COMMAND_NAME,
]);

/** Stable error messages thrown to the send path. */
export const PACKAGE_COMMAND_UNAVAILABLE = 'PACKAGE_COMMAND_UNAVAILABLE';
export const PACKAGE_COMMAND_TOO_LARGE = 'PACKAGE_COMMAND_TOO_LARGE';

export type PackageCommandExpansion = Readonly<{ name: string; packageId: string; modelInput: string }>;

export type PackageCommandService = Readonly<{
  /** Enabled package commands as the `/` menu shows them. Never rejects: a failing registry gives an empty list. */
  list: () => Promise<PackageCommandSummary[]>;
  /**
   * `undefined` when the line is not a package command (send it unchanged). Otherwise the text for the agent; the
   * chat bubble keeps the typed line. Throws {@link PACKAGE_COMMAND_UNAVAILABLE} when the command is on but its file
   * can no longer be read, and {@link PACKAGE_COMMAND_TOO_LARGE} when the filled template is too big.
   */
  expand: (input: string) => Promise<PackageCommandExpansion | undefined>;
}>;

/**
 * The `model_input` to send once a command is expanded. The typed line stays in `input` (the bubble); when the
 * renderer already built a `model_input` around it (attachments, references) the typed line inside it is replaced,
 * so those parts are kept. Same rule as `applyModesToModelInput`.
 */
export const applyPackageCommandToModelInput = (
  input: string,
  modelInput: string | undefined,
  expanded: string
): string => {
  if (modelInput === undefined) return expanded;
  // A replacer function, so `$` sequences in the template are not read as replacement patterns.
  return modelInput.includes(input) ? modelInput.replace(input, () => expanded) : `${expanded}\n\n${modelInput}`;
};

type Pending = Readonly<{ packageId: string; key: string; context: HostContext; connection: CommandConnection }>;
type Entry = Readonly<{ packageId: string; context: HostContext; connection: CommandConnection; name: string }>;

const identityOf = (item: Pending): PackageCommandIdentity =>
  item.connection.plugin === undefined
    ? { packageId: item.packageId, id: item.connection.id }
    : { packageId: item.packageId, id: item.connection.id, plugin: item.connection.plugin };

const summaryOf = (item: Entry): PackageCommandSummary => {
  const summary = {
    name: item.name,
    description: item.connection.description ?? item.connection.title,
    packageId: item.packageId,
  };
  return item.connection.argumentHint === undefined
    ? summary
    : { ...summary, argumentHint: item.connection.argumentHint };
};

export const createPackageCommandService = (
  registry: () => Promise<Pick<ConnectionRegistry, 'enabledOfKind'>>
): PackageCommandService => {
  const entries = async (): Promise<Entry[]> => {
    const pending: Pending[] = [];
    for (const item of await (await registry()).enabledOfKind('command')) {
      if (isCommand(item.connection)) {
        pending.push({
          packageId: item.packageId,
          key: item.key,
          context: item.context,
          connection: item.connection,
        });
      }
    }
    const sorted = pending.toSorted((a, b) => a.packageId.localeCompare(b.packageId) || a.key.localeCompare(b.key));
    const names = assignPackageCommandNames(sorted.map(identityOf), RESERVED_SLASH_NAMES);
    return sorted.map((item, index) => ({
      packageId: item.packageId,
      context: item.context,
      connection: item.connection,
      name: names[index] ?? '',
    }));
  };

  return {
    list: async () => {
      try {
        return (await entries()).map(summaryOf);
      } catch {
        return [];
      }
    },
    expand: async (input) => {
      const slash = parsePackageSlash(input);
      // The fixed names are never package commands, so the common `/boost ...` costs no registry read.
      if (slash === undefined || RESERVED_SLASH_NAMES.has(slash.name)) return undefined;
      let found: Entry | undefined;
      try {
        found = (await entries()).find((item) => item.name === slash.name);
      } catch {
        return undefined;
      }
      if (found === undefined) return undefined;
      let body: string;
      try {
        body = (await loadCommandTemplate(found.context, found.connection)).body;
      } catch {
        throw new Error(PACKAGE_COMMAND_UNAVAILABLE);
      }
      const filled = expandCommandTemplate(body, slash.rawArguments);
      if (filled.ok === false) throw new Error(PACKAGE_COMMAND_TOO_LARGE);
      return { name: found.name, packageId: found.packageId, modelInput: filled.text };
    },
  };
};
