/**
 * Prepare the MIT-licensed 9Router routing engine as a standalone Tomni resource.
 *
 * Tomni owns the lifecycle, encrypted management credentials, UI and client
 * configuration. The pinned upstream supplies the provider OAuth, protocol
 * translation, fallback and usage engine so those behaviours are not
 * reimplemented independently.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { applyTomniOverlay } = require('./model-gateway/applyTomniOverlay.js');

const UPSTREAM_URL = 'https://github.com/decolua/9router.git';
const UPSTREAM_COMMIT = '79918c7830695bbca4a45c9fea4a42c3e9fd73d1';
const UPSTREAM_VERSION = '0.5.40';
const BUNDLE_REVISION = 3;

const projectRoot = path.resolve(__dirname, '../../..');
const runtimeArch = process.env.TOMNI_MODEL_GATEWAY_ARCH || process.arch;
const runtimeKey = `${process.platform}-${runtimeArch}`;
const sourceDir = process.env.TOMNI_MODEL_GATEWAY_SOURCE_DIR
  ? path.resolve(projectRoot, process.env.TOMNI_MODEL_GATEWAY_SOURCE_DIR)
  : path.join(projectRoot, '.tmp', 'model-gateway-9router');
const skipSourceBuild = process.env.TOMNI_MODEL_GATEWAY_SKIP_SOURCE_BUILD === '1';
const targetDir = path.join(projectRoot, 'resources', 'bundled-model-gateway', runtimeKey);
const manifestPath = path.join(targetDir, 'manifest.json');

const readManifest = () => {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return undefined;
  }
};

const run = (file, args, cwd = projectRoot) => {
  execFileSync(file, args, {
    cwd,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: 'inherit',
  });
};

const runNpm = (args, cwd) => {
  if (process.platform === 'win32') {
    run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args], cwd);
    return;
  }
  run('npm', args, cwd);
};

const copyRuntime = () => {
  const standaloneDir = path.join(sourceDir, '.next', 'standalone');
  const serverEntry = path.join(standaloneDir, 'server.js');
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`9Router standalone build did not produce ${serverEntry}`);
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(standaloneDir, targetDir, { recursive: true });

  const copies = [
    ['public', 'public'],
    [path.join('.next', 'static'), path.join('.next', 'static')],
    ['open-sse', 'open-sse'],
    [path.join('src', 'mitm'), path.join('src', 'mitm')],
  ];
  for (const [from, to] of copies) {
    const source = path.join(sourceDir, from);
    if (!fs.existsSync(source)) continue;
    fs.mkdirSync(path.dirname(path.join(targetDir, to)), { recursive: true });
    fs.cpSync(source, path.join(targetDir, to), { recursive: true });
  }
  fs.copyFileSync(path.join(sourceDir, 'custom-server.js'), path.join(targetDir, 'custom-server.js'));
  fs.copyFileSync(path.join(sourceDir, 'LICENSE'), path.join(targetDir, 'LICENSE.9router'));
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        bundleRevision: BUNDLE_REVISION,
        name: 'tomni-model-gateway',
        upstream: UPSTREAM_URL,
        upstreamCommit: UPSTREAM_COMMIT,
        upstreamVersion: UPSTREAM_VERSION,
        runtimeKey,
        entry: 'custom-server.js',
        tomniFeatures: ['usage-by-consumer', 'usage-by-session', 'token-measurement-provenance'],
        preparedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`
  );
};

const existing = readManifest();
if (
  existing?.upstreamCommit === UPSTREAM_COMMIT &&
  existing?.bundleRevision === BUNDLE_REVISION &&
  existing?.runtimeKey === runtimeKey &&
  fs.existsSync(path.join(targetDir, 'custom-server.js'))
) {
  console.log(`Tomni model gateway already prepared: resources/bundled-model-gateway/${runtimeKey}`);
  process.exit(0);
}

if (!skipSourceBuild) {
  if (!fs.existsSync(path.join(sourceDir, '.git'))) {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(sourceDir), { recursive: true });
    run('git', ['clone', '--no-checkout', '--filter=blob:none', UPSTREAM_URL, sourceDir]);
  }

  run('git', ['fetch', '--depth', '1', 'origin', UPSTREAM_COMMIT], sourceDir);
  run('git', ['checkout', '--force', UPSTREAM_COMMIT], sourceDir);
  applyTomniOverlay(sourceDir);
  // Never trust a previous interrupted preparation. npm may leave package
  // metadata behind while individual runtime files are still missing.
  fs.rmSync(path.join(sourceDir, 'node_modules'), { recursive: true, force: true });
  // The pinned upstream lockfile currently contains optional native dependency
  // drift, so `npm ci` rejects it. A fresh clone plus one uninterrupted install
  // still gives us a clean dependency tree while the git commit pins source.
  runNpm(['install', '--no-audit', '--no-fund'], sourceDir);
  // caniuse-lite 1.0.30001806 was published without dist/unpacker/agents.js,
  // which makes Next's browserslist bundle fail at build time. Keep the last
  // complete data package pinned until upstream's range resolves to a fixed one.
  runNpm(['install', '--no-save', '--no-audit', '--no-fund', 'caniuse-lite@1.0.30001805'], sourceDir);
  // 9Router treats better-sqlite3 as optional and falls back to sql.js. Do not
  // ship a binary compiled for the build machine's Node ABI inside Electron.
  fs.rmSync(path.join(sourceDir, 'node_modules', 'better-sqlite3'), { recursive: true, force: true });
  runNpm(['run', 'build'], sourceDir);
}
copyRuntime();
console.log(`Tomni model gateway prepared: resources/bundled-model-gateway/${runtimeKey}`);
