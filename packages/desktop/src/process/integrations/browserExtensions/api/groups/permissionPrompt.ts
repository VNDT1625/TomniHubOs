/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The native question behind `chrome.permissions.request` (docs/platform/repotopackage-design.md section 12.3).
 *
 * Extension names and permission strings come from a manifest and are untrusted: they are stripped of control
 * characters, shortened and counted before they are shown. The default button is "Từ chối", closing the box is a
 * refusal, and the extension cannot choose any wording of its own.
 */

import type { PermissionPromptPort } from '@process/integrations/browserExtensions/api/groups/permissions';

export type PermissionMessageBox = Readonly<{
  type: 'question';
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  noLink: boolean;
}>;

/** The part of `dialog.showMessageBox` the prompt uses. */
export type ShowMessageBox = (options: PermissionMessageBox) => Promise<Readonly<{ response: number }>>;

const MAX_LISTED = 12;
const MAX_ITEM_LENGTH = 80;
const ALLOW_BUTTON = 0;

/** Control characters and the bidirectional overrides that could disguise what the box says. */
const isUnsafe = (code: number): boolean =>
  code < 0x20 ||
  (code >= 0x7f && code <= 0x9f) ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2066 && code <= 0x2069);

const clean = (value: string): string =>
  Array.from(value, (char) => (isUnsafe(char.codePointAt(0) ?? 0) ? ' ' : char))
    .join('')
    .trim()
    .slice(0, MAX_ITEM_LENGTH);

const listed = (items: readonly string[]): string => {
  const shown = items.slice(0, MAX_LISTED).map((item) => `  - ${clean(item)}`);
  const hidden = items.length - shown.length;
  return [...shown, ...(hidden > 0 ? [`  - ... và ${hidden} mục khác`] : [])].join('\n');
};

export const createDialogPermissionPrompt = (showMessageBox: ShowMessageBox): PermissionPromptPort => ({
  ask: async (request) => {
    const sections = [
      ...(request.permissions.length > 0 ? [`Quyền:\n${listed(request.permissions)}`] : []),
      ...(request.origins.length > 0 ? [`Truy cập trang web:\n${listed(request.origins)}`] : []),
    ];
    const result = await showMessageBox({
      type: 'question',
      title: 'Tiện ích xin thêm quyền',
      message: `Tiện ích "${clean(request.extensionName)}" xin thêm quyền.`,
      detail: sections.join('\n\n'),
      buttons: ['Cho phép', 'Từ chối'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    return result.response === ALLOW_BUTTON;
  },
});
