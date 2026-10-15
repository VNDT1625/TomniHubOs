/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Install source "Chrome Web Store" (docs/platform/repotopackage-design.md section 12.6, decision D14, task T4.9).
 *
 * The user accepted the Web Store terms risk (D14); the source has its own switch (`chromeWebStoreSource`, owned by
 * the caller, not read here). Download rules, none relaxed to make a download pass:
 *
 * - Input is a 32-letter id (`a`-`p`) or `https://chromewebstore.google.com/detail/<name>/<id>`; nothing else.
 * - The only entry point is the `update2/crx` endpoint. Every hop (the first URL and each redirect target) must be
 *   `https`, carry no credentials, use the default port and name a host in {@link CHROME_WEB_STORE_HOSTS}; the check
 *   runs before the request for that hop is made. A refused host is reported (name only) through `log`, so the
 *   list can be extended on purpose, never at run time.
 * - The network is a port (`StorePort`) whose contract is: never follow redirects, never send cookies or
 *   credentials. {@link createFetchStorePort} adapts `fetch` accordingly.
 * - One timeout covers the whole operation; the body is streamed to a private temp file with a hard byte cap
 *   (declared `content-length` is only an early exit, the counted bytes decide).
 * - The file then goes through the T4.7 CRX3 verifier with `expectedId` = the requested id, so a CRX3 for another
 *   id or with a bad signature is `CRX_INVALID`. A file that is not `Cr24` never reaches the ZIP path.
 *
 * Errors: store-side failures are {@link ChromeWebStoreError}; size, signature and cancellation reuse
 * {@link ExtensionSourceError} (`TOO_LARGE`, `CRX_INVALID`, `CANCELLED`) so callers keep one mapping for them.
 */

import { open } from 'node:fs/promises';
import path from 'node:path';
import { installExtensionFromCrx } from './crx';
import {
  createStagingDirectory,
  ExtensionSourceError,
  removeQuietly,
  type ExtensionInstallDeps,
  type ExtensionInstallOptions,
  type ExtensionInstallResult,
} from './folder';

export type ChromeWebStoreErrorCode =
  /** The input is neither a Web Store id nor a Web Store detail URL. */
  | 'STORE_INPUT_INVALID'
  /** Network failure, timeout, non-success status, empty answer or unreadable update answer. */
  | 'STORE_UNAVAILABLE'
  /** A hop used a host, scheme, port or credentials outside the allowed set. */
  | 'STORE_HOST_REFUSED';

/** Stable failure of the Web Store source; callers branch on `code` and never parse the message. */
export class ChromeWebStoreError extends Error {
  readonly code: ChromeWebStoreErrorCode;
  /** The refused host, for `STORE_HOST_REFUSED` only. */
  readonly host?: string;
  constructor(code: ChromeWebStoreErrorCode, message: string, host?: string) {
    super(message);
    this.name = 'ChromeWebStoreError';
    this.code = code;
    if (host !== undefined) this.host = host;
  }
}

/** Hosts a download may touch (design section 12.6, confirmed by spike S-6). Exact match, lower case. */
export const CHROME_WEB_STORE_HOSTS: ReadonlySet<string> = new Set([
  'clients2.google.com',
  'clients2.googleusercontent.com',
  'edgedl.me.gvt1.com',
]);

const UPDATE_ENDPOINT = 'https://clients2.google.com/service/update2/crx';
const DETAIL_HOST = 'chromewebstore.google.com';
const MAX_INPUT_CHARS = 2048;
const MAX_REDIRECTS = 5;
/** Section 12.6: 100 MB, 60 seconds. */
export const DEFAULT_MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_UPDATE_ANSWER_BYTES = 64 * 1024;

const ID_PATTERN = /^[a-p]{32}$/u;
const VERSION_PATTERN = /^\d{1,9}(?:\.\d{1,9}){0,3}$/u;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const unavailable = (reason: string): ChromeWebStoreError =>
  new ChromeWebStoreError('STORE_UNAVAILABLE', `Chrome Web Store không phản hồi được: ${reason}`);
const refused = (reason: string, host?: string): ChromeWebStoreError =>
  new ChromeWebStoreError('STORE_HOST_REFUSED', `Từ chối kết nối tải tiện ích: ${reason}`, host);
const tooLarge = (): ExtensionSourceError =>
  new ExtensionSourceError('TOO_LARGE', 'Tệp tải từ Chrome Web Store vượt giới hạn kích thước.');

/* ---------- input ---------- */

/**
 * Extracts the extension id from an id or a `https://chromewebstore.google.com/detail/<name>/<id>` URL. Any other
 * shape (other hosts, other paths, credentials, ports, `http`) is `STORE_INPUT_INVALID`.
 */
