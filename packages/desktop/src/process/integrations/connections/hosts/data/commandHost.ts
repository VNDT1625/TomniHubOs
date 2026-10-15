/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Connection host for `command` (docs/platform/repotopackage-design.md sections 9.3, 10.3, 15.1): a prompt template
 * the person types as `/name` in the chat. It is data for the model and runs nothing.
 *
 * - There is no target store. A turned-on command is simply a connection whose state is `on`; the chat reads the
 *   list from the registry (`enabledOfKind('command')`) and reads the template file only when the command is used.
 *   So `disable` and `reconcile` have nothing to remove, and a package that goes away takes its commands with it.
 * - The template is read inside Main with the registry's guarded reader (no traversal, no symlink out of the package),
 *   only below `source/`, and at most {@link PACKAGE_COMMAND_MAX_BYTES}. A file that is missing, too large or not a
 *   usable template makes the command `unsupported` with that reason instead of appearing in the menu.
 * - The approval covers the command's name, file path and the file's content. A data kind follows an updated package
 *   by itself (registry), so an edited template is picked up without asking again.
 * - Shell substitution and file references inside a template are never run or read (see `commandTemplate.ts`). The
 *   approval text says so, and counts how many there are.
 */

import {
  PACKAGE_COMMAND_MAX_BYTES,
  countUnrunSyntax,
  parseCommandTemplate,
  type ParsedCommandTemplate,
} from '@/common/integrations/commands/commandTemplate';
import {
  defineConnectionHost,
  type AnyConnectionHost,
  type ApprovalSubject,
  type ConnectionOf,
  type HostCheck,
  type HostContext,
} from '../../core/types';

type CommandConnection = ConnectionOf<'command'>;

const SOURCE_PREFIX = 'source/';

/**
 * Reads and parses the template of one command connection. Throws an `Error` with a reason fit for the person to
 * read; `ConnectionError('PATH_FORBIDDEN')` from the reader passes through unchanged.
 */
export const loadCommandTemplate = async (
  context: Pick<HostContext, 'readPackageFile'>,
  connection: Pick<CommandConnection, 'path' | 'format'>
): Promise<ParsedCommandTemplate> => {
  if (!connection.path.startsWith(SOURCE_PREFIX)) {
    throw new Error('The command file must be inside the package source folder.');
  }
  let bytes: Buffer;
  try {
    bytes = await context.readPackageFile(connection.path);
  } catch (error) {
    if ((error as { code?: string }).code === 'PATH_FORBIDDEN') throw error;
    throw new Error('The command file is missing from the package.', { cause: error });
  }
  if (bytes.length > PACKAGE_COMMAND_MAX_BYTES) {
    throw new Error(`The command file is larger than ${PACKAGE_COMMAND_MAX_BYTES / 1024} KiB.`);
  }
  const parsed = parseCommandTemplate(connection.format, bytes.toString('utf8'));
  if (parsed === undefined) throw new Error('The command file has no usable prompt text.');
  return parsed;
};

const subjectOf = async (context: HostContext, connection: CommandConnection): Promise<ApprovalSubject> => {
  let unrun = '';
  try {
    const { body } = await loadCommandTemplate(context, connection);
    const counts = countUnrunSyntax(body);
    if (counts.shell + counts.files > 0) {
      unrun = `${counts.shell} shell substitution(s) and ${counts.files} file reference(s) stay as text and are not run or read`;
    }
  } catch {
    // check() reports an unreadable file; the approval still lists the file so its absence changes the hash.
  }
  return {
    kind: 'command',
    title: connection.title,
    lines: [
      { label: 'Type', value: 'Prompt template (slash command). It only adds text to your message and runs nothing.' },
      { label: 'Command', value: `/${connection.id}` },
      { label: 'Template file', value: connection.path },
      ...(connection.argumentHint === undefined ? [] : [{ label: 'Arguments', value: connection.argumentHint }]),
      ...(unrun === '' ? [] : [{ label: 'Not run', value: unrun }]),
    ],
    files: [connection.path],
  };
};

export const createCommandHost = (): AnyConnectionHost => {
  const check = async (context: HostContext, connection: CommandConnection): Promise<HostCheck> => {
    try {
      await loadCommandTemplate(context, connection);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'The command file cannot be read.' };
    }
  };

  return defineConnectionHost({
    kind: 'command',
    check,
    describe: subjectOf,
    enable: async (context, connection: CommandConnection) => {
      const checked = await check(context, connection);
      if (checked.ok === false) throw new Error(checked.reason);
      return { installed: [connection.id] };
    },
    // Nothing was copied anywhere: the registry state is the whole catalog, so there is nothing to take out.
    disable: async () => undefined,
    reconcile: async () => undefined,
  });
};
