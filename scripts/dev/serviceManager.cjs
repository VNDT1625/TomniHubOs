const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_WEBUI_PORT = 25809;
const DEFAULT_MCP_PORT = 17890;
const DEFAULT_RENDERER_PORT = 5174;

function parsePort(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1024 && parsed <= 65535 ? parsed : fallback;
}

function resolveDesktopDataDir(env = process.env, platform = process.platform, homeDir = os.homedir()) {
  const override = env.TOMNI_DEV_DATA_DIR?.trim();
  if (override) return path.resolve(override);
  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    return path.join(appData, 'Tomny-Dev', 'tomny');
  }
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Tomny-Dev', 'tomny');
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), 'Tomny-Dev', 'tomny');
}

function resolveConfig(env = process.env) {
  const stateDir = path.join(REPO_ROOT, '.tomni', 'dev-services');
  return {
    repoRoot: REPO_ROOT,
    stateDir,
    statePath: path.join(stateDir, 'state.json'),
    webLogPath: path.join(stateDir, 'webui.log'),
    mcpLogPath: path.join(stateDir, 'mcp.log'),
    webuiPort: parsePort(env.TOMNI_DEV_WEBUI_PORT, DEFAULT_WEBUI_PORT),
    mcpPort: parsePort(env.TOMNI_DEV_MCP_PORT, DEFAULT_MCP_PORT),
    rendererPort: parsePort(env.TOMNI_DEV_RENDERER_PORT, DEFAULT_RENDERER_PORT),
    dataDir: resolveDesktopDataDir(env),
  };
}

async function readState(config) {
  try {
    return JSON.parse(await fsp.readFile(config.statePath, 'utf8'));
  } catch {
    return undefined;
  }
}

async function writeState(config, state) {
  await fsp.mkdir(config.stateDir, { recursive: true });
  const temporary = `${config.statePath}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fsp.rename(temporary, config.statePath);
}

async function isHealthy(url, timeoutMs = 1_500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Service did not become healthy within ${timeoutMs}ms: ${url}`);
}

function spawnDetached(command, args, options) {
  fs.mkdirSync(path.dirname(options.logPath), { recursive: true });
  const log = fs.openSync(options.logPath, 'a');
  try {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
    });
    child.unref();
    return child.pid;
  } finally {
    fs.closeSync(log);
  }
}

async function terminateTree(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.once('exit', resolve);
      killer.once('error', resolve);
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // The process already exited.
    }
  }
}

function buildServiceSpecs(config, env = process.env) {
  const executable = process.platform === 'win32' ? 'bun.exe' : 'bun';
  const nodeExecutable = process.platform === 'win32' ? 'node.exe' : 'node';
  return {
    webui: {
      command: executable,
      args: [
        'run',
        'webui',
        '--no-build',
        '--no-open',
        '--port',
        String(config.webuiPort),
        '--data-dir',
        config.dataDir,
      ],
      healthUrl: `http://127.0.0.1:${config.webuiPort}/api/auth/status`,
      logPath: config.webLogPath,
      env: { ...env, TOMNY_OPEN_BROWSER: '0' },
    },
    mcp: {
      command: nodeExecutable,
      args: [path.join(config.repoRoot, 'scripts', 'omni-mcp-sidecar.cjs'), 'start'],
      healthUrl: `http://127.0.0.1:${config.mcpPort}/health`,
      logPath: config.mcpLogPath,
      env: {
        ...env,
        OMNI_MCP_PORT: String(config.mcpPort),
        OMNI_REPO_PATH: config.repoRoot,
        TOMNI_DEV_RENDERER_PORT: String(config.rendererPort),
        TOMNI_DEV_WEBUI_PORT: String(config.webuiPort),
      },
    },
    renderer: {
      command: executable,
      args: ['x', 'vite', '--config', 'scripts/dev/webRenderer.config.ts', '--host', '127.0.0.1'],
      healthUrl: `http://127.0.0.1:${config.rendererPort}/`,
      logPath: path.join(config.stateDir, 'renderer.log'),
      env: {
        ...env,
        TOMNI_WEB_DEV_PROXY: `http://127.0.0.1:${config.webuiPort}`,
        TOMNI_DEV_RENDERER_PORT: String(config.rendererPort),
      },
    },
  };
}

