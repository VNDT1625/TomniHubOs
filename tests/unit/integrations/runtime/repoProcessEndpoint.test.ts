/* oxlint-disable no-await-in-loop -- steps of one scenario must run in order */
import { mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRepoProcessEndpointFactory,
  startRepoProcessEndpoint,
} from '@process/integrations/runtime/repoProcessEndpoint';
import {
  createServiceSlots,
  RepoProcessError,
  type RepoProcessEvent,
} from '@process/integrations/runtime/repoProcessPorts';
import { cleanPackages, makeHarness, makePackage, service, settle, specFor } from './repoProcessHarness';

afterEach(cleanPackages);

const codeOf = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
  } catch (error) {
    return error instanceof RepoProcessError ? error.code : `other:${String(error)}`;
  }
  return 'resolved';
};

describe('RepoProcessEndpoint service order and ready gate', () => {
  it('starts services in declared order and waits for each port before the next', async () => {
    const harness = makeHarness({ readyAfterPolls: 3 });
    const dir = await makePackage(['db', 'api', 'web']);
    const endpoint = await startRepoProcessEndpoint(
      { ports: harness.ports },
      specFor(dir, [service('db', 4001), service('api', 4002), service('web', 4003)])
    );
    expect(harness.spawns.map((record) => record.req.env['PORT'])).toEqual(['4001', '4002', '4003']);
    expect(endpoint.services().map((entry) => entry.state)).toEqual(['ready', 'ready', 'ready']);
    // Each service needed polling before it opened, and the next did not start before that.
    expect(harness.sleeps.filter((ms) => ms === 250).length).toBe(6);
    await endpoint.stop();
  });

  it('honours dependsOn over declared order and refuses cycles and unknown names', async () => {
    const harness = makeHarness();
    const dir = await makePackage(['web', 'api']);
    const endpoint = await startRepoProcessEndpoint(
      { ports: harness.ports },
      specFor(dir, [service('web', 4010, { dependsOn: ['api'] }), service('api', 4011)])
    );
    expect(harness.spawns.map((record) => record.req.env['PORT'])).toEqual(['4011', '4010']);
    await endpoint.stop();

    const cycle = specFor(dir, [
      service('web', 4012, { dependsOn: ['api'] }),
      service('api', 4013, { dependsOn: ['web'] }),
    ]);
    expect(await codeOf(startRepoProcessEndpoint({ ports: harness.ports }, cycle))).toBe('SPEC_INVALID');
    const unknown = specFor(dir, [service('web', 4014, { dependsOn: ['nope'] })]);
    expect(await codeOf(startRepoProcessEndpoint({ ports: harness.ports }, unknown))).toBe('SPEC_INVALID');
  });

  it('reports progress and times out, killing the tree and releasing the slot', async () => {
    const harness = makeHarness({ neverReady: true });
    const dir = await makePackage(['api']);
    const slots = createServiceSlots(6);
    const events: RepoProcessEvent[] = [];
    const result = await codeOf(
      startRepoProcessEndpoint(
        { ports: harness.ports, slots, readyTimeoutMs: 5_000, onEvent: (event) => events.push(event) },
        specFor(dir, [service('api', 4020)])
      )
    );
    expect(result).toBe('READY_TIMEOUT');
    expect(events.some((event) => event.state === 'waiting' && (event.waitedMs ?? 0) >= 1000)).toBe(true);
    expect(harness.kills.map((kill) => kill.pid)).toEqual([harness.spawns[0]?.pid]);
    expect(slots.inUse()).toBe(0);
  });

  it('fails when the process exits before the port opens', async () => {
    const harness = makeHarness({ neverReady: true });
    const dir = await makePackage(['api']);
    const pending = startRepoProcessEndpoint(
      { ports: harness.ports, readyTimeoutMs: 1e12 },
      specFor(dir, [service('api', 4030)])
    );
    await vi.waitFor(() => expect(harness.spawns).toHaveLength(1));
    harness.spawns[0]?.exit(1);
    expect(await codeOf(pending)).toBe('EXITED_BEFORE_READY');
  });
});

