import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEvidenceFileSink, createJsonSetupMarkerStore } from '@process/integrations/runtime/repoProcessStores';

const roots: string[] = [];
const temp = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomny-stores-'));
  roots.push(root);
  return root;
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('setup markers', () => {
  it('survive a restart, stay inside their scope, and are cleared by prefix', async () => {
    const file = path.join(await temp(), 'markers.json');
    const first = createJsonSetupMarkerStore(file);
    await first.scoped('pkg-a|app|1.0.0|').mark('sha256-x:api');
    await first.scoped('pkg-b|app|1.0.0|').mark('sha256-x:api');

    const second = createJsonSetupMarkerStore(file);
    expect(await second.scoped('pkg-a|app|1.0.0|').has('sha256-x:api')).toBe(true);
    // Same approval hash and service name in another package, another version or another connection: not shared.
    expect(await second.scoped('pkg-c|app|1.0.0|').has('sha256-x:api')).toBe(false);
    expect(await second.scoped('pkg-a|app|1.0.1|').has('sha256-x:api')).toBe(false);
    expect(await second.scoped('pkg-a|other|1.0.0|').has('sha256-x:api')).toBe(false);

    await second.clear('pkg-a|app|');
    expect(await second.scoped('pkg-a|app|1.0.0|').has('sha256-x:api')).toBe(false);
    expect(await createJsonSetupMarkerStore(file).scoped('pkg-b|app|1.0.0|').has('sha256-x:api')).toBe(true);
  });

  it('treat a missing or corrupt file as empty, so setup runs again rather than being skipped', async () => {
    const file = path.join(await temp(), 'markers.json');
    expect(await createJsonSetupMarkerStore(file).has('anything')).toBe(false);
    await writeFile(file, '{ not json');
    const store = createJsonSetupMarkerStore(file);
    expect(await store.has('anything')).toBe(false);
    await store.mark('fresh');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ schemaVersion: 1, marks: ['fresh'] });
  });

  it('refuse an oversized key and keep the list bounded', async () => {
    const store = createJsonSetupMarkerStore(path.join(await temp(), 'markers.json'));
    await expect(store.mark('k'.repeat(401))).rejects.toThrow(/too long/);
    for (let index = 0; index < 2_005; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- each mark persists before the next
      await store.mark(`k${index}`);
    }
    expect(await store.has('k0')).toBe(false);
    expect(await store.has('k2004')).toBe(true);
  }, 60_000);
});

describe('process evidence log', () => {
  const binding = {
    surface: { packageId: 'com.community.medisign', packageVersion: '1.0.0', publisherId: 'connection-host' },
    contributionId: 'web-embed.medisign',
    artifactIntegrity: `sha256-${'a'.repeat(64)}`,
  };

  it('appends one line per step with identities and a reason code only', async () => {
    const file = path.join(await temp(), 'nested', 'evidence.jsonl');
    const record = createEvidenceFileSink(file, () => 1_000);
    await record({ kind: 'package-persistent-contribution.v1', phase: 'admitted', binding });
    await record({
      kind: 'package-persistent-contribution.v1',
      phase: 'failed',
      binding,
      reason: 'PACKAGE_PERSISTENT_CONTRIBUTION_FAILED',
    });
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      {
        at: 1_000,
        kind: 'package-persistent-contribution.v1',
        phase: 'admitted',
        packageId: 'com.community.medisign',
        packageVersion: '1.0.0',
        contributionId: 'web-embed.medisign',
        approvalHash: binding.artifactIntegrity,
      },
      expect.objectContaining({ phase: 'failed', reason: 'PACKAGE_PERSISTENT_CONTRIBUTION_FAILED' }),
    ]);
  });

  it('rotates the file once it passes 1 MiB', async () => {
    const file = path.join(await temp(), 'evidence.jsonl');
    await writeFile(file, 'x'.repeat(1024 * 1024 + 1));
    await createEvidenceFileSink(file)({ kind: 'package-persistent-contribution.v1', phase: 'started', binding });
    expect((await stat(`${file}.1`)).size).toBe(1024 * 1024 + 1);
    expect((await readFile(file, 'utf8')).trim().split('\n')).toHaveLength(1);
  });

  it('fails when it cannot write, so the supervisor refuses to start (fail closed)', async () => {
    const root = await temp();
    // A directory where the file should be.
    const record = createEvidenceFileSink(root);
    await expect(record({ kind: 'package-persistent-contribution.v1', phase: 'admitted', binding })).rejects.toThrow();
  });
});
