import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const manager = require('../../../scripts/dev/serviceManager.cjs') as {
  buildServiceSpecs: (config: Record<string, unknown>, env?: NodeJS.ProcessEnv) => Record<string, unknown>;
  normalizeTargets: (targets?: string[]) => Set<string>;
  parsePort: (value: unknown, fallback: number) => number;
  resolveDesktopDataDir: (env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homeDir: string) => string;
};

describe('persistent development services', () => {
  it('uses an explicit shared data directory when configured', () => {
    const configured = manager.resolveDesktopDataDir(
      { TOMNI_DEV_DATA_DIR: './tmp/dev-data' },
      'win32',
      'C:\\Users\\tester'
    );

    expect(configured).toBe(path.resolve('./tmp/dev-data'));
  });

  it('matches the Electron development data directory on Windows by default', () => {
    const dataDir = manager.resolveDesktopDataDir({ APPDATA: 'D:\\Profiles\\Roaming' }, 'win32', 'D:\\Profiles');

    expect(dataDir).toBe(path.join('D:\\Profiles\\Roaming', 'Tomny-Dev', 'tomny'));
  });

  it('rejects privileged and invalid port overrides', () => {
    expect(manager.parsePort('80', 25809)).toBe(25809);
    expect(manager.parsePort('not-a-port', 17890)).toBe(17890);
    expect(manager.parsePort('31000', 25809)).toBe(31000);
  });

  it('builds separate WebUI, MCP and renderer health contracts', () => {
    const config = {
      repoRoot: 'C:\\repo',
      webuiPort: 25809,
      mcpPort: 17890,
      rendererPort: 5174,
      stateDir: 'C:\\state',
      dataDir: 'C:\\data',
      webLogPath: 'C:\\logs\\web.log',
      mcpLogPath: 'C:\\logs\\mcp.log',
    };
    const specs = manager.buildServiceSpecs(config, {});

    expect(specs.webui).toMatchObject({ healthUrl: 'http://127.0.0.1:25809/api/auth/status' });
    expect(specs.mcp).toMatchObject({ healthUrl: 'http://127.0.0.1:17890/health' });
    expect(specs.renderer).toMatchObject({ healthUrl: 'http://127.0.0.1:5174/' });
  });

  it('runs the browser renderer without launching Electron', () => {
    const config = {
      repoRoot: 'C:\\repo',
      webuiPort: 25809,
      mcpPort: 17890,
      rendererPort: 5174,
      stateDir: 'C:\\state',
      dataDir: 'C:\\data',
      webLogPath: 'C:\\logs\\web.log',
      mcpLogPath: 'C:\\logs\\mcp.log',
    };
    const specs = manager.buildServiceSpecs(config, {}) as { renderer: { args: string[] } };

    expect(specs.renderer.args).toContain('vite');
    expect(specs.renderer.args).not.toContain('electron-vite');
  });

  it('starts MCP through the lifecycle-preserving sidecar shim', () => {
    const config = {
      repoRoot: 'C:\\repo',
      webuiPort: 25809,
      mcpPort: 17890,
      rendererPort: 5174,
      stateDir: 'C:\\state',
      dataDir: 'C:\\data',
      webLogPath: 'C:\\logs\\web.log',
      mcpLogPath: 'C:\\logs\\mcp.log',
    };
    const specs = manager.buildServiceSpecs(config, {}) as { mcp: { args: string[] } };

    expect(specs.mcp.args.join('/').replace(/\\/g, '/')).toContain('scripts/omni-mcp-sidecar.cjs');
  });

  it('supports independently restarting one development service', () => {
    expect([...manager.normalizeTargets(['mcp'])]).toEqual(['mcp']);
    expect(() => manager.normalizeTargets(['unknown'])).toThrow('Unknown dev service');
  });
});
