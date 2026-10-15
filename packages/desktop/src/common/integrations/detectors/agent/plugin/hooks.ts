/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hooks declared by a plugin (`hooks/hooks.json` or the manifest key `hooks`). One handler becomes one `hook`
 * connection, parsed by the same lenient parser the hook runner uses. A shell-string command that is only a program,
 * plain or quoted words and the plugin placeholders is stored in exec form (program + args), so it runs without a
 * shell. A command that needs a shell, a handler that cannot run in v1 (another `type`) and an event Tomny does not
 * fire are reported instead of being lost; an unsupported event is reported once for the whole package.
 */

import { commandToExecForm, defaultTimeoutSec, parseHooksConfig, type HookHandler } from '@/common/integrations/hooks';
import { defaultHash } from '@/common/integrations/detectors/merge';
import { addConnection, field, isRecord, plain, report, type Context, type RootScope } from './support';

/** `{ hooks: {...} }` as is; a bare events map (the inline form in a manifest) is wrapped. */
const wrapped = (value: unknown): unknown =>
  isRecord(value) && field(value, 'hooks') !== undefined ? value : { hooks: value };

const hookId = (handler: HookHandler, index: number): string => {
  const digest = defaultHash(
    JSON.stringify([handler.event, handler.matcher ?? '', handler.command, handler.args ?? []])
  );
  return `${handler.event.toLowerCase()}-${index}-${digest.slice(0, 8)}`;
};

const timeoutOf = (handler: HookHandler): number | undefined =>
  handler.timeoutSec === defaultTimeoutSec(handler.event)
    ? undefined
    : Math.min(600, Math.max(1, Math.ceil(handler.timeoutSec)));

/** Exec form of a handler: `exec` handlers as they are, shell strings converted when they need no shell. */
const execFormOf = (handler: HookHandler): Readonly<{ command: string; args: string[] }> | undefined => {
  if (handler.form === 'exec') return { command: handler.command, args: handler.args ?? [] };
  const tokens = commandToExecForm(handler.command);
  return tokens.ok ? { command: tokens.program, args: tokens.args } : undefined;
};

/** Reads one hooks document (a parsed Claude Code `hooks.json` or an inline value) into `hook` connections and open items. */
export const readHooksDocument = (context: Context, scope: RootScope, document: unknown, where: string): void => {
  const { handlers, issues } = parseHooksConfig(wrapped(document));
  for (const issue of issues) {
    if (issue.code === 'unsupported-event') continue;
    if (issue.code === 'unknown-event') {
      report(
        context,
        'needs-runtime',
        `Hook cho sự kiện "${plain(issue.event ?? '', 40)}" không nằm trong danh sách Tomny hỗ trợ; không tạo kết nối`,
        { path: where }
      );
    } else if (issue.code === 'needs-runtime') {
      report(
        context,
        'needs-runtime',
        `Trình xử lý hook ${plain(issue.path, 120)} cần runtime Tomny chưa có (chỉ hỗ trợ type command)`,
        { path: where }
      );
    } else {
      report(context, 'unrecognized', `Hook ${plain(issue.path, 120)}: ${plain(issue.message, 160)}`, { path: where });
    }
  }
  const reportedEvents = new Set<string>();
  for (const handler of handlers) {
    const exec = execFormOf(handler);
    if (exec === undefined) {
      report(
        context,
        'needs-runtime',
        `Hook ${handler.event} cần shell (ký tự shell, biến không hỗ trợ hoặc gán biến môi trường); không tạo kết nối`,
        { path: where }
      );
      continue;
    }
    const id = hookId(handler, scope.hookIndex.next);
    scope.hookIndex.next += 1;
    const timeoutSec = timeoutOf(handler);
    const connection = addConnection(
      context,
      {
        kind: 'hook',
        id,
        event: handler.event,
        ...(handler.matcher === undefined ? {} : { matcher: handler.matcher }),
        command: exec.command,
        args: exec.args,
        ...(timeoutSec === undefined ? {} : { timeoutSec }),
        plugin: scope.plugin,
        origin: scope.origin,
      },
      where
    );
    // One note per event, without a path: the same note from every document is listed once in the package.
    if (connection !== undefined && handler.unsupported && !reportedEvents.has(handler.event)) {
      reportedEvents.add(handler.event);
      report(
        context,
        'needs-runtime',
        `Sự kiện hook "${plain(handler.event, 40)}" chưa được hỗ trợ; các hook của sự kiện này được giữ trong gói và đang tắt`
      );
    }
  }
};
