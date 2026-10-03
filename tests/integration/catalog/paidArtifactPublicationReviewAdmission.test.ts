import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { packageSignaturePayload, type PackageCatalogEntry, type PackageManifest } from '@/common/packages';
import { computeArtifactIntegrity, createPackageManagerService } from '@process/extensions/package-manager';

const roots: string[] = [];
const PACKAGE_ID = 'org.example.paid-review-admission';
const ACCOUNT_ID = 'account-paid-review-admission';
const OFFER_ID = 'offer-paid-review-admission';

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tomni-paid-review-admission-'));
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const paidLifecycle = () => ({
  order: {
    schemaVersion: 1,
    orderId: 'order-paid-review-admission',
    accountId: ACCOUNT_ID,
    offer: {
      schemaVersion: 1,
      offerId: OFFER_ID,
      productId: 'product-paid-review-admission',
      package: { packageId: PACKAGE_ID, packageVersion: '1.0.0', publisherId: 'org.example' },
      sellerKind: 'first-party' as const,
      price: { currency: 'USD', amountMinor: 500 },
      taxTreatment: 'exclusive' as const,
      revision: 'review-admission-v1',
      active: true,
    },
    state: 'paid' as const,
    idempotencyKey: 'order-paid-review-admission',
    createdAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2030-01-01T00:02:00.000Z',
  },
  paymentEvents: [
    {
      schemaVersion: 1,
      paymentEventId: 'payment-authorized-paid-review-admission',
      orderId: 'order-paid-review-admission',
      providerEventId: 'provider-authorized-paid-review-admission',
      kind: 'authorized' as const,
      amount: { currency: 'USD', amountMinor: 500 },
      idempotencyKey: 'payment-authorized-paid-review-admission',
      occurredAt: '2030-01-01T00:01:00.000Z',
    },
    {
      schemaVersion: 1,
      paymentEventId: 'payment-captured-paid-review-admission',
      orderId: 'order-paid-review-admission',
      providerEventId: 'provider-captured-paid-review-admission',
      kind: 'captured' as const,
      amount: { currency: 'USD', amountMinor: 500 },
      idempotencyKey: 'payment-captured-paid-review-admission',
      occurredAt: '2030-01-01T00:02:00.000Z',
    },
  ],
  refunds: [],
  entitlement: {
    schemaVersion: 1,
    entitlementId: 'entitlement-paid-review-admission',
    accountId: ACCOUNT_ID,
    offerId: OFFER_ID,
    package: { packageId: PACKAGE_ID, packageVersion: '1.0.0', publisherId: 'org.example' },
    state: 'active' as const,
    issuedAt: '2030-01-01T00:02:00.000Z',
  },
  activeGrant: {
    schemaVersion: 1,
    grantId: 'grant-paid-review-admission',
    accountId: ACCOUNT_ID,
    offerId: OFFER_ID,
    package: { packageId: PACKAGE_ID, packageVersion: '1.0.0', publisherId: 'org.example' },
    entitlementId: 'entitlement-paid-review-admission',
    policyVersion: 'store-policy-v1',
    expiresAt: '2031-01-01T00:00:00.000Z',
  },
});