const normalizeTargets = (targets) => {
  const requested = targets?.length ? targets : ['webui', 'mcp', 'renderer'];
  const valid = new Set(['webui', 'mcp', 'renderer']);
  for (const target of requested) {
    if (!valid.has(target)) throw new Error(`Unknown dev service: ${target}.`);
  }
  return new Set(requested);
};

async function startServices(config = resolveConfig(), targets) {
  const selected = normalizeTargets(targets);
  const rendererEntry = path.join(config.repoRoot, 'out', 'renderer', 'index.html');
  if (selected.has('webui') && !fs.existsSync(rendererEntry)) {
    throw new Error('Renderer artifact is missing. Run `bun run package` once, then retry `bun run dev:services`.');
  }
  await fsp.mkdir(config.dataDir, { recursive: true });
  const previous = (await readState(config)) || {};
  const specs = buildServiceSpecs(config);
  const state = {
    version: 1,
    startedAt: previous.startedAt ?? new Date().toISOString(),
    services: { ...(previous.services ?? {}) },
  };

  for (const [name, spec] of Object.entries(specs)) {
    if (!selected.has(name)) continue;
    const alreadyHealthy = await isHealthy(spec.healthUrl);
    if (alreadyHealthy) {
      const old = previous.services?.[name];
      state.services[name] = {
        pid: old?.pid,
        owned: old?.owned === true,
        healthUrl: spec.healthUrl,
        logPath: spec.logPath,
        reused: true,
      };
      continue;
    }

    const pid = spawnDetached(spec.command, spec.args, {
      cwd: config.repoRoot,
      env: spec.env,
      logPath: spec.logPath,
    });
    state.services[name] = { pid, owned: true, healthUrl: spec.healthUrl, logPath: spec.logPath, reused: false };
    await writeState(config, state);
    try {
      const startupTimeoutMs = name === 'webui' ? 120_000 : 90_000;
      await waitForHealth(spec.healthUrl, startupTimeoutMs);
    } catch (error) {
      await terminateTree(pid);
      throw error;
    }
  }

  await writeState(config, state);
  return state;
}

async function getStatus(config = resolveConfig()) {
  const state = await readState(config);
  const specs = buildServiceSpecs(config);
  const services = {};
  for (const [name, spec] of Object.entries(specs)) {
    services[name] = {
      healthy: await isHealthy(spec.healthUrl),
      healthUrl: spec.healthUrl,
      pid: state?.services?.[name]?.pid,
      owned: state?.services?.[name]?.owned === true,
      logPath: spec.logPath,
    };
  }
  return {
    services,
    rendererUrl: `http://127.0.0.1:${config.rendererPort}`,
    webuiUrl: `http://127.0.0.1:${config.webuiPort}`,
  };
}

async function stopServices(config = resolveConfig(), targets) {
  const state = await readState(config);
  const selected = normalizeTargets(targets);
  const stopped = [];
  for (const name of ['renderer', 'mcp', 'webui']) {
    if (!selected.has(name)) continue;
    const service = state?.services?.[name];
    if (service?.owned && service.pid) {
      await terminateTree(service.pid);
      stopped.push(name);
    }
    if (state?.services) delete state.services[name];
  }
  if (state?.services && Object.keys(state.services).length > 0) await writeState(config, state);
  else await fsp.rm(config.statePath, { force: true });
  return stopped;
}

module.exports = {
  DEFAULT_MCP_PORT,
  DEFAULT_RENDERER_PORT,
  DEFAULT_WEBUI_PORT,
  buildServiceSpecs,
  getStatus,
  isHealthy,
  normalizeTargets,
  parsePort,
  readState,
  resolveConfig,
  resolveDesktopDataDir,
  startServices,
  stopServices,
  waitForHealth,
};