export const parseChromeWebStoreInput = (input: string): string => {
  const text = input.trim();
  const bad = (): ChromeWebStoreError =>
    new ChromeWebStoreError(
      'STORE_INPUT_INVALID',
      'Hãy nhập mã tiện ích (32 chữ a–p) hoặc URL trang Chrome Web Store.'
    );
  if (text.length === 0 || text.length > MAX_INPUT_CHARS) throw bad();
  if (ID_PATTERN.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw bad();
  }
  if (url.protocol !== 'https:' || url.hostname !== DETAIL_HOST) throw bad();
  if (url.username !== '' || url.password !== '' || url.port !== '') throw bad();
  const raw = url.pathname.split('/');
  // A leading empty segment (the root slash) and one trailing slash are allowed; empty segments elsewhere are not.
  const segments = raw.slice(1, raw[raw.length - 1] === '' ? -1 : undefined);
  const [root, name, id, ...rest] = segments;
  if (root !== 'detail' || name === undefined || name === '' || id === undefined || rest.length > 0) throw bad();
  if (!ID_PATTERN.test(id)) throw bad();
  return id;
};

const assertProdVersion = (version: string): string => {
  if (!VERSION_PATTERN.test(version)) throw unavailable('không xác định được phiên bản Chromium.');
  return version;
};

/** The `update2` URL that downloads the CRX3 of `id` (design section 12.6). */
export const buildChromeWebStoreDownloadUrl = (id: string, chromiumVersion: string): string =>
  `${UPDATE_ENDPOINT}?response=redirect&prodversion=${assertProdVersion(chromiumVersion)}&acceptformat=crx3&x=id%3D${id}%26uc`;

/** The `update2` URL for the update check (same endpoint, `response=updatecheck`). */
export const buildChromeWebStoreUpdateCheckUrl = (id: string, chromiumVersion: string): string =>
  `${UPDATE_ENDPOINT}?response=updatecheck&prodversion=${assertProdVersion(chromiumVersion)}&acceptformat=crx3&x=id%3D${id}%26uc`;

/** Canonical page of an extension, for the "Từ Chrome Web Store" link in the UI. */
export const chromeWebStorePageUrl = (id: string): string => `https://${DETAIL_HOST}/detail/${id}`;

/* ---------- network port ---------- */

export type StoreResponse = Readonly<{
  status: number;
  /** Header lookup, case-insensitive; `null` when absent. */
  header: (name: string) => string | null;
  body: AsyncIterable<Uint8Array> | null;
}>;

export type StorePort = Readonly<{
  /**
   * One GET. The implementation must NOT follow redirects (the caller checks every hop) and must send no cookies
   * or credentials. It rejects when the signal aborts.
   */
  request: (url: string, init: Readonly<{ signal: AbortSignal }>) => Promise<StoreResponse>;
  /** Version of the Chromium inside Electron (`process.versions.chrome`), for `prodversion`. */
  chromiumVersion: string;
  /** Receives the host of a refused hop, so the allow list can be reviewed. */
  log?: (event: Readonly<{ kind: 'host-refused'; host: string }>) => void;
}>;

type FetchReader = Readonly<{
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  cancel: () => Promise<void>;
}>;

type FetchLike = (
  url: string,
  init: Readonly<{ redirect: 'manual'; credentials: 'omit'; method: 'GET'; signal: AbortSignal }>
) => Promise<{
  status: number;
  headers: { get: (name: string) => string | null };
  body: { getReader: () => FetchReader } | null;
}>;

const streamOf = (reader: FetchReader): AsyncIterable<Uint8Array> =>
  (async function* chunks(): AsyncGenerator<Uint8Array> {
    try {
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- a stream is read in order.
        const next = await reader.read();
        if (next.done || next.value === undefined) return;
        yield next.value;
      }
    } finally {
      await reader.cancel().catch((): undefined => undefined);
    }
  })();

/** Adapts `fetch` (Node, Electron `net.fetch`) to {@link StorePort}: redirects manual, credentials omitted. */
export const createFetchStorePort = (
  fetchImpl: FetchLike,
  options: Readonly<{ chromiumVersion: string; log?: StorePort['log'] }>
): StorePort => ({
  chromiumVersion: options.chromiumVersion,
  ...(options.log === undefined ? {} : { log: options.log }),
  request: async (url, init) => {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      credentials: 'omit',
      method: 'GET',
      signal: init.signal,
    });
    const reader = response.body?.getReader();
    const redirected = REDIRECT_STATUSES.has(response.status);
    if (reader !== undefined && redirected) await reader.cancel().catch((): undefined => undefined);
    return {
      status: response.status,
      header: (name) => response.headers.get(name),
      body: reader === undefined || redirected ? null : streamOf(reader),
    };
  },
});

