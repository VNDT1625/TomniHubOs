/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import tls from 'node:tls';
import { extractSnippet, formatSender, parseHeaders } from './mailParsing';

/**
 * Read-only IMAP over TLS: the mailbox is opened with EXAMINE and bodies are
 * fetched with BODY.PEEK, so the hub never marks mail as read or changes it.
 * Works with any IMAP provider; Gmail and Outlook need an app password.
 */

export type ImapAccount = { host: string; port: number; user: string; password: string; mailbox: string };

export type FetchedMail = {
  uid: number;
  sender?: string;
  subject: string;
  date?: number;
  messageId?: string;
  /** Empty when only headers were read. */
  snippet: string;
  /** Gmail marked it important. */
  important?: boolean;
  /** Gmail category tab, when the server is Gmail and the mail is not in Primary. */
  category?: 'promotions' | 'social' | 'updates' | 'forums';
};

export type ImapFetchResult = { uidValidity: number; mails: FetchedMail[]; highestUid: number };

const GMAIL_CATEGORIES = ['promotions', 'social', 'updates', 'forums'] as const;

export const isGmailHost = (host: string): boolean => /(^|\.)(gmail|googlemail)\.com$/i.test(host.trim());

export type ImapFetchOptions = {
  /** Only mail with a UID above this; 0 on first sync. */
  afterUid: number;
  uidValidity?: number;
  /** Newest messages to return at most. */
  limit: number;
  /** Read headers only; no text preview is fetched. */
  headersOnly?: boolean;
  /** Drop mail already marked read. */
  unreadOnly?: boolean;
  /** Ask Gmail for its importance marker and category tabs (free, read-only). */
  gmail?: boolean;
  timeoutMs?: number;
};

/** The parts of a socket the session uses; a TLS socket in production, a stream pair in tests. */
export type ImapTransport = {
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  write(data: string): unknown;
  destroy(): unknown;
};

type Response = { tag: string; status: string; text: string; untagged: string[]; literals: Buffer[] };

const quote = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

class ImapSession {
  private buffer = Buffer.alloc(0);
  private tagCounter = 0;
  private waiter?: { resolve: () => void; reject: (error: Error) => void };
  private closed?: Error;

  constructor(private readonly socket: ImapTransport) {
    socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (this.buffer.length > MAX_RESPONSE_BYTES) {
        this.fail(new Error('IMAP response too large'));
        return;
      }
      this.waiter?.resolve();
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('IMAP connection closed')));
  }

  private fail(error: Error): void {
    this.closed ??= error;
    this.waiter?.reject(error);
  }

  private async more(): Promise<void> {
    if (this.closed) throw this.closed;
    await new Promise<void>((resolve, reject) => {
      this.waiter = { resolve, reject };
    });
    this.waiter = undefined;
  }

  /** Reads one logical line; a `{n}` literal at its end pulls in n raw bytes. */
  private async readLine(literals: Buffer[]): Promise<string> {
    let line = '';
    for (;;) {
      const end = this.buffer.indexOf('\r\n');
      if (end < 0) {
        await this.more();
        continue;
      }
      const part = this.buffer.subarray(0, end).toString('utf8');
      this.buffer = this.buffer.subarray(end + 2);
      const literal = /\{(\d+)\}$/.exec(part);
      if (!literal) return line + part;
      const size = Number(literal[1]);
      while (this.buffer.length < size) await this.more();
      literals.push(Buffer.from(this.buffer.subarray(0, size)));
      this.buffer = this.buffer.subarray(size);
      line += `${part} `;
    }
  }

  async greeting(): Promise<void> {
    const line = await this.readLine([]);
    if (!line.startsWith('* OK') && !line.startsWith('* PREAUTH')) throw new Error('Unexpected IMAP greeting');
  }

  async command(command: string): Promise<Response> {
    this.tagCounter += 1;
    const tag = `T${this.tagCounter}`;
    this.socket.write(`${tag} ${command}\r\n`);
    const untagged: string[] = [];
    const literals: Buffer[] = [];
    for (;;) {
      const line = await this.readLine(literals);
      if (line.startsWith(`${tag} `)) {
        const [, status = '', ...rest] = line.split(' ');
        const response = { tag, status: status.toUpperCase(), text: rest.join(' '), untagged, literals };
        if (response.status !== 'OK') throw new Error(`IMAP ${command.split(' ')[0]} failed: ${response.text}`);
        return response;
      }
      if (line.startsWith('* ')) untagged.push(line.slice(2));
    }
  }

  close(): void {
    try {
      this.socket.write('Z LOGOUT\r\n');
    } catch {
      // closing anyway
    }
    this.socket.destroy();
  }
}

const connect = (account: ImapAccount, timeoutMs: number): Promise<tls.TLSSocket> =>
  new Promise((resolve, reject) => {
    const socket = tls.connect({ host: account.host, port: account.port, servername: account.host });
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('IMAP connection timed out')));
    socket.once('secureConnect', () => resolve(socket));
    socket.once('error', reject);
  });

