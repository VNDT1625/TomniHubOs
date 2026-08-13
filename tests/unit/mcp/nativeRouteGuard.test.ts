import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string): Promise<string> =>
  readFile(path.resolve(process.cwd(), relativePath), 'utf8');

describe('native MCP route guard', () => {
  it('keeps renderer MCP catalogs off legacy settings and extension HTTP routes', async () => {
    const [catalog, bridge] = await Promise.all([
      readSource('packages/desktop/src/renderer/hooks/mcp/catalog.ts'),
      readSource('packages/desktop/src/common/adapter/ipcBridge.ts'),
    ]);

    expect(catalog).not.toContain("'/api/settings/client'");
    expect(bridge).not.toContain("'/api/extensions/mcp-servers'");
  });

  it('boots native MCP before any legacy backend readiness exists', async () => {
    const processEntry = await readSource('packages/desktop/src/process/index.ts');

    expect(processEntry).toContain('await runNativeMcpBootstrap({ legacyBackendStarted: false })');
  });

  it('does not synchronize built-in MCP state back into the old backend', async () => {
    const migrations = await readSource('packages/desktop/src/process/utils/runBackendMigrations.ts');

    expect(migrations).not.toContain('syncBuiltinMcpConfig');
  });
});
