/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Best-effort decoding of the parts of an email the hub shows: From, Subject,
 * Date and a short plain-text snippet. Mail is untrusted data; nothing here is
 * rendered as HTML.
 */

const MAX_SNIPPET = 400;

const decodeCharset = (bytes: Buffer, charset: string): string => {
  try {
    return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
};

const decodeQuotedPrintable = (text: string, underscoreIsSpace: boolean): Buffer => {
  const source = (underscoreIsSpace ? text.replace(/_/g, ' ') : text).replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    const hex = source.slice(index + 1, index + 3);
    if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
    } else {
      bytes.push(...Buffer.from(char, 'utf8'));
    }
  }
  return Buffer.from(bytes);
};

/** Decodes RFC 2047 encoded words such as `=?UTF-8?B?...?=` inside a header value. */
export const decodeEncodedWords = (value: string): string =>
  value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_match, charset: string, encoding: string, text: string) => {
      const bytes = encoding.toUpperCase() === 'B' ? Buffer.from(text, 'base64') : decodeQuotedPrintable(text, true);
      return decodeCharset(bytes, charset);
    });

/** Parses a raw header block into lower-cased names; folded lines are joined. */
export const parseHeaders = (raw: string): Record<string, string> => {
  const headers: Record<string, string> = {};
  const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!(name in headers)) headers[name] = decodeEncodedWords(line.slice(colon + 1).trim());
  }
  return headers;
};

/** `"Ann Lee" <ann@x.com>` → `Ann Lee <ann@x.com>`; keeps whatever is there when it is unusual. */
export const formatSender = (from: string | undefined): string | undefined => {
  if (!from) return undefined;
  const cleaned = from.replace(/"/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : undefined;
};

const stripHtml = (html: string): string =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET);

type Part = { headers: Record<string, string>; body: string };

const splitPart = (raw: string): Part => {
  const match = /\r?\n\r?\n/.exec(raw);
  if (!match) return { headers: {}, body: raw };
  return { headers: parseHeaders(raw.slice(0, match.index)), body: raw.slice(match.index + match[0].length) };
};

const decodeBody = (part: Part): string => {
  const encoding = (part.headers['content-transfer-encoding'] ?? '').toLowerCase();
  const charset = /charset="?([^";\s]+)"?/i.exec(part.headers['content-type'] ?? '')?.[1] ?? 'utf-8';
  if (encoding === 'base64') {
    return decodeCharset(Buffer.from(part.body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64'), charset);
  }
  if (encoding === 'quoted-printable') return decodeCharset(decodeQuotedPrintable(part.body, false), charset);
  return part.body;
};

const findText = (part: Part, depth: number): { text: string; html: boolean } | undefined => {
  const type = (part.headers['content-type'] ?? 'text/plain').toLowerCase();
  const boundary = /boundary="?([^";]+)"?/i.exec(part.headers['content-type'] ?? '')?.[1];
  if (type.startsWith('multipart/') && boundary && depth < 4) {
    const pieces = part.body.split(`--${boundary}`).slice(1);
    let html: { text: string; html: boolean } | undefined;
    for (const piece of pieces) {
      if (piece.startsWith('--')) break;
      const found = findText(splitPart(piece.replace(/^\r?\n/, '')), depth + 1);
      if (found && !found.html) return found;
      html ??= found;
    }
    return html;
  }
  if (type.startsWith('text/plain')) return { text: decodeBody(part), html: false };
  if (type.startsWith('text/html')) return { text: stripHtml(decodeBody(part)), html: true };
  return undefined;
};

/**
 * Snippet of the message body. `headers` are the message's top-level headers;
 * `body` is the (possibly truncated) raw body after them.
 */
export const extractSnippet = (headers: Record<string, string>, body: string): string => {
  const found = findText({ headers, body }, 0);
  return found ? tidy(found.text) : '';
};