const parseUidList = (untagged: readonly string[]): number[] =>
  untagged
    .filter((line) => line.startsWith('SEARCH'))
    .flatMap((line) => line.slice('SEARCH'.length).trim().split(/\s+/))
    .map(Number)
    .filter((uid) => Number.isInteger(uid) && uid > 0);

/** Fetches the newest mail above `afterUid`, oldest first. */
export const fetchNewMail = async (account: ImapAccount, options: ImapFetchOptions): Promise<ImapFetchResult> =>
  fetchNewMailOver(await connect(account, options.timeoutMs ?? 20_000), account, options);

/** The protocol exchange over an already connected transport. */
export const fetchNewMailOver = async (
  transport: ImapTransport,
  account: ImapAccount,
  options: ImapFetchOptions
): Promise<ImapFetchResult> => {
  const session = new ImapSession(transport);
  try {
    await session.greeting();
    await session.command(`LOGIN ${quote(account.user)} ${quote(account.password)}`);
    const examined = await session.command(`EXAMINE ${quote(account.mailbox || 'INBOX')}`);
    const validityLine = examined.untagged.find((line) => /UIDVALIDITY \d+/i.test(line)) ?? '';
    const uidValidity = Number(/UIDVALIDITY (\d+)/i.exec(validityLine)?.[1] ?? 0);
    const sameMailbox = options.uidValidity === undefined || options.uidValidity === uidValidity;
    const afterUid = sameMailbox ? options.afterUid : 0;
    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const sinceText = `${since.getUTCDate()}-${months[since.getUTCMonth()]}-${since.getUTCFullYear()}`;
    const search = await session.command(
      afterUid > 0 ? `UID SEARCH UID ${afterUid + 1}:*` : `UID SEARCH UNSEEN SINCE ${sinceText}`
    );
    // `UID n:*` always matches the newest message even when it is not above n.
    const uids = parseUidList(search.untagged).filter((uid) => uid > afterUid);
    const highestUid = Math.max(afterUid, ...uids);
    const wanted = uids.toSorted((left, right) => left - right).slice(-options.limit);
    const mails: FetchedMail[] = [];
    if (wanted.length > 0) {
      const body = options.headersOnly ? '' : ' BODY.PEEK[TEXT]<0.6000>';
      const labels = options.gmail ? ' X-GM-LABELS' : '';
      const fetched = await session.command(
        `UID FETCH ${wanted.join(',')} (UID FLAGS${labels} BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID CONTENT-TYPE CONTENT-TRANSFER-ENCODING)]${body})`
      );
      const categories = new Map<number, FetchedMail['category']>();
      if (options.gmail) {
        for (const category of GMAIL_CATEGORIES) {
          const found = await session.command(`UID SEARCH UID ${wanted.join(',')} X-GM-RAW "category:${category}"`);
          for (const uid of parseUidList(found.untagged)) if (!categories.has(uid)) categories.set(uid, category);
        }
      }
      // Each FETCH line carries its literals in order: the header block, then the body slice when asked for.
      let literalIndex = 0;
      for (const line of fetched.untagged) {
        if (!/^\d+ FETCH /.test(line)) continue;
        const uid = Number(/UID (\d+)/.exec(line)?.[1] ?? 0);
        const literalCount = (line.match(/\{\d+\} /g) ?? []).length;
        const parts = fetched.literals
          .slice(literalIndex, literalIndex + literalCount)
          .map((part) => part.toString('utf8'));
        literalIndex += literalCount;
        if (!uid) continue;
        const flags = /FLAGS \(([^)]*)\)/i.exec(line)?.[1] ?? '';
        if (options.unreadOnly && /\\Seen\b/i.test(flags)) continue;
        const headerIndex = Math.max(
          0,
          parts.findIndex((part) => /^(from|subject|date|message-id|content-type):/im.test(part))
        );
        const headers = parseHeaders(parts[headerIndex] ?? '');
        const text = options.headersOnly ? '' : (parts.find((_part, index) => index > headerIndex) ?? '');
        const date = headers.date ? Date.parse(headers.date) : Number.NaN;
        mails.push({
          uid,
          sender: formatSender(headers.from),
          subject: (headers.subject ?? '').slice(0, 300),
          date: Number.isFinite(date) ? date : undefined,
          messageId: headers['message-id'],
          snippet: options.headersOnly ? '' : extractSnippet(headers, text),
          ...(options.gmail && /X-GM-LABELS \([^)]*\\\\?Important/i.test(line) ? { important: true } : {}),
          ...(categories.has(uid) ? { category: categories.get(uid) } : {}),
        });
      }
    }
    return { uidValidity, mails: mails.toSorted((left, right) => left.uid - right.uid), highestUid };
  } finally {
    session.close();
  }
};