/* ---------- guarded request ---------- */

type Guard = Readonly<{ signal: AbortSignal; stop: () => void; reason: () => 'timeout' | 'cancelled' | undefined }>;

const createGuard = (timeoutMs: number, external: AbortSignal | undefined): Guard => {
  const controller = new AbortController();
  let why: 'timeout' | 'cancelled' | undefined;
  const timer = setTimeout(() => {
    why ??= 'timeout';
    controller.abort();
  }, timeoutMs);
  const onExternal = (): void => {
    why ??= 'cancelled';
    controller.abort();
  };
  if (external?.aborted === true) onExternal();
  else external?.addEventListener('abort', onExternal, { once: true });
  return {
    signal: controller.signal,
    reason: () => why,
    stop: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternal);
    },
  };
};

/** Maps any failure raised while the guard was (or may have been) tripped to a stable error. */
const mapFailure = (error: unknown, guard: Guard): Error => {
  if (error instanceof ChromeWebStoreError || error instanceof ExtensionSourceError) return error;
  const why = guard.reason();
  if (why === 'cancelled') return new ExtensionSourceError('CANCELLED', 'Đã huỷ cài tiện ích.');
  if (why === 'timeout') return unavailable('hết thời gian chờ.');
  return unavailable('lỗi mạng.');
};

const checkHop = (raw: string, base: string | undefined, port: StorePort): URL => {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw refused('địa chỉ chuyển hướng không hợp lệ.');
  }
  if (url.protocol !== 'https:') throw refused('chỉ chấp nhận https (không hạ xuống http).', url.hostname);
  if (url.username !== '' || url.password !== '') throw refused('địa chỉ có thông tin đăng nhập.', url.hostname);
  if (url.port !== '') throw refused('địa chỉ dùng cổng không mặc định.', url.hostname);
  if (!CHROME_WEB_STORE_HOSTS.has(url.hostname)) {
    port.log?.({ kind: 'host-refused', host: url.hostname });
    throw refused(`máy chủ ${url.hostname} không nằm trong danh sách cho phép.`, url.hostname);
  }
  return url;
};

/** Follows redirects one hop at a time, checking each target before requesting it; returns the 200 response. */
const requestFinal = async (port: StorePort, start: string, guard: Guard): Promise<StoreResponse> => {
  let current = checkHop(start, undefined, port);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    // A signal that is already aborted must stop the run even when the port ignores it.
    if (guard.signal.aborted) throw mapFailure(new Error('aborted'), guard);
    let response: StoreResponse;
    try {
      // oxlint-disable-next-line no-await-in-loop -- each hop depends on the previous answer.
      response = await port.request(current.href, { signal: guard.signal });
    } catch (error) {
      throw mapFailure(error, guard);
    }
    if (response.status === 200) return response;
    if (!REDIRECT_STATUSES.has(response.status)) throw unavailable(`mã trạng thái ${response.status}.`);
    const location = response.header('location');
    if (location === null || location === '') throw unavailable('chuyển hướng không có địa chỉ đích.');
    current = checkHop(location, current.href, port);
  }
  throw unavailable('quá nhiều lần chuyển hướng.');
};

const writeAll = async (handle: Awaited<ReturnType<typeof open>>, chunk: Uint8Array): Promise<void> => {
  let offset = 0;
  while (offset < chunk.length) {
    // oxlint-disable-next-line no-await-in-loop -- partial writes continue in order.
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
    offset += bytesWritten;
  }
};

const declaredLength = (response: StoreResponse): number | undefined => {
  const raw = response.header('content-length');
  if (raw === null || !/^\d{1,15}$/u.test(raw.trim())) return undefined;
  return Number(raw.trim());
};

/** Streams the body to `file` (created exclusively) and refuses once more than `maxBytes` arrived. */
const saveBody = async (response: StoreResponse, file: string, maxBytes: number, guard: Guard): Promise<void> => {
  const declared = declaredLength(response);
  if (declared !== undefined && declared > maxBytes) throw tooLarge();
  if (response.body === null) throw unavailable('không có nội dung tải về.');
  let total = 0;
  const handle = await open(file, 'wx');
  try {
    for await (const chunk of response.body) {
      total += chunk.byteLength;
      if (total > maxBytes) throw tooLarge();
      await writeAll(handle, chunk);
    }
  } catch (error) {
    throw mapFailure(error, guard);
  } finally {
    await handle.close().catch((): undefined => undefined);
  }
  if (total === 0) throw unavailable('Web Store trả về tệp rỗng.');
};

/* ---------- install ---------- */

