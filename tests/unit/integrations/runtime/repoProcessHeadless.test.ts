import { afterEach, describe, expect, it } from 'vitest';
import { createWebEmbedHost } from '@process/integrations/connections/hosts/exec/webEmbedHost';
import type { HostContext } from '@process/integrations/connections/core/types';
import { startRepoProcessEndpoint } from '@process/integrations/runtime/repoProcessEndpoint';
import { RepoProcessError } from '@process/integrations/runtime/repoProcessPorts';
import { cleanPackages, makeHarness, makePackage, specFor } from './repoProcessHarness';

afterEach(cleanPackages);

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return 'started';
  } catch (error) {
    return error instanceof RepoProcessError ? error.code : 'other';
  }
};

/** A headless program: no `ready`, so no port is opened and none is waited for. */
const headless = (id: string) => ({ id, cwd: `source/${id}`, start: ['node', 'bot.js'] });

describe('RepoProcessEndpoint headless programs', () => {
  it('starts a program with no port once it stays alive, and sets no PORT', async () => {
    const harness = makeHarness();
    const dir = await makePackage(['bot']);
    const endpoint = await startRepoProcessEndpoint({ ports: harness.ports }, specFor(dir, [headless('bot')]));

    expect(harness.spawns).toHaveLength(1);
    expect(harness.spawns[0]?.req.env['PORT']).toBeUndefined();
    expect(harness.spawns[0]?.req.env['HOST']).toBe('127.0.0.1');
    expect(endpoint.services().map((entry) => entry.state)).toEqual(['ready']);
    await endpoint.stop();
  });

  it('fails the start when the program exits during the settle window', async () => {
    const harness = makeHarness();
    const dir = await makePackage(['bot']);
    // The child exits while the settle window is running (the sleep that follows its spawn).
    const ports = {
      ...harness.ports,
      clock: {
        ...harness.ports.clock,
        sleep: (ms: number, signal?: AbortSignal) => {
          harness.spawns[0]?.exit(1);
          return harness.ports.clock.sleep(ms, signal);
        },
      },
    };
    expect(await codeOf(startRepoProcessEndpoint({ ports }, specFor(dir, [headless('bot')])))).toBe(
      'EXITED_BEFORE_READY'
    );
  });

  it('starts two headless programs without a port clash', async () => {
    const harness = makeHarness();
    const dir = await makePackage(['bot', 'worker']);
    const endpoint = await startRepoProcessEndpoint(
      { ports: harness.ports },
      specFor(dir, [headless('bot'), headless('worker')])
    );
    expect(endpoint.services().map((entry) => entry.state)).toEqual(['ready', 'ready']);
    await endpoint.stop();
  });
});

describe('web-embed host: loopback address at check time', () => {
  const context = (extra: Partial<HostContext>): HostContext => ({
    packageId: 'com.community.sample',
    packageVersion: '1.0.0',
    packageDirectory: '/nonexistent',
    readPackageFile: async () => Buffer.alloc(0),
    ...extra,
  });
  const loopbackApp = { kind: 'web-embed', id: 'app', title: 'App', url: 'http://127.0.0.1:4100/' };
  const host = createWebEmbedHost({ programProbe: async () => ({ ok: true }) });

  it('accepts a loopback address of a local-built package', async () => {
    const result = await host.check(context({ trust: 'local-built' }), loopbackApp as never);
    expect(result).toEqual({ ok: true });
  });

  it('refuses a loopback address of a store package that declares no local service', async () => {
    const result = await host.check(
      context({ trust: 'signed-store', declaresLocalService: false }),
      loopbackApp as never
    );
    expect(result).toEqual(expect.objectContaining({ ok: false }));
  });

  it('accepts a loopback address of a store package that declares a local service', async () => {
    const result = await host.check(
      context({ trust: 'signed-store', declaresLocalService: true }),
      loopbackApp as never
    );
    expect(result).toEqual({ ok: true });
  });
});
