/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Connection host for `rules` (docs/platform/repotopackage-design.md sections 9.3, 10.6, 15.1): instructions for the
 * agent that a package brings. They are data for the model and run nothing.
 *
 * - Turning the connection on only makes the rules available in the Library as "not attached". They reach a chat only
 *   after the person attaches them to a workspace (`rulesService.ts`); nothing here adds them to any conversation.
 * - There is no target store: the registry state is the catalog and the attachments are state of this machine, so
 *   `disable` has nothing to remove (an update of the package turns a data connection off and on again, and the
 *   attachments must survive that). `reconcile` only asks the service to forget attachments whose package or connection
 *   is gone.
 * - The approval says what happens: where the text goes, the 16 KB limit per workspace, that it is checked like any
 *   text bound for the model, and that it cannot grant a permission. The file is part of the approval; a data kind
 *   follows an updated package by itself.
 */

import { MAX_RULES_BYTES, MAX_RULES_FILE_BYTES } from '@process/integrations/packageContext/rulesService';
import {
  defineConnectionHost,
  type AnyConnectionHost,
  type ApprovalSubject,
  type ConnectionOf,
  type HostCheck,
  type HostContext,
} from '../../core/types';

type RulesConnection = ConnectionOf<'rules'>;

const SOURCE_PREFIX = 'source/';

/** What the host needs from the rules service; it is bound later because the service needs the registry. */
export type RulesHostControl = Readonly<{ prune: () => Promise<void> }>;

export type RulesHostDeps = Readonly<{ control?: RulesHostControl }>;

/** Why the file cannot be offered as rules, or the size of a usable one. */
const inspectFile = async (
  context: HostContext,
  connection: RulesConnection
): Promise<{ ok: true; bytes: number } | { ok: false; reason: string }> => {
  if (!connection.path.startsWith(SOURCE_PREFIX)) {
    return { ok: false, reason: 'The rules file must be inside the package source folder.' };
  }
  let content: Buffer;
  try {
    content = await context.readPackageFile(connection.path);
  } catch (error) {
    if ((error as { code?: string }).code === 'PATH_FORBIDDEN') {
      return { ok: false, reason: 'The rules file is not a regular file inside the package.' };
    }
    return { ok: false, reason: 'The rules file is missing from the package.' };
  }
  if (content.length > MAX_RULES_FILE_BYTES) {
    return { ok: false, reason: `The rules file is larger than ${MAX_RULES_FILE_BYTES / 1024} KiB.` };
  }
  if (content.toString('utf8').trim() === '') return { ok: false, reason: 'The rules file is empty.' };
  return { ok: true, bytes: content.length };
};

const subjectOf = async (context: HostContext, connection: RulesConnection): Promise<ApprovalSubject> => {
  const inspected = await inspectFile(context, connection);
  return {
    kind: 'rules',
    title: connection.title,
    lines: [
      {
        label: 'Type',
        value: 'Rules for the agent. They are text only: they run nothing and grant no permission.',
      },
      { label: 'Rules file', value: connection.path },
      { label: 'Format', value: connection.format },
      { label: 'Size', value: inspected.ok ? `${inspected.bytes} bytes` : 'not readable' },
      {
        label: 'Added to a chat',
        value: 'only after you attach them to a workspace in the Library; never to every chat',
      },
      {
        label: 'Limit',
        value: `at most ${MAX_RULES_BYTES / 1024} KB of rules per workspace, cut with a note; checked for secrets like any text sent to the model`,
      },
    ],
    files: [connection.path],
  };
};

export const createRulesHost = (deps: RulesHostDeps = {}): AnyConnectionHost => {
  const check = async (context: HostContext, connection: RulesConnection): Promise<HostCheck> => {
    const inspected = await inspectFile(context, connection);
    return inspected.ok === false ? { ok: false, reason: inspected.reason } : { ok: true };
  };

  return defineConnectionHost({
    kind: 'rules',
    check,
    describe: subjectOf,
    enable: async (context, connection: RulesConnection) => {
      const checked = await check(context, connection);
      if (checked.ok === false) throw new Error(checked.reason);
      return { installed: [`rules:${connection.id}`] };
    },
    // Nothing was copied anywhere, and attachments follow the connection's state (see the file comment).
    disable: async () => undefined,
    reconcile: async () => {
      await deps.control?.prune();
    },
  });
};