describe('C1 paid artifact publication-review admission', () => {
  it('rejects signed unreviewed or malformed paid artifacts and only activates the signed reviewed artifact', async () => {
    const root = await temporaryRoot();
    const sourceDirectory = path.join(root, 'source');
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(path.join(sourceDirectory, 'index.html'), '<main>Paid reviewed Surface</main>');

    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const integrity = await computeArtifactIntegrity(sourceDirectory);
    const unsigned: PackageManifest = {
      schemaVersion: 1,
      id: PACKAGE_ID,
      publisherId: 'org.example',
      name: 'Paid review-admission Surface',
      description: 'A signed paid package that requires a signed Store review decision.',
      type: 'app',
      bundleKind: 'single',
      version: '1.0.0',
      engines: { tomni: '>=1.0.0 <2.0.0' },
      modules: [
        {
          id: 'main',
          title: 'Main',
          surface: 'apps/paid-review-admission',
          pinnable: true,
          runtime: 'sandboxed-web',
          entrypoint: 'index.html',
        },
      ],
      permissions: [],
      dependencies: [],
      tags: ['paid', 'review'],
      contributions: { version: 1, apps: [{ id: 'paid-review', title: 'Main', moduleId: 'main' }] },
      artifact: {
        ...integrity,
        signature: { algorithm: 'ed25519', keyId: 'paid-review-key', value: '' },
      },
    };
    const manifest: PackageManifest = {
      ...unsigned,
      artifact: {
        ...unsigned.artifact!,
        signature: {
          ...unsigned.artifact!.signature,
          value: sign(null, Buffer.from(packageSignaturePayload(unsigned)), privateKey).toString('base64'),
        },
      },
    };
    await writeFile(path.join(sourceDirectory, 'tomny-package.json'), JSON.stringify(manifest));

    const review = {
      schemaVersion: 2 as const,
      disposition: 'auto-approved' as const,
      fingerprint: 'sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      artifactIntegrity: manifest.artifact!.integrity,
      reviewedAt: '2030-01-01T00:00:00.000Z',
    };
    const entryFor = (publicationReview?: PackageCatalogEntry['publicationReview']): PackageCatalogEntry => ({
      manifest,
      delivery: 'downloaded-package',
      trust: 'signed-store',
      sourceDirectory,
      offer: {
        schemaVersion: 1,
        offerId: OFFER_ID,
        productId: 'product-paid-review-admission',
        package: { packageId: PACKAGE_ID, packageVersion: manifest.version, publisherId: manifest.publisherId },
        sellerKind: 'first-party',
        price: { currency: 'USD', amountMinor: 500 },
        taxTreatment: 'exclusive',
        revision: 'review-admission-v1',
        active: true,
      },
      ...(publicationReview ? { publicationReview } : {}),
    });
    const createService = async (directory: string, entry: PackageCatalogEntry) => {
      const service = createPackageManagerService({
        rootDir: directory,
        appVersion: '1.2.0',
        catalog: [entry],
        trustedKeys: { 'paid-review-key': publicKey.export({ type: 'spki', format: 'pem' }).toString() },
        paidPackageActivationRequirement: (candidate) =>
          candidate.manifest.id === PACKAGE_ID ? { accountId: ACCOUNT_ID, offerId: OFFER_ID } : undefined,
        isPackageSandboxActive: () => false,
        reservePackageSandboxMutation: () => ({ release: () => undefined }),
      });
      await service.initialize();
      return service;
    };

    const unreviewed = await createService(path.join(root, 'unreviewed'), entryFor());
    await expect(unreviewed.install(PACKAGE_ID, { lifecycle: paidLifecycle() })).rejects.toThrow(
      /valid trusted Store publication review/i
    );
    await expect(unreviewed.status(PACKAGE_ID)).resolves.toMatchObject({ state: 'available', enabled: false });
    expect((await unreviewed.contributions()).snapshot.packageIds).toEqual([]);

    const malformed = await createService(
      path.join(root, 'malformed'),
      entryFor({ ...review, reviewerId: 'unexpected-reviewer' } as unknown as PackageCatalogEntry['publicationReview'])
    );
    await expect(malformed.install(PACKAGE_ID, { lifecycle: paidLifecycle() })).rejects.toThrow(
      /valid trusted Store publication review/i
    );

    const copiedReview = await createService(
      path.join(root, 'copied-review'),
      entryFor({ ...review, artifactIntegrity: 'sha256-' + 'b'.repeat(64) })
    );
    await expect(copiedReview.install(PACKAGE_ID, { lifecycle: paidLifecycle() })).rejects.toThrow(
      /valid trusted Store publication review/i
    );

    const reviewed = await createService(path.join(root, 'reviewed'), entryFor(review));
    await expect(reviewed.install(PACKAGE_ID, { lifecycle: paidLifecycle() })).resolves.toMatchObject({
      state: 'installed',
      enabled: true,
      installedPublicationReview: review,
    });
    await reviewed.disable(PACKAGE_ID);
    await expect(reviewed.enable(PACKAGE_ID, { lifecycle: paidLifecycle() })).resolves.toMatchObject({
      state: 'installed',
      enabled: true,
      installedPublicationReview: review,
    });
  });
});
