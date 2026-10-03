/**
 * Signed Design package process entry. Core never imports this file: the fixed
 * contribution registry starts it only from the verified artifact payload.
 */

import { createInterface } from 'node:readline';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startPackageLoopbackMcpHost } from '@process/resources/packageProcessRuntime/packageLoopbackMcpHost';
import { registerViuTools } from './viu/agentTools';
import { viuV2SessionService } from './viu/v2SessionService';

type ShutdownEnvelope = Readonly<{ schemaVersion: 1; type: 'shutdown' }>;

const isShutdownEnvelope = (value: unknown): value is ShutdownEnvelope =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 2 &&
  (value as { schemaVersion?: unknown }).schemaVersion === 1 &&
  (value as { type?: unknown }).type === 'shutdown';

const writeLifecycle = (event: 'ready' | 'stopped' | 'failed'): void => {
  const message = { schemaVersion: 1, event };
  if (typeof process.send === 'function') {
    process.send(message);
    return;
  }
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const main = async (): Promise<void> => {
  let closed = false;
  let host: Awaited<ReturnType<typeof startPackageLoopbackMcpHost>> | undefined;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await host?.close();
    writeLifecycle('stopped');
  };

  try {
    host = await startPackageLoopbackMcpHost({
      hostKey: 'design-viu-v1',
      serverName: 'tomni-design-viu',
      health: { capability: 'design-viu-v1', packageId: 'com.tomni.design-studio' },
      buildServer: () => {
        const server = new McpServer({ name: 'tomni-design-viu', version: '1.0.0' });
        registerViuTools(server, viuV2SessionService);
        return server;
      },
    });
    writeLifecycle('ready');
  } catch {
    writeLifecycle('failed');
    process.exitCode = 1;
    return;
  }

  process.once('SIGTERM', () => {
    void close();
  });
  process.once('SIGINT', () => {
    void close();
  });
  const acceptControl = (envelope: unknown): void => {
    if (isShutdownEnvelope(envelope)) void close();
  };
  process.on('message', (message: unknown) => acceptControl(message));
  createInterface({ input: process.stdin }).on('line', (line) => {
    if (line.length > 256) return;
    try {
      acceptControl(JSON.parse(line) as unknown);
    } catch {
      // Ignore malformed control input; it must not alter the package process.
    }
  });
};

void main();