describe('RepoProcessEndpoint PORT_IN_USE', () => {
  it('refuses to start when the port is already taken and names the owner', async () => {
    const harness = makeHarness({ alreadyListening: [4040], owner: 'postgres.exe (pid 9)' });
    const dir = await makePackage(['api']);
    const failure = await startRepoProcessEndpoint({ ports: harness.ports }, specFor(dir, [service('api', 4040)])).then(
      () => undefined,
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(RepoProcessError);
    expect((failure as RepoProcessError).code).toBe('PORT_IN_USE');
    expect((failure as RepoProcessError).message).toContain('postgres.exe');
    expect(harness.spawns).toHaveLength(0);
  });

  it('stops services already started when a later one hits PORT_IN_USE', async () => {
    const harness = makeHarness({ alreadyListening: [4051] });
    const dir = await makePackage(['db', 'api']);
    const result = await codeOf(
      startRepoProcessEndpoint({ ports: harness.ports }, specFor(dir, [service('db', 4050), service('api', 4051)]))
    );
    expect(result).toBe('PORT_IN_USE');
    expect(harness.kills.map((kill) => kill.pid)).toEqual([harness.spawns[0]?.pid]);
  });
});

describe('RepoProcessEndpoint bounded restart', () => {
  it('restarts a crashed service with backoff, then gives up with RESTART_LIMIT', async () => {
    const harness = makeHarness();
    const dir = await makePackage(['api']);
    const slots = createServiceSlots(6);
    const events: RepoProcessEvent[] = [];
    const endpoint = await startRepoProcessEndpoint(
      { ports: harness.ports, slots, onEvent: (event) => events.push(event) },
      specFor(dir, [service('api', 4060)])
    );
    for (let crash = 1; crash <= 3; crash += 1) {
      harness.spawns[crash - 1]?.exit(1);
      // oxlint-disable-next-line no-await-in-loop -- each crash is observed before the next
      await settle();
      expect(harness.spawns).toHaveLength(crash + 1);
      expect(endpoint.services()[0]?.state).toBe('ready');
    }
    expect(harness.sleeps).toEqual([1000, 2000, 4000]);
    harness.spawns[3]?.exit(1);
    await settle();
    expect(harness.spawns).toHaveLength(4);
    expect(endpoint.services()[0]?.state).toBe('error');
    expect(events.at(-1)).toMatchObject({ state: 'error', code: 'RESTART_LIMIT' });
    expect(slots.inUse()).toBe(0);
    await endpoint.stop();
  });

  it('does not restart after stop', async () => {
    const harness = makeHarness();
    const dir = await makePackage(['api']);
    const endpoint = await startRepoProcessEndpoint({ ports: harness.ports }, specFor(dir, [service('api', 4070)]));
    await endpoint.stop();
    await settle();
    expect(harness.spawns).toHaveLength(1);
  });
});

describe('RepoProcessEndpoint stop', () => {
  it('kills every process tree in reverse start order, once, and frees slots', async () => {
    const harness = makeHarness();
    const dir = await makePackage(['db', 'api']);
    const slots = createServiceSlots(6);
    const endpoint = await startRepoProcessEndpoint(
      { ports: harness.ports, slots, stopGraceMs: 5_000 },
      specFor(dir, [service('db', 4080), service('api', 4081)])
    );
    expect(slots.inUse()).toBe(2);
    await Promise.all([endpoint.stop(), endpoint.stop()]);
    expect(harness.kills).toEqual([
      { pid: harness.spawns[1]?.pid, graceMs: 5_000 },
      { pid: harness.spawns[0]?.pid, graceMs: 5_000 },
    ]);
    expect(slots.inUse()).toBe(0);
    expect(endpoint.services().map((entry) => entry.state)).toEqual(['stopped', 'stopped']);
  });

  it('stops when the supervisor aborts the signal, including during startup', async () => {
    const harness = makeHarness({ neverReady: true });
    const dir = await makePackage(['api']);
    const controller = new AbortController();
    const pending = startRepoProcessEndpoint(
      { ports: harness.ports, readyTimeoutMs: 1e12 },
      specFor(dir, [service('api', 4090)]),
      controller.signal
    );
    await vi.waitFor(() => expect(harness.spawns).toHaveLength(1));
    controller.abort();
    expect(await codeOf(pending)).toBe('ABORTED');
    expect(harness.kills).toHaveLength(1);
  });

  it('plugs into the supervisor createEndpoint seam', async () => {
    const harness = makeHarness();
    const dir = await makePackage(['api']);
    const create = createRepoProcessEndpointFactory({ ports: harness.ports }, (binding) =>
      Promise.resolve(binding.contributionId === 'svc' ? specFor(dir, [service('api', 4095)]) : undefined)
    );
    const binding = {
      surface: { packageId: 'a.b', packageVersion: '1.0.0', publisherId: 'p' },
      contributionId: 'svc',
      artifactIntegrity: `sha256-${'a'.repeat(64)}`,
    };
    const endpoint = await create(binding, new AbortController().signal);
    expect(endpoint).toBeDefined();
    await endpoint?.stop();
    expect(await create({ ...binding, contributionId: 'other' }, new AbortController().signal)).toBeUndefined();
  });
});

describe('RepoProcessEndpoint environment and output', () => {
  it('passes only base system variables, declared secrets, PORT and HOST', async () => {
    const harness = makeHarness({ secrets: { DB_PASSWORD: 'hunter2-secret' } });
    const dir = await makePackage(['api']);
    const endpoint = await startRepoProcessEndpoint(
      { ports: harness.ports },
      specFor(dir, [
        service('api', 4100, {
          env: [
            { name: 'DB_PASSWORD', required: true },
            { name: 'OPTIONAL_FLAG', required: false },
          ],
        }),
      ])
    );
    const env = harness.spawns[0]?.req.env ?? {};
    expect(Object.keys(env).toSorted()).toEqual(
      ['DB_PASSWORD', 'HOST', 'PATH', 'PORT', 'ELECTRON_RUN_AS_NODE'].toSorted()
    );
    expect(env['PORT']).toBe('4100');
    expect(env['HOST']).toBe('127.0.0.1');
    expect(env['GITHUB_TOKEN']).toBeUndefined();
    expect(env['OPENAI_API_KEY']).toBeUndefined();
    expect(harness.spawns[0]?.req.command).toBe('/electron/app');
    await endpoint.stop();
  });

  it('refuses a missing required variable and reserved variable names', async () => {
    const harness = makeHarness();
    const dir = await makePackage(['api']);
    const missing = specFor(dir, [service('api', 4110, { env: [{ name: 'API_KEY', required: true }] })]);
    expect(await codeOf(startRepoProcessEndpoint({ ports: harness.ports }, missing))).toBe('ENV_MISSING');
    const reserved = specFor(dir, [service('api', 4111, { env: [{ name: 'NODE_OPTIONS', required: false }] })]);
    expect(await codeOf(startRepoProcessEndpoint({ ports: harness.ports }, reserved))).toBe('ENV_FORBIDDEN');
    expect(harness.spawns).toHaveLength(0);
  });

  it('keeps a bounded, secret-scrubbed log', async () => {
    const harness = makeHarness({ secrets: { DB_PASSWORD: 'hunter2-secret' } });
    const dir = await makePackage(['api']);
    const endpoint = await startRepoProcessEndpoint(
      { ports: harness.ports },
      specFor(dir, [service('api', 4120, { env: [{ name: 'DB_PASSWORD', required: true }] })])
    );
    const proc = harness.spawns[0];
    proc?.print('connecting with hunter2-secret now\nsecond line\npartial');
    for (let index = 0; index < 1_200; index += 1) proc?.print(`line ${index}\n`);
    proc?.print(`${'x'.repeat(5_000)}\n`, 'stderr');
    const lines = endpoint.logs('api');
    expect(lines.length).toBeLessThanOrEqual(1000);
    expect(lines.some((line) => line.text.includes('hunter2-secret'))).toBe(false);
    expect(lines.every((line) => line.text.length <= 2000)).toBe(true);
    await endpoint.stop();
  });

  it('scrubs a secret printed in the first line', async () => {
    const harness = makeHarness({ secrets: { TOKEN_X: 'abcd-1234-secret' } });
    const dir = await makePackage(['api']);
    const endpoint = await startRepoProcessEndpoint(
      { ports: harness.ports },
      specFor(dir, [service('api', 4121, { env: [{ name: 'TOKEN_X', required: true }] })])
    );
    harness.spawns[0]?.print('token=abcd-1234-secret\n');
    expect(endpoint.logs('api')[0]?.text).toBe('token=[redacted]');
    await endpoint.stop();
  });

  it('refuses programs outside the allowlist and non-token arguments', async () => {
    const harness = makeHarness();
    const dir = await makePackage(['api']);
    const bash = specFor(dir, [service('api', 4130, { start: ['bash', 'run.sh'] })]);
    expect(await codeOf(startRepoProcessEndpoint({ ports: harness.ports }, bash))).toBe('PROGRAM_FORBIDDEN');
    const injected = specFor(dir, [service('api', 4131, { start: ['node', 'a.js&&calc'] })]);
    expect(await codeOf(startRepoProcessEndpoint({ ports: harness.ports }, injected))).toBe('PROGRAM_FORBIDDEN');
    expect(harness.spawns).toHaveLength(0);
  });
});

describe('RepoProcessEndpoint setup and limits', () => {
  it('runs setup once per approval hash', async () => {
    const harness = makeHarness();
    const dir = await makePackage(['api']);
    const withSetup = specFor(dir, [service('api', 4140, { setup: [['npm', 'install']] })]);
    const first = await startRepoProcessEndpoint({ ports: harness.ports }, withSetup);
    await first.stop();
    const second = await startRepoProcessEndpoint({ ports: harness.ports }, withSetup);
    await second.stop();
    expect(harness.spawns.filter((record) => record.req.args[0] === 'install')).toHaveLength(1);
    expect(harness.markCalls).toEqual(['sha256-approved:api']);
    const changed = { ...withSetup, approvalHash: 'sha256-changed' };
    const third = await startRepoProcessEndpoint({ ports: harness.ports }, changed);
    await third.stop();
    expect(harness.spawns.filter((record) => record.req.args[0] === 'install')).toHaveLength(2);
  });

  it('fails the start and records no marker when setup exits non-zero', async () => {
    const harness = makeHarness({ setupExitCode: 3 });
    const dir = await makePackage(['api']);
    const spec = specFor(dir, [service('api', 4150, { setup: [['npm', 'ci']] })]);
    expect(await codeOf(startRepoProcessEndpoint({ ports: harness.ports }, spec))).toBe('SETUP_FAILED');
    expect(harness.markCalls).toEqual([]);
    expect(
      harness.spawns.filter((record) => record.req.env['PORT'] === '4150' && record.req.args[0] === 'server.js')
    ).toHaveLength(0);
  });

  it('enforces the app-wide service limit', async () => {
    const harness = makeHarness();
    const dir = await makePackage(['a', 'b', 'c']);
    const slots = createServiceSlots(2);
    const result = await codeOf(
      startRepoProcessEndpoint(
        { ports: harness.ports, slots },
        specFor(dir, [service('a', 4160), service('b', 4161), service('c', 4162)])
      )
    );
    expect(result).toBe('SERVICE_LIMIT');
    expect(slots.inUse()).toBe(0);
    expect(harness.spawns).toHaveLength(0);
  });
});

describe('RepoProcessEndpoint working folder confinement', () => {
  it('refuses traversal, absolute, backslash and missing folders before spawning', async () => {
    const harness = makeHarness();
    const dir = await makePackage(['api']);
    for (const cwd of ['source/../..', '../outside', '/etc', 'C:/Windows', 'source\\api', 'source/missing', '']) {
      // oxlint-disable-next-line no-await-in-loop -- one case at a time
      expect(
        await codeOf(startRepoProcessEndpoint({ ports: harness.ports }, specFor(dir, [service('api', 4170, { cwd })])))
      ).toBe('CWD_FORBIDDEN');
    }
    expect(harness.spawns).toHaveLength(0);
  });

  it('refuses a link inside the package that resolves outside it', async () => {
    const harness = makeHarness();
    const dir = await makePackage(['api']);
    const outside = await makePackage([]);
    await mkdir(path.join(outside, 'secret'), { recursive: true });
    await symlink(path.join(outside, 'secret'), path.join(dir, 'source', 'escape'), 'junction');
    const result = await codeOf(
      startRepoProcessEndpoint({ ports: harness.ports }, specFor(dir, [service('api', 4180, { cwd: 'source/escape' })]))
    );
    expect(result).toBe('CWD_FORBIDDEN');
    expect(harness.spawns).toHaveLength(0);
  });
});
