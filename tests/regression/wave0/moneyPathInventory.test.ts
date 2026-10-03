import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type SourceFile = Readonly<{ path: string; content: string }>;

const PROJECT_ROOT = process.cwd();
const PROCESS_ROOT = resolve(PROJECT_ROOT, 'packages/desktop/src/process');
const STORE_DETAIL_PATH = 'packages/desktop/src/renderer/pages/hub/StoreProductDetail/index.tsx';
const STORE_PAGE_PATH = 'packages/desktop/src/renderer/pages/hub/HubWorkspacePage.tsx';
const STORE_LEDGER_PATH = 'packages/desktop/src/process/services/database/storeCommerceLedger.ts';
const MANAGED_AUTHORITY_PATH = 'packages/desktop/src/common/billing/managedUsageAuthority.ts';
const MANAGED_SPEND_AUTHORIZER_PATH =
  'packages/desktop/src/process/services/database/drivers/managedUsage/managedUsageSpendAuthorizer.ts';

const readSource = (path: string): string => readFileSync(resolve(PROJECT_ROOT, path), 'utf8');

const readProcessSources = (directory = PROCESS_ROOT): readonly SourceFile[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry): readonly SourceFile[] => {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) return readProcessSources(absolutePath);
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [
      Object.freeze({
        path: relative(PROJECT_ROOT, absolutePath).replaceAll('\\', '/'),
        content: readFileSync(absolutePath, 'utf8'),
      }),
    ];
  });

const callSites = (sources: readonly SourceFile[], needle: string): readonly string[] =>
  sources
    .filter((source) => source.content.includes(needle))
    .map((source) => source.path)
    .toSorted();

/**
 * C0-02 inventory only. It names current money-adjacent seams so presentation,
 * local contract mutation, and a future payment ingress cannot be conflated.
 */
describe('C0-02 money and checkout path inventory', () => {
  it('keeps paid Store offers display-only and blocks package installation before checkout exists', () => {
    const detail = readSource(STORE_DETAIL_PATH);
    const storePage = readSource(STORE_PAGE_PATH);

    expect(detail).toContain('Formats a signed integer-minor offer for display only; commerce decisions stay in Main.');
    expect(detail).toContain(
      'const requiresPayment = Boolean(listing?.offer?.active && listing.offer.price.amountMinor > 0);'
    );
    expect(detail).toContain('disabled={!listing.compatible || requiresPayment}');
    expect(detail).toContain("data-testid='store-product-payment-unavailable'");
    expect(detail).toContain("t('guid.hubHome.storeDetail.paymentUnavailable')");
    expect(detail).not.toContain('packageClient.checkout(');
    expect(detail).not.toContain('packageClient.purchase(');

    expect(storePage).toContain(
      'Store cards use the signed offer only to prevent a misleading pre-checkout install action.'
    );
    expect(storePage).toContain('export const requiresPaidStoreActivation');
    expect(storePage).toContain('(!installed && (!item.compatible || requiresPayment))');
  });

  it('names the only current ordinary-money mutation seam as Main-local ledger code, not a checkout or webhook route', () => {
    const ledger = readSource(STORE_LEDGER_PATH);
    const processSources = readProcessSources();

    for (const marker of [
      'Main-process Store ledger for validated authoritative ordinary-money events.',
      'It is deliberately not a payment-provider adapter and can never mint Credit.',
      'public createOrder(input: unknown)',
      'public recordPayment(input: unknown)',
      'public recordRefund(input: unknown)',
      'CREATE TABLE IF NOT EXISTS store_commerce_order_ledger',
      'CREATE TABLE IF NOT EXISTS store_commerce_event_ledger',
    ]) {
      expect(ledger, marker).toContain(marker);
    }

    expect(callSites(processSources, 'new StoreCommerceLedger(')).toEqual([]);
    expect(callSites(processSources, '.recordPayment(').filter((path) => path !== STORE_LEDGER_PATH)).toEqual([]);
    expect(callSites(processSources, '.recordRefund(').filter((path) => path !== STORE_LEDGER_PATH)).toEqual([]);
  });

  it('keeps managed-usage authority evidence distinct from ordinary Store payment ingress', () => {
    const authority = readSource(MANAGED_AUTHORITY_PATH);
    const authorizer = readSource(MANAGED_SPEND_AUTHORIZER_PATH);

    expect(authority).toContain(
      'This domain is deliberately separate from Store PaymentEvent and provider metering evidence.'
    );
    expect(authority).toContain('this portable verifier never mints or records it.');
    expect(authorizer).toContain('This class exposes');
    expect(authorizer).toContain('no IPC, checkout, provider, cloud, or network capability.');
  });
});