export type ChromeWebStoreInstallOptions = ExtensionInstallOptions &
  Readonly<{ maxDownloadBytes?: number; timeoutMs?: number }>;

export type ChromeWebStoreInstallResult = ExtensionInstallResult &
  Readonly<{
    extensionId: string;
    /** What the caller records on the package (section 12.6); the build request has no field for it. */
    provenance: Readonly<{ kind: 'chrome-web-store'; extensionId: string; extensionVersion: string }>;
    storeUrl: string;
  }>;

/**
 * Downloads the CRX3 of an extension from the Web Store (allowed hosts only), verifies it against the requested id
 * with the T4.7 verifier and installs it as `local-built`. `input` is an id or a Web Store detail URL.
 */
export const installExtensionFromChromeWebStore = async (
  deps: ExtensionInstallDeps,
  port: StorePort,
  input: string,
  options: ChromeWebStoreInstallOptions = {}
): Promise<ChromeWebStoreInstallResult> => {
  const id = parseChromeWebStoreInput(input);
  const url = buildChromeWebStoreDownloadUrl(id, port.chromiumVersion);
  const guard = createGuard(options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS, options.signal);
  let staging: string | undefined;
  try {
    staging = await createStagingDirectory(deps);
    const file = path.join(staging, 'download.crx');
    try {
      const response = await requestFinal(port, url, guard);
      await saveBody(response, file, options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES, guard);
    } finally {
      guard.stop();
    }
    const result = await installExtensionFromCrx(deps, file, {
      expectedId: id,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    });
    // The verifier already required the proven id to equal `id`; this guards against a later change of that contract.
    if (result.extensionId !== id) {
      throw new ExtensionSourceError('CRX_INVALID', 'Mã tiện ích sau khi nạp khác mã trên Chrome Web Store.');
    }
    return {
      ...result,
      extensionId: id,
      provenance: { kind: 'chrome-web-store', extensionId: id, extensionVersion: result.extensionVersion },
      storeUrl: chromeWebStorePageUrl(id),
    };
  } finally {
    guard.stop();
    if (staging !== undefined) await removeQuietly(staging);
  }
};

/* ---------- update check (only when the user clicks) ---------- */

export type ChromeWebStoreUpdateInfo = Readonly<{ latestVersion: string; newer: boolean }>;

/** Compares dotted numeric versions; missing parts count as 0. */
export const compareExtensionVersions = (left: string, right: string): number => {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
};

const readSmallBody = async (response: StoreResponse, guard: Guard): Promise<string> => {
  if (response.body === null) throw unavailable('không có nội dung trả lời.');
  const declared = declaredLength(response);
  if (declared !== undefined && declared > MAX_UPDATE_ANSWER_BYTES) throw unavailable('câu trả lời quá lớn.');
  const parts: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of response.body) {
      total += chunk.byteLength;
      if (total > MAX_UPDATE_ANSWER_BYTES) throw unavailable('câu trả lời quá lớn.');
      parts.push(Buffer.from(chunk));
    }
  } catch (error) {
    throw mapFailure(error, guard);
  }
  return Buffer.concat(parts).toString('utf8');
};

/**
 * Asks the Web Store for the latest version of `id` and compares it with `installedVersion`. Returns `undefined`
 * when the store reports no update entry. Same host rules, timeout and cancellation as the download.
 */
export const checkChromeWebStoreUpdate = async (
  port: StorePort,
  id: string,
  installedVersion: string,
  options: Readonly<{ timeoutMs?: number; signal?: AbortSignal }> = {}
): Promise<ChromeWebStoreUpdateInfo | undefined> => {
  if (!ID_PATTERN.test(id)) throw new ChromeWebStoreError('STORE_INPUT_INVALID', 'Mã tiện ích không hợp lệ.');
  if (!VERSION_PATTERN.test(installedVersion)) throw unavailable('phiên bản đã cài không hợp lệ.');
  const guard = createGuard(options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS, options.signal);
  try {
    const response = await requestFinal(port, buildChromeWebStoreUpdateCheckUrl(id, port.chromiumVersion), guard);
    const text = await readSmallBody(response, guard);
    const tag = /<updatecheck\b[^>]*>/u.exec(text)?.[0];
    if (tag === undefined || /\bstatus="(?:noupdate|error-[^"]*)"/u.test(tag)) return undefined;
    const version = /\bversion="([^"]*)"/u.exec(tag)?.[1];
    if (version === undefined) return undefined;
    if (!VERSION_PATTERN.test(version)) throw unavailable('phiên bản trả về không hợp lệ.');
    return { latestVersion: version, newer: compareExtensionVersions(version, installedVersion) > 0 };
  } finally {
    guard.stop();
  }
};
