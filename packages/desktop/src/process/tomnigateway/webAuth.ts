/**
 * @license
 * Copyright 2025 Tomni
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const derivePassword = (password: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scryptCallback(password, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derived) =>
      error ? reject(error) : resolve(derived)
    )
  );
const SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
const REMEMBERED_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15_000;

type PersistedCredential = {
  version: 1;
  username: string;
  passwordSalt?: string;
  passwordHash?: string;
  signingSecret: string;
  updatedAt: number;
};
type Session = { userId: string; username: string; expiresAt: number };
type Attempt = { count: number; lockedUntil: number };

export type TomniAuthUser = { id: string; username: string };
export type TomniLoginResult =
  | { ok: true; token: string; expiresAt: number; user: TomniAuthUser }
  | { ok: false; status: 401 | 429; retryAfterSeconds?: number };

const encode = (value: string | Buffer): string => Buffer.from(value).toString('base64url');
const user = (username: string): TomniAuthUser => ({ id: 'tomni-admin', username });

export class TomniWebAuth {
  readonly #filePath: string;
  readonly #sessions = new Map<string, Session>();
  readonly #attempts = new Map<string, Attempt>();
  #statePromise?: Promise<PersistedCredential>;

  constructor(dataDir: string) {
    this.#filePath = path.join(dataDir, 'tomni-core', 'web-auth.json');
  }

  async status(): Promise<{ needs_setup: boolean; username: string }> {
    const state = await this.#state();
    return { needs_setup: !state.passwordHash, username: state.username };
  }

  async login(identifier: string, username: string, password: string, remember: boolean): Promise<TomniLoginResult> {
    const now = Date.now();
    const attempt = this.#attempts.get(identifier);
    if (attempt?.lockedUntil && attempt.lockedUntil > now) {
      return { ok: false, status: 429, retryAfterSeconds: Math.ceil((attempt.lockedUntil - now) / 1_000) };
    }
    const state = await this.#state();
    const valid =
      Boolean(state.passwordHash && state.passwordSalt) &&
      username === state.username &&
      (await this.#verifyPassword(password, state.passwordSalt!, state.passwordHash!));
    if (!valid) {
      const count = (attempt?.count ?? 0) + 1;
      this.#attempts.set(identifier, { count, lockedUntil: count >= MAX_ATTEMPTS ? now + LOCK_MS : 0 });
      return count >= MAX_ATTEMPTS
        ? { ok: false, status: 429, retryAfterSeconds: Math.ceil(LOCK_MS / 1_000) }
        : { ok: false, status: 401 };
    }
    this.#attempts.delete(identifier);
    const expiresAt = now + (remember ? REMEMBERED_SESSION_TTL_MS : SESSION_TTL_MS);
    const nonce = randomBytes(24).toString('base64url');
    this.#sessions.set(nonce, { userId: 'tomni-admin', username: state.username, expiresAt });
    return {
      ok: true,
      token: this.#signToken(nonce, expiresAt, state.signingSecret),
      expiresAt,
      user: user(state.username),
    };
  }

  async verify(token: string | undefined): Promise<TomniAuthUser | undefined> {
    if (!token) return undefined;
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) return undefined;
    const state = await this.#state();
    const expected = createHmac('sha256', state.signingSecret).update(`${header}.${payload}`).digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(signature, 'base64url');
    } catch {
      return undefined;
    }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return undefined;
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { jti?: string; exp?: number };
      if (!claims.jti || !claims.exp || claims.exp <= Date.now()) return undefined;
      const session = this.#sessions.get(claims.jti);
      if (!session || session.expiresAt !== claims.exp) return undefined;
      return { id: session.userId, username: session.username };
    } catch {
      return undefined;
    }
  }

  logout(token: string | undefined): void {
    if (!token) return;
    try {
      const payload = token.split('.')[1];
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { jti?: string };
      if (claims.jti) this.#sessions.delete(claims.jti);
    } catch {
      // Invalid tokens do not have server-side sessions to revoke.
    }
  }

  async changePassword(password: string): Promise<void> {
    if (password.length < 8) throw new Error('PASSWORD_TOO_SHORT');
    const state = await this.#state();
    const salt = randomBytes(16).toString('base64url');
    const hash = await this.#hashPassword(password, salt);
    await this.#save({
      ...state,
      passwordSalt: salt,
      passwordHash: hash,
      signingSecret: randomBytes(32).toString('base64url'),
      updatedAt: Date.now(),
    });
    this.#sessions.clear();
  }

  async resetPassword(): Promise<string> {
    const password = randomBytes(18).toString('base64url');
    await this.changePassword(password);
    return password;
  }

  async changeUsername(username: string): Promise<TomniAuthUser> {
    const normalized = username.trim();
    if (normalized.length < 1 || normalized.length > 64) throw new Error('INVALID_USERNAME');
    const state = await this.#state();
    await this.#save({ ...state, username: normalized, updatedAt: Date.now() });
    this.#sessions.clear();
    return user(normalized);
  }

  async generateQrToken(): Promise<{ token: string; expires_at_ms: number }> {
    const state = await this.#state();
    const expiresAt = Date.now() + 5 * 60 * 1_000;
    const nonce = randomBytes(24).toString('base64url');
    this.#sessions.set(nonce, { userId: 'tomni-admin', username: state.username, expiresAt });
    return { token: this.#signToken(nonce, expiresAt, state.signingSecret), expires_at_ms: expiresAt };
  }

  async #state(): Promise<PersistedCredential> {
    this.#statePromise ??= this.#load();
    return this.#statePromise;
  }

  async #load(): Promise<PersistedCredential> {
    try {
      const parsed = JSON.parse(await readFile(this.#filePath, 'utf8')) as PersistedCredential;
      if (parsed.version === 1 && parsed.username && parsed.signingSecret) return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const initial: PersistedCredential = {
      version: 1,
      username: 'admin',
      signingSecret: randomBytes(32).toString('base64url'),
      updatedAt: Date.now(),
    };
    await this.#save(initial);
    return initial;
  }

  async #save(state: PersistedCredential): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    const temporary = `${this.#filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.#filePath);
    this.#statePromise = Promise.resolve(state);
  }

  async #hashPassword(password: string, salt: string): Promise<string> {
    const derived = await derivePassword(password, salt);

    return derived.toString('base64url');
  }

  async #verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
    const actual = Buffer.from(await this.#hashPassword(password, salt), 'base64url');
    const expected = Buffer.from(expectedHash, 'base64url');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  #signToken(nonce: string, expiresAt: number, secret: string): string {
    const header = encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = encode(JSON.stringify({ sub: 'tomni-admin', jti: nonce, exp: expiresAt }));
    const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
  }
}
