import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { type PackageManifest } from '@/common/packages';
import { computeArtifactIntegrity, createPackageManagerService } from '@/process/extensions/package-manager';

const roots: string[] = [];
const packageId = 'org.example.captured-does-not-trust';
const accountId = 'account-captured-does-not-trust';
const offerId = 'offer-captured-does-not-trust';

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-payment-trust-'));
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const paidLifecycle = (
  packageIdentity: Readonly<{ packageId: string; packageVersion: string; publisherId: string }>
) => ({
  order: {
    schemaVersion: 1,
    orderId: 'order-captured-does-not-trust',
    accountId,
    offer: {
      schemaVersion: 1,
      offerId,
      productId: 'product-captured-does-not-trust',
      package: packageIdentity,
      sellerKind: 'first-party' as const,
      price: { currency: 'USD', amountMinor: 500 },
      taxTreatment: 'exclusive' as const,
      revision: 'revision-captured-does-not-trust',
      active: true,
    },
    state: 'paid' as const,
    idempotencyKey: 'order-captured-does-not-trust',
    createdAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2030-01-01T00:02:00.000Z',
  },
  paymentEvents: [
    {
      schemaVersion: 1,
      paymentEventId: 'payment-authorized-does-not-trust',
      orderId: 'order-captured-does-not-trust',
      providerEventId: 'provider-authorized-does-not-trust',
      kind: 'authorized' as const,
      amount: { currency: 'USD', amountMinor: 500 },
      idempotencyKey: 'payment-authorized-does-not-trust',
      occurredAt: '2030-01-01T00:01:00.000Z',
    },
    {
      schemaVersion: 1,
      paymentEventId: 'payment-captured-does-not-trust',
      orderId: 'order-captured-does-not-trust',
      providerEventId: 'provider-captured-does-not-trust',
      kind: 'captured' as const,
      amount: { currency: 'USD', amountMinor: 500 },
      idempotencyKey: 'payment-captured-does-not-trust',
      occurredAt: '2030-01-01T00:02:00.000Z',
    },
  ],
  refunds: [],
  entitlement: {
    schemaVersion: 1,
    entitlementId: 'entitlement-captured-does-not-trust',
    accountId,
    offerId,
    package: packageIdentity,
    state: 'active' as const,
    issuedAt: '2030-01-01T00:02:00.000Z',
  },
  activeGrant: {
    schemaVersion: 1,
    grantId: 'grant-captured-does-not-trust',
    accountId,
    offerId,
    package: packageIdentity,
    entitlementId: 'entitlement-captured-does-not-trust',
    policyVersion: 'store-policy-v1',
    expiresAt: '2031-01-01T00:00:00.000Z',
  },
});

describe('C1 payment does not raise technical trust', () => {
  it('rejects a captured paid lifecycle when it attempts to smuggle technical trust, then still rejects the unsigned unreviewed artifact', async () => {
    const storeRoot = await temporaryRoot();
    const sourceDirectory = await temporaryRoot();
    await mkdir(path.join(sourceDirectory, 'dist'), { recursive: true });
    await writeFile(path.join(sourceDirectory, 'index.html'), '<main>Captured payment must not raise trust</main>');
    await writeFile(path.join(sourceDirectory, 'dist', 'main.js'), 'export const ready = true;\n');

    const artifact = await computeArtifactIntegrity(sourceDirectory);
    const { publicKey } = generateKeyPairSync('ed25519');
    const manifest: PackageManifest = {
      schemaVersion: 1,
      id: packageId,
      publisherId: 'org.example',
      name: 'Captured payment cannot raise trust',
      description: 'An unsigned and unreviewed paid package fixture.',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0' },
      modules: [
        {
          id: 'main',
          title: 'Main',
          surface: 'payment-trust/main',
          pinnable: true,
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
      permissions: [],
      dependencies: [],
      tags: ['payment', 'trust'],
      artifact: {
        ...artifact,
        signature: { algorithm: 'ed25519', keyId: 'payment-trust-key', value: 'not-a-valid-signature' },
      },
    };
    await writeFile(path.join(sourceDirectory, 'tomny-package.json'), JSON.stringify(manifest));

    const service = createPackageManagerService({
      rootDir: storeRoot,
      appVersion: '1.2.0',
      catalog: [
        {
          manifest,
          delivery: 'downloaded-package',
          trust: 'signed-store',
          sourceDirectory,
          offer: {
            schemaVersion: 1,
            offerId,
            productId: 'product-captured-does-not-trust',
            package: { packageId, packageVersion: manifest.version, publisherId: manifest.publisherId },
            sellerKind: 'first-party',
            price: { currency: 'USD', amountMinor: 500 },
            taxTreatment: 'exclusive',
            revision: 'revision-captured-does-not-trust',
            active: true,
          },
          publicationReview: {
            schemaVersion: 2,
            disposition: 'auto-approved',
            fingerprint: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            artifactIntegrity: manifest.artifact!.integrity,
            reviewedAt: '2029-01-01T00:00:00.000Z',
          },
        },
      ],
      trustedKeys: { 'payment-trust-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
      paidPackageActivationRequirement: (entry) =>
        entry.manifest.id === packageId ? { accountId, offerId } : undefined,
      now: () => Date.parse('2029-01-01T00:00:00.000Z'),
    });
    await service.initialize();

    const lifecycle = paidLifecycle({ packageId, packageVersion: manifest.version, publisherId: manifest.publisherId });
    await expect(
      service.install(packageId, { lifecycle: { ...lifecycle, trust: 'trusted-first-party' } })
    ).rejects.toThrow(/invalid Store commercial admission/i);
    await expect(service.install(packageId, { lifecycle })).rejects.toThrow(/signature/i);

    const listing = await service.status(packageId);
    expect(listing).toMatchObject({
      state: 'failed',
      trust: 'signed-store',
      installedTrust: 'signed-store',
    });
    expect(listing).not.toHaveProperty('installedPublicationReview');
  });
});
