import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Store API container boundary', () => {
  it('runs as non-root and exposes a liveness healthcheck', async () => {
    const dockerfile = await readFile(resolve(process.cwd(), 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/^USER bun$/m);
    expect(dockerfile).toMatch(/^HEALTHCHECK .*\/health\/live/m);
    expect(dockerfile).toMatch(/CMD \["bun","run","src\/index\.ts"\]/);
  });

  it('keeps Cloud Run probes on separate live and ready endpoints', async () => {
    const manifest = await readFile(resolve(process.cwd(), 'deploy/cloud-run.service.yaml'), 'utf8');
    expect(manifest).toMatch(/path: \/health\/ready/);
    expect(manifest).toMatch(/path: \/health\/live/);
    expect(manifest).toMatch(/serviceAccountName: \$\{STORE_API_SERVICE_ACCOUNT\}/);
    expect(manifest).toContain('name: STORE_SIGNER_ENDPOINT');
    expect(manifest).toContain('name: STORE_SIGNER_KEY_ID');
    expect(manifest).toContain('name: STORE_SIGNER_TOKEN');
    expect(manifest).toContain('name: tomni-package-signer-token');
  });
});
