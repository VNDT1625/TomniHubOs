import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createModelConsumerVault,
  createTomniGatewayModelConsumerRegistry,
} from '@process/tomnigateway/modelConsumerVault';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const codec = {
  isAvailable: () => true,
  encrypt: (value: string) => Buffer.from(`protected:${value}`, 'utf8').toString('base64'),
  decrypt: (value: string) => {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    if (!decoded.startsWith('protected:')) throw new Error('invalid');
    return decoded.slice('protected:'.length);
  },
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Tomny model consumer vault', () => {
  it('issues a one-time credential, persists only a digest, and resolves expiry/revocation', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tomni-model-consumer-'));
    roots.push(rootDir);
    const vault = createModelConsumerVault({ rootDir, codec });
    const registry = createTomniGatewayModelConsumerRegistry({
      vault,
      now: () => 1_700_000_000_000,
      newId: () => 'consumer-1',
      newCredential: () => 'secret-credential',
      actorId: () => 'account-1',
    });
    await expect(registry.issue({ label: 'Empty', allowedModels: [], ttlMs: 60_000 })).rejects.toThrow(
      'MODEL_CONSUMER_INVALID_ISSUE'
    );
    const issued = await registry.issue({
      label: 'CLI',
      allowedModels: ['model-1'],
      ttlMs: 60_000,
    });
    expect(issued).toEqual({
      consumerId: 'consumer-1',
      credential: 'secret-credential',
      expiresAt: '2023-11-14T22:14:20.000Z',
    });
    const files = await (await import('node:fs/promises')).readdir(rootDir);
    const stored = await readFile(path.join(rootDir, files[0]!), 'utf8');
    expect(stored).not.toContain('secret-credential');
    await expect(registry.resolveCredential('secret-credential')).resolves.toEqual({
      consumerId: 'consumer-1',
      allowedModels: ['model-1'],
    });
    await expect(registry.list()).resolves.toEqual([
      {
        consumerId: 'consumer-1',
        label: 'CLI',
        allowedModels: ['model-1'],
        createdAt: '2023-11-14T22:13:20.000Z',
        expiresAt: '2023-11-14T22:14:20.000Z',
      },
    ]);
    const otherAccount = createTomniGatewayModelConsumerRegistry({
      vault,
      actorId: () => 'account-2',
      now: () => 1_700_000_000_000,
    });
    await expect(otherAccount.resolveCredential('secret-credential')).resolves.toBeUndefined();
    await expect(otherAccount.getConsumer('consumer-1')).resolves.toBeUndefined();
    await expect(otherAccount.revoke('consumer-1')).resolves.toBe(false);
    await expect(registry.resolveCredential('wrong')).resolves.toBeUndefined();
    await expect(registry.revoke('consumer-1')).resolves.toBe(true);
    await expect(registry.resolveCredential('secret-credential')).resolves.toBeUndefined();
    await expect(registry.getConsumer('consumer-1')).resolves.toBeUndefined();
  });

  it('rotates a consumer credential while preserving the consumer allowlist and invalidating the old secret', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tomni-model-consumer-'));
    roots.push(rootDir);
    let credentialIndex = 0;
    const vault = createModelConsumerVault({ rootDir, codec });
    const registry = createTomniGatewayModelConsumerRegistry({
      vault,
      now: () => 1_700_000_000_000,
      newId: () => 'consumer-rotate',
      newCredential: () => `secret-${++credentialIndex}`,
      actorId: () => 'account-1',
    });
    const issued = await registry.issue({ label: 'CLI', allowedModels: ['model-1'], ttlMs: 60_000 });
    const rotated = await registry.rotate?.({ consumerId: issued.consumerId, ttlMs: 120_000 });
    expect(rotated).toMatchObject({ consumerId: 'consumer-rotate', credential: 'secret-2' });
    expect(rotated?.expiresAt).toBe('2023-11-14T22:15:20.000Z');
    await expect(registry.resolveCredential(issued.credential)).resolves.toBeUndefined();
    await expect(registry.resolveCredential(rotated?.credential ?? '')).resolves.toEqual({
      consumerId: 'consumer-rotate',
      allowedModels: ['model-1'],
    });
  });

  it('serializes concurrent writes so issued consumers are not lost', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tomni-model-consumer-'));
    roots.push(rootDir);
    let id = 0;
    const vault = createModelConsumerVault({ rootDir, codec });
    const registry = createTomniGatewayModelConsumerRegistry({
      vault,
      now: () => 1_700_000_000_000,
      newId: () => `consumer-${++id}`,
      newCredential: () => `secret-${id + 1}`,
      actorId: () => 'account-1',
    });
    await Promise.all([
      registry.issue({ label: 'CLI 1', allowedModels: ['model-1'], ttlMs: 60_000 }),
      registry.issue({ label: 'CLI 2', allowedModels: ['model-2'], ttlMs: 60_000 }),
    ]);
    await expect(registry.list()).resolves.toHaveLength(2);
  });

  it('fails closed when protected storage is unavailable or records are invalid', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'tomni-model-consumer-'));
    roots.push(rootDir);
    const unavailable = createModelConsumerVault({ rootDir, codec: { ...codec, isAvailable: () => false } });
    await expect(unavailable.list()).rejects.toThrow('MODEL_CONSUMER_PROTECTED_STORAGE_UNAVAILABLE');
    const vault = createModelConsumerVault({ rootDir, codec });
    await expect(
      vault.save({
        schemaVersion: 1,
        consumerId: 'consumer-1',
        actorId: 'account-1',
        label: 'CLI',
        credentialDigest: 'bad',
        allowedModels: [],
        createdAt: 'bad',
        expiresAt: 'bad',
      })
    ).rejects.toThrow('MODEL_CONSUMER_INVALID_RECORD');
  });
});
