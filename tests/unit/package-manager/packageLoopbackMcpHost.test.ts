import { describe, expect, it } from 'vitest';
import { startPackageLoopbackMcpHost } from '@/process/resources/packageProcessRuntime/packageLoopbackMcpHost';

const unusedServer = (): never => {
  throw new Error('MCP server should not be constructed by the health endpoint.');
};

describe('Package loopback MCP host', () => {
  it('rejects an unbounded host identifier before it opens a listener', async () => {
    await expect(
      startPackageLoopbackMcpHost({
        hostKey: 'invalid host key',
        serverName: 'test',
        buildServer: unusedServer,
      })
    ).rejects.toThrow('PACKAGE_LOOPBACK_MCP_INVALID_HOST_KEY');
  });

  it('serves only loopback health facts and releases its keyed listener on close', async () => {
    const options = {
      hostKey: 'package.test.loopback',
      serverName: 'test-package',
      health: { packageId: 'com.tomni.test' },
      buildServer: unusedServer,
    } as const;
    const host = await startPackageLoopbackMcpHost(options);
    await expect(startPackageLoopbackMcpHost(options)).resolves.toBe(host);
    try {
      const response = await fetch(host.healthUrl);
      await expect(response.json()).resolves.toMatchObject({
        ok: true,
        server: 'test-package',
        packageId: 'com.tomni.test',
        activeSessions: 0,
      });
    } finally {
      await host.close();
    }

    const restarted = await startPackageLoopbackMcpHost(options);
    await restarted.close();
  });
});
