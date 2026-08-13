#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure Bun CLI — launches the WebUI (backend + static server + auth) without
 * starting Electron. Replaces the former `electron-vite dev -- --webui` flow.
 *
 * Env vars:
 *   TOMNY_PORT           : static server port (default 33000)
 *   TOMNY_HOST           : listen host; set to 0.0.0.0 to imply --remote
 *   TOMNY_ALLOW_REMOTE   : "1"/"true" to expose to LAN
 *   TOMNY_DATA_DIR       : override userData path (default Electron-compatible)
 *   TOMNY_LOG_DIR        : override log dir (default <dataDir>/logs)
 *   TOMNY_STATIC_DIR     : override static dir (default out/renderer)
 *   TOMNY_BACKEND_BIN    : absolute path to Tomny Core binary (else PATH lookup)
 *   TOMNY_BACKEND_BUNDLED_DIR : dir containing bundled-tomny-core/<plat-arch>/binary
 *   TOMNY_OPEN_BROWSER   : "1"/"true" to force open, "0"/"false" to disable
 */

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { startWebHost } from '@tomny/web-host';
import {
  FIRST_PARTY_PACKAGE_CATALOG,
  FIRST_PARTY_PACKAGE_SIGNING_POLICIES,
  FIRST_PARTY_PACKAGE_TRUSTED_KEYS,
  DEFAULT_PACKAGE_CATALOG_URL,
} from '../packages/desktop/src/common/packages/index.js';
import {
  createLocalPackageMutationRuntime,
  createPackageHttpApi,
} from '../packages/desktop/src/process/extensions/package-manager/packageHttpApi.js';
import { createPackageManagerService } from '../packages/desktop/src/process/extensions/package-manager/PackageManagerService.js';

import { createRemotePackageCatalogLoader } from '../packages/desktop/src/process/extensions/package-manager/remoteCatalog.js';
import { openBrowserUrl, shouldAutoOpenBrowser } from '../packages/web-cli/src/browser.js';

// Aligned with packages/desktop/src/common/config/constants.ts WEBUI_DEFAULT_PORT.
const DEFAULT_PORT = (() => {
  if (process.env.NODE_ENV === 'production') return 25808;
  if (process.env.TOMNY_MULTI_INSTANCE === '1') return 25810;
  return 25809;
})();
const BACKEND_BINARY = process.platform === 'win32' ? 'tomny-core.exe' : 'tomny-core';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

const LOCAL_PACKAGE_ARTIFACTS = new Map(
  FIRST_PARTY_PACKAGE_CATALOG.flatMap((entry) => {
    if (!entry.artifactUrl) return [];
    const filename = new URL(entry.artifactUrl).pathname.split('/').at(-1);
    if (!filename) return [];
    const artifactPath = path.join(repoRoot, 'store-artifacts', filename);
    return fs.existsSync(artifactPath) ? [[filename, artifactPath] as const] : [];
  })
);

const args = process.argv.slice(2);
const has = (name: string): boolean => args.includes(name);
const getFlag = (name: string): string | undefined => {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : undefined;
};

/**
 * Resolve the directory where Tomny Core persists its SQLite DB.
 *
 * `bun run webui` runs **independently of the Electron desktop app** — it must
 * work on hosts that never installed Tomny.app, and its default work dir must
 * NOT collide with Electron's.
 *
 *   --data-dir <path>       CLI override (highest priority)
 *   $TOMNY_DATA_DIR        env override (same effect)
 *   otherwise               ~/.tomny-web         (production)
 *                           ~/.tomny-web-dev     (dev, default)
 *                           ~/.tomny-web-dev-2   (dev + TOMNY_MULTI_INSTANCE=1)
 *
 * Why a dedicated `-web` name, not the same `~/.tomny[-dev]` that Electron
 * uses: on macOS, Electron's getDataPath() (packages/desktop/src/process/utils/
 * utils.ts) creates `~/.tomny-dev` as a **symlink** to
 * `~/Library/Application Support/Tomny-Dev/tomny` so CLI tools (claude,
 * gemini, qwen…) don't choke on the literal space in "Application Support".
 * If standalone webui runs first on a clean machine, it would create the
 * symlink location as a **real directory** instead. When Electron is later
 * installed, its `ensureCliSafeSymlink` refuses to overwrite a real dir and
 * falls back to returning the space-containing path — and then every ACP
 * agent inside the desktop app starts failing on CLI commands. Using
 * `.tomny-web` keeps standalone webui's data dir off of the path Electron's
 * symlink needs.
 *
 * If the user wants the two to share data they opt-in explicitly via
 *   --data-dir ~/.tomny-dev                     (or equivalent on other OSes)
 * which is safe because by that point Electron has created the symlink and
 * `bun run webui` just follows it.
 */
