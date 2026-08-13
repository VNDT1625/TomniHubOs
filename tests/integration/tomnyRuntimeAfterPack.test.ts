/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const afterPack = require('../../scripts/afterPack.js') as (context: unknown) => Promise<void>;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const fixture = () => {
  const appOutDir = mkdtempSync(join(tmpdir(), 'tomny-after-pack-'));
  const resources = join(appOutDir, 'resources');
  const runtimeKey = 'linux-x64';
  const coreDir = join(resources, 'bundled-tomny-core', runtimeKey);
  const cliDir = join(resources, 'bundled-tomny-cli', runtimeKey);
  const runtimeDir = join(resources, 'bundled-tomny-runtime', runtimeKey);
  mkdirSync(coreDir, { recursive: true });
  mkdirSync(cliDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(coreDir, 'tomny-core'), 'compatibility-backend');
  writeFileSync(join(coreDir, 'manifest.json'), '{}');
  writeFileSync(join(cliDir, 'tomny'), 'tomny-agent');
  writeFileSync(join(cliDir, 'manifest.json'), JSON.stringify({ binarySha256: sha256('tomny-agent') }));
  writeFileSync(join(runtimeDir, 'tomny-runtime'), 'workspace-runtime');
  writeFileSync(
    join(runtimeDir, 'manifest.json'),
    JSON.stringify({
      protocol: 'tomny.runtime.v1',
      sourceType: 'workspace-rust-build',
      binarySha256: sha256('workspace-runtime'),
    })
  );
  return { appOutDir, cliDir, runtimeDir };
};

const context = (appOutDir: string) => ({
  arch: 'x64',
  electronPlatformName: 'linux',
  appOutDir,
  packager: {},
});

describe('Tomny Runtime packaged integrity', () => {
  it('accepts a packaged workspace runtime with a matching manifest hash', async () => {
    const { appOutDir } = fixture();
    await expect(afterPack(context(appOutDir))).resolves.toBeUndefined();
  });

  it('rejects a packaged Tomny Agent whose manifest hash is missing', async () => {
    const { appOutDir, cliDir } = fixture();
    writeFileSync(join(cliDir, 'manifest.json'), '{}');
    await expect(afterPack(context(appOutDir))).rejects.toThrow('Tomny CLI integrity check failed');
  });

  it('rejects a packaged runtime modified after its manifest was generated', async () => {
    const { appOutDir, runtimeDir } = fixture();
    writeFileSync(join(runtimeDir, 'tomny-runtime'), 'tampered-runtime');
    await expect(afterPack(context(appOutDir))).rejects.toThrow('integrity check failed');
  });
});
