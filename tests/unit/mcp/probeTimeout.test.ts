import { describe, expect, it } from 'vitest';
import { probeTimeoutFor } from '../../../packages/desktop/src/process/resources/nativePlatform/mcpDrivers';

describe('how long an MCP connection test may take', () => {
  it('gives package launchers time to download the package on a cold cache (about 100 s here)', () => {
    for (const command of ['npx', 'uvx', 'bunx', 'node', 'C:/Program Files/nodejs/npx.cmd']) {
      expect(probeTimeoutFor({ type: 'stdio', command }, 15_000)).toBe(180_000);
    }
  });

  it('keeps the short limit for programs reached over the network or compiled binaries', () => {
    expect(probeTimeoutFor({ type: 'stdio', command: 'my-server' }, 15_000)).toBe(15_000);
    expect(probeTimeoutFor({ type: 'streamable_http', url: 'https://example.com/mcp' }, 15_000)).toBe(15_000);
  });

  it('never shortens a longer limit that was asked for', () => {
    expect(probeTimeoutFor({ type: 'stdio', command: 'npx' }, 200_000)).toBe(200_000);
  });
});
