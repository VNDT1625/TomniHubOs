import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { IMcpServer } from '../../../packages/desktop/src/common/config/storage';
import {
  NativeMcpProbe,
  redactProbeText,
  stdioServerEnv,
} from '../../../packages/desktop/src/process/resources/nativePlatform/mcpDrivers';

/** A stdio MCP server whose behaviour is steered by its environment (see FAKE_* below). */
const FAKE_SERVER = [
  "const fs = require('node:fs');",
  "const readline = require('node:readline');",
  'const bytes = Number(process.env.FAKE_STDERR_BYTES || 0);',
  "if (bytes > 0) fs.writeSync(2, 'x'.repeat(bytes) + '\\n');",
  "if (process.env.FAKE_FAIL === '1') {",
  "  fs.writeSync(2, 'startup failed token=' + process.env.FAKE_TOKEN + ' api_key=ZZZ999 at https://user:pw1234@host.example/x\\n');",
  '  process.exit(3);',
  '}',
  'const rl = readline.createInterface({ input: process.stdin });',
  "rl.on('line', (line) => {",
  '  const msg = JSON.parse(line);',
  "  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');",
  "  if (msg.method === 'initialize') {",
  "    setTimeout(() => reply({ protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1.0.0' } }), Number(process.env.FAKE_INIT_DELAY_MS || 0));",
  "  } else if (msg.method === 'tools/list') {",
  "    reply({ tools: [{ name: 'ping', inputSchema: { type: 'object' } }] });",
  '  }',
  '});',
  '',
].join('\n');

let fixtureDir = '';
let fixturePath = '';

beforeAll(async () => {
  fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'mcp-probe-fixture-'));
  fixturePath = path.join(fixtureDir, 'fake-server.cjs');
  await writeFile(fixturePath, FAKE_SERVER, 'utf8');
});

afterAll(async () => {
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
});

const serverWith = (env: Record<string, string>): IMcpServer => ({
  id: 'probe-test',
  name: 'Fake Server',
  enabled: true,
  transport: { type: 'stdio', command: process.execPath, args: [fixturePath], env },
  created_at: 1,
  updated_at: 1,
  original_json: '{}',
});

/** Resolution is the identity here: the fixture carries no package placeholders. */
const passThrough = async (server: Pick<IMcpServer, 'name' | 'transport'>) => ({
  transport: server.transport,
  secrets: [] as string[],
});

describe('environment of a stdio MCP server', () => {
  const source: NodeJS.ProcessEnv = {
    PATH: 'C:\\Node;C:\\Windows',
    SystemRoot: 'C:\\Windows',
    APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    USERPROFILE: 'C:\\Users\\me',
    HOME: 'C:\\Users\\me',
    TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp',
    TMP: 'C:\\Users\\me\\AppData\\Local\\Temp',
    HTTPS_PROXY: 'http://proxy.local:8080',
    NODE_EXTRA_CA_CERTS: 'C:\\certs\\corp.pem',
    npm_config_registry: 'https://registry.example.test/',
    npm_config__authToken: 'npm-token-value',
    'npm_config_//registry.example.test/:_authToken': 'registry-token-value',
    OPENAI_API_KEY: 'sk-live-openai',
    GITHUB_TOKEN: 'ghp_live',
    ELECTRON_RUN_AS_NODE: '1',
  };

  it('passes what npx and proxied or private-CA networks need', () => {
    const env = stdioServerEnv(undefined, source);
    for (const name of ['PATH', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'TEMP', 'TMP']) {
      expect(env[name]).toBe(source[name]);
    }
    expect(env.HTTPS_PROXY).toBe('http://proxy.local:8080');
    expect(env.NODE_EXTRA_CA_CERTS).toBe('C:\\certs\\corp.pem');
    expect(env.npm_config_registry).toBe('https://registry.example.test/');
  });

  it('never passes credentials or the app’s own keys', () => {
    const env = stdioServerEnv(undefined, source);
    expect(env).not.toHaveProperty('npm_config__authToken');
    expect(env).not.toHaveProperty('npm_config_//registry.example.test/:_authToken');
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env).not.toHaveProperty('GITHUB_TOKEN');
    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
  });

  it('adds the variables the server declares, which win over inherited ones', () => {
    const env = stdioServerEnv({ MY_SETTING: 'on', PATH: 'C:\\Custom' }, source);
    expect(env.MY_SETTING).toBe('on');
    expect(env.PATH).toBe('C:\\Custom');
  });
});

describe('redacting probe text', () => {
  it('removes the filled-in values, bearer tokens, token pairs and URL user information', () => {
    const text = redactProbeText(
      'Bearer abc.def-ghi failed; token=XYZ123 password: hunter2 at https://bob:pw1234@host.example/p',
      ['hunter2']
    );
    expect(text).not.toContain('abc.def-ghi');
    expect(text).not.toContain('XYZ123');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('pw1234');
    expect(text).toContain('[redacted]');
  });
});

describe('MCP connection test of a stdio server', () => {
  it('drains a large stderr burst instead of stalling the server', async () => {
    const probe = new NativeMcpProbe(10_000, passThrough, () => undefined, 10_000);
    const result = await probe.test(serverWith({ FAKE_STDERR_BYTES: '262144' }));
    expect(result.success).toBe(true);
    expect(result.tools?.map((tool) => tool.name)).toEqual(['ping']);
  });

  it('returns the server output and never a secret, and logs the failure', async () => {
    const logged: string[] = [];
    const probe = new NativeMcpProbe(10_000, passThrough, (message) => logged.push(message), 10_000);
    const result = await probe.test(serverWith({ FAKE_FAIL: '1', FAKE_TOKEN: 'SUPERSECRET-123456' }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Server output:');
    expect(result.error).toContain('startup failed');
    expect(result.error).not.toContain('SUPERSECRET-123456');
    expect(result.error).not.toContain('ZZZ999');
    expect(result.error).not.toContain('pw1234');

    expect(logged).toHaveLength(1);
    const line = logged[0] ?? '';
    expect(line).toContain('[MCP probe] "Fake Server" failed');
    expect(line).toContain(`command=${process.execPath}`);
    expect(line).toContain('cwd=(inherited)');
    expect(line).toContain('stderr tail');
    expect(line).not.toContain('SUPERSECRET-123456');
    expect(line).not.toContain('ZZZ999');
    expect(line).not.toContain('pw1234');
  });

  it('passes the probe budget to the SDK, not the 60 second default', async () => {
    const spy = vi.spyOn(Client.prototype, 'connect');
    try {
      const probe = new NativeMcpProbe(12_345, passThrough, () => undefined, 12_345);
      await probe.test(serverWith({}));
      expect(spy.mock.calls[0]?.[1]).toEqual({ timeout: 12_345 });
    } finally {
      spy.mockRestore();
    }
  });

  it('fails within the probe budget when the server answers too late', async () => {
    const probe = new NativeMcpProbe(500, passThrough, () => undefined, 500);
    const result = await probe.test(serverWith({ FAKE_INIT_DELAY_MS: '3000' }));
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
