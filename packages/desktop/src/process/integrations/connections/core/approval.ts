/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The approval hash binds a user's "yes" to exactly what they were shown: the connection as written in
 * `adapter.json`, the lines the dialog displayed, and the content of every file that would run. Change any of
 * those and the old approval no longer matches. Main always recomputes the hash; a value sent by the renderer
 * is only ever compared against it, never trusted.
 */

import { createHash } from 'node:crypto';
import type { AdapterConnection } from '@/common/packages/adapter';
import type { ApprovalSubject } from './types';

/** JSON with sorted object keys, so equal data always hashes equally. */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

export type ApprovalFileContent = ReadonlyMap<string, Buffer>;

export const computeApprovalHash = (
  connection: AdapterConnection,
  subject: ApprovalSubject,
  files: ApprovalFileContent
): string => {
  const hash = createHash('sha256');
  hash.update(
    canonicalJson({ connection, subject: { kind: subject.kind, title: subject.title, lines: subject.lines } })
  );
  for (const file of [...subject.files].toSorted()) {
    const content = files.get(file);
    hash.update('\u0000file\u0000');
    hash.update(file);
    hash.update('\u0000');
    // A file that cannot be read still changes the hash, so a vanished script can never match an old approval.
    hash.update(content ?? Buffer.from('<unreadable>'));
  }
  return `sha256-${hash.digest('hex')}`;
};