function resolveBackendDataDir(): string {
  const override = getFlag('--data-dir') ?? process.env.TOMNY_DATA_DIR;
  if (override && override.trim().length > 0) {
    const resolved = path.resolve(override);
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
  }
  const suffix =
    process.env.NODE_ENV === 'production' ? '' : process.env.TOMNY_MULTI_INSTANCE === '1' ? '-dev-2' : '-dev';
  const dir = path.join(os.homedir(), `.tomny-web${suffix}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function parseBoolean(v: string | undefined): boolean {
  if (!v) return false;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}

function resolvePort(): number {
  const cli = getFlag('--port');
  if (cli && /^\d+$/.test(cli)) return Number(cli);
  const env = process.env.TOMNY_PORT ?? process.env.PORT;
  if (env && /^\d+$/.test(env)) return Number(env);
  return DEFAULT_PORT;
}

function resolveAllowRemote(): boolean {
  if (has('--remote')) return true;
  const host = process.env.TOMNY_HOST?.trim();
  if (host && ['0.0.0.0', '::', '::0'].includes(host)) return true;
  return parseBoolean(process.env.TOMNY_ALLOW_REMOTE ?? process.env.TOMNY_REMOTE);
}

function resolveStaticDir(): string {
  if (process.env.TOMNY_STATIC_DIR) return process.env.TOMNY_STATIC_DIR;
  const candidate = path.join(repoRoot, 'out', 'renderer');
  if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
  throw new Error(`Renderer assets not found at ${candidate}. Run "bun run package" first, or set TOMNY_STATIC_DIR.`);
}

/**
 * Rebuild renderer/main bundles before launching, so that `bun run webui` always
 * serves the latest source. Skipped when:
 *   --no-build flag           : explicit opt-out (e.g., iterating on this script)
 *   $TOMNY_NO_BUILD=1        : env-level opt-out
 *   $TOMNY_STATIC_DIR is set : caller is pointing us at a prebuilt artifact dir
 */
function runPackageIfNeeded(): void {
  if (has('--no-build')) return;
  if (parseBoolean(process.env.TOMNY_NO_BUILD)) return;
  if (process.env.TOMNY_STATIC_DIR) return;
  console.log('[webui] running "bun run package" to refresh out/renderer (pass --no-build to skip)...');
  const start = Date.now();
  execSync('bun run package', { cwd: repoRoot, stdio: 'inherit' });
  console.log(`[webui] package finished in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

function resolveBackendBinary(): string {
  if (process.env.TOMNY_BACKEND_BIN) return process.env.TOMNY_BACKEND_BIN;

  const bundledBase = process.env.TOMNY_BACKEND_BUNDLED_DIR ?? path.join(repoRoot, 'resources', 'bundled-tomny-core');
  const runtimeKey = `${process.platform}-${process.arch}`;
  const bundled = path.join(bundledBase, runtimeKey, BACKEND_BINARY);
  if (fs.existsSync(bundled)) return bundled;

  try {
    const cmd = process.platform === 'win32' ? `where ${BACKEND_BINARY}` : `which ${BACKEND_BINARY}`;
    const found = execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim().split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) return found;
  } catch {
    // fall through
  }

  throw new Error(`Cannot find "${BACKEND_BINARY}". Set TOMNY_BACKEND_BIN, put it on PATH, or place it at ${bundled}.`);
}

/**
 * Prepend all nvm-managed Node bin dirs to PATH. Electron's main process does
 * this (see packages/desktop/src/index.ts), otherwise CLI tools installed under
 * a specific Node version (e.g. gemini under v25) won't be found by the backend
 * spawned by ACP — the `Superset: X not found in PATH` wrapper bails, so the
 * ACP handshake times out after 30s and the UI sees `502 Bad Gateway`.
 */
function augmentPathWithNvm(): void {
  if (process.platform === 'win32') return;
  const nvmDir = process.env.NVM_DIR || path.join(os.homedir(), '.nvm');
  const versionsDir = path.join(nvmDir, 'versions', 'node');
  if (!fs.existsSync(versionsDir)) return;
  try {
    const versions = fs.readdirSync(versionsDir);
    const nvmBins = versions.map((v) => path.join(versionsDir, v, 'bin')).filter((p) => fs.existsSync(p));
    if (nvmBins.length === 0) return;
    const current = process.env.PATH || '';
    const missing = nvmBins.filter((p) => !current.split(path.delimiter).includes(p));
    if (missing.length > 0) {
      process.env.PATH = [...missing, current].join(path.delimiter);
    }
  } catch {
    // best-effort
  }
}

/**
 * Read the WebUI admin username from backend. Returns 'admin' as a best-effort
 * fallback — useful when the backend is unreachable or the SQLite users row
 * has not been seeded yet.
 */
async function fetchAdminUsername(backendPort: number): Promise<string> {
  try {
    const res = await fetch(`http://127.0.0.1:${backendPort}/api/auth/internal/users/system`);
    if (!res.ok) return 'admin';
    const json = (await res.json()) as { data?: { username?: string } };
    return json.data?.username || 'admin';
  } catch {
    return 'admin';
  }
}

async function main(): Promise<void> {
  augmentPathWithNvm();
  runPackageIfNeeded();
  const port = resolvePort();
  const allowRemote = resolveAllowRemote();
  const autoOpenBrowser = shouldAutoOpenBrowser({
    allowRemote,
    env: process.env,
    openFlag: has('--open'),
    noOpenFlag: has('--no-open'),
  });
  // One working dir for the whole standalone webui: backend SQLite and chat
  // history live here. Admin credentials live in the backend's users table.
  // This keeps `bun run webui` fully self-contained on hosts without Tomny.app.
  const workDir = resolveBackendDataDir();
  const staticDir = resolveStaticDir();
  const backendBin = resolveBackendBinary();
  const logDir = process.env.TOMNY_LOG_DIR ?? path.join(workDir, 'logs');

  console.log('[webui] work dir   :', workDir);
  console.log('[webui] static dir :', staticDir);
  console.log('[webui] backend bin:', backendBin);
  console.log(`[webui] launching  : port=${port} allowRemote=${allowRemote}`);

  const handle = await startWebHost({
    app: {
      version: '0.0.0',
      isPackaged: false,
      resourcesPath: repoRoot,
      userDataPath: workDir,
    },
    staticDir,
    port,
    allowRemote,
    dataDir: workDir,
    logDir,
    // Surface the same work dir on /api/system/info so the browser UI shows
    // where standalone webui is actually persisting data. Without this the
    // backend inherits process.env and may report the parent shell's cwd.
    dirs: {
      cacheDir: workDir,
      workDir: workDir,
      logDir,
    },
    createLocalApiHandler: (backendPort) => {
      const packageRoot = path.join(workDir, 'tomny-packages');
      const packageService = createPackageManagerService({
        rootDir: packageRoot,
        appVersion: '0.0.0',
        catalog: FIRST_PARTY_PACKAGE_CATALOG,
        trustedKeys: FIRST_PARTY_PACKAGE_TRUSTED_KEYS,

        catalogLoader: createRemotePackageCatalogLoader({
          url: process.env.TOMNI_STORE_CATALOG_URL ?? DEFAULT_PACKAGE_CATALOG_URL,
          cachePath: path.join(workDir, 'tomny-packages', 'catalog-cache.json'),
          fallbackCatalog: FIRST_PARTY_PACKAGE_CATALOG,
          trustedKeys: FIRST_PARTY_PACKAGE_TRUSTED_KEYS,

          signingPolicies: FIRST_PARTY_PACKAGE_SIGNING_POLICIES,
        }),
        resolveArtifactUrl: (url) => {
          const filename = new URL(url).pathname.split('/').at(-1);
          return filename && LOCAL_PACKAGE_ARTIFACTS.has(filename)
            ? `http://127.0.0.1:${port}/api/packages/artifacts/${encodeURIComponent(filename)}`
            : url;
        },
        allowLocalArtifactUrls: process.env.NODE_ENV !== 'production',
      });
      const mutation = createLocalPackageMutationRuntime({
        service: packageService,
        ledgerRootDir: path.join(packageRoot, 'catalog-action-ledger'),
      });
      return createPackageHttpApi({
        service: packageService,
        mutation,
        artifactProvider: async (name) => {
          const artifactPath = LOCAL_PACKAGE_ARTIFACTS.get(name);
          return artifactPath ? fs.promises.readFile(artifactPath) : undefined;
        },
        authorize: async (request) => {
          const response = await fetch(`http://127.0.0.1:${backendPort}/api/auth/user`, {
            headers: {
              cookie: request.headers.cookie ?? '',
            },
          });
          return response.ok;
        },
        authorizeMutation: (request) => {
          if (request.headers['sec-fetch-site'] === 'cross-site') return false;
          const origin = request.headers.origin;
          if (!origin) return true;
          try {
            const hostname = new URL(origin).hostname;
            return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
          } catch {
            return false;
          }
        },
      });
    },
    backend: {
      kind: 'ownBackend',
      resolveBackend: () => backendBin,
    },
  });

  console.log('');
  console.log('Tomny WebUI is ready');
  console.log(`  Local  : ${handle.localUrl}`);
  if (handle.networkUrl) console.log(`  Network: ${handle.networkUrl}`);

  // If SQLite has no admin yet (fresh install), seed one via backend and print
  // the plaintext credentials. Mirrors webuiBridge.ts:maybeSeedInitialPassword
  // for the Electron path — SQLite is now the single source of truth.
  //
  // Username is surfaced explicitly: legacy dev databases may have the seeded
  // user as `system` instead of `admin`, and Electron users can rename it via
  // Settings. Always read it from the backend rather than assuming a value.
  try {
    const statusRes = await fetch(`http://127.0.0.1:${handle.backendPort}/api/auth/status`);
    if (statusRes.ok) {
      const status = (await statusRes.json()) as { needs_setup?: boolean };
      if (status.needs_setup === true) {
        const resetRes = await fetch(`http://127.0.0.1:${handle.backendPort}/api/webui/reset-password`, {
          method: 'POST',
        });
        if (resetRes.ok) {
          const payload = (await resetRes.json()) as { data?: { new_password?: string } };
          const initialPassword = payload.data?.new_password;
          if (initialPassword) {
            const adminUsername = await fetchAdminUsername(handle.backendPort);
            console.log('');
            console.log(`Initial admin username: ${adminUsername}`);
            console.log(`Initial admin password: ${initialPassword}`);
            console.log('(change them after first login)');
          }
        }
      } else {
        // Credentials already exist; just remind the user what username to use.
        const adminUsername = await fetchAdminUsername(handle.backendPort);
        console.log('');
        console.log(`Login username: ${adminUsername}`);
        console.log('(forgot the password? run `bun run resetpass` to generate a new one)');
      }
    }
  } catch (err) {
    console.warn('[webui] could not query admin credentials:', err);
  }

  if (autoOpenBrowser) {
    const openResult = openBrowserUrl(handle.localUrl);
    if (openResult.ok) {
      console.log(`[webui] opened ${handle.localUrl} in your browser.`);
    } else {
      console.warn(`[webui] could not open the browser automatically: ${openResult.reason}`);
    }
  }

  console.log('');
  console.log('Press Ctrl+C to stop.');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[webui] received ${signal}, stopping...`);
    try {
      await handle.stop();
    } catch (err) {
      console.error('[webui] stop error:', err);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[webui] failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
});
