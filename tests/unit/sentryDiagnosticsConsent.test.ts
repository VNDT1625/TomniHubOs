import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let userDataPath = '';

vi.mock('electron', () => ({ app: { getPath: () => userDataPath } }));

import {
  getRotatingDiagnosticsCorrelationId,
  hasDiagnosticsConsent,
  setDiagnosticsConsent,
} from '@/process/utils/analyticsId';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  userDataPath = '';
});

describe('Sentry diagnostics consent', () => {
  it('defaults off, persists only Main-owned opt-in, and drops correlation on withdrawal', async () => {
    userDataPath = await mkdtemp(path.join(os.tmpdir(), 'tomni-sentry-consent-'));
    roots.push(userDataPath);

    expect(hasDiagnosticsConsent()).toBe(false);
    expect(getRotatingDiagnosticsCorrelationId(1_000)).toBeUndefined();

    setDiagnosticsConsent(true);
    const correlationId = getRotatingDiagnosticsCorrelationId(1_000);
    expect(correlationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(hasDiagnosticsConsent()).toBe(true);
    await expect(readFile(path.join(userDataPath, 'analytics.json'), 'utf8')).resolves.toContain('diagnosticsConsent');

    setDiagnosticsConsent(false);
    expect(hasDiagnosticsConsent()).toBe(false);
    expect(getRotatingDiagnosticsCorrelationId(1_001)).toBeUndefined();
    await expect(readFile(path.join(userDataPath, 'analytics.json'), 'utf8')).resolves.not.toContain(
      'diagnosticsCorrelation'
    );
  });
});
