/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveLayaScriptPath } from '@process/services/security/layaSidecarClient';

const original = process.env.TOMNY_LAYA_SIDECAR;
const directories: string[] = [];

afterEach(() => {
  if (original === undefined) delete process.env.TOMNY_LAYA_SIDECAR;
  else process.env.TOMNY_LAYA_SIDECAR = original;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('resolveLayaScriptPath', () => {
  it('prefers an explicit override that exists', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'tomny-laya-path-'));
    directories.push(directory);
    const script = path.join(directory, 'laya_sidecar.py');
    writeFileSync(script, '# stub');
    process.env.TOMNY_LAYA_SIDECAR = script;
    expect(resolveLayaScriptPath()).toBe(script);
  });

  it('ignores an override that does not exist and uses the working-directory script', () => {
    process.env.TOMNY_LAYA_SIDECAR = path.join(os.tmpdir(), 'tomny-missing', 'laya_sidecar.py');
    expect(resolveLayaScriptPath()).toBe(path.resolve(process.cwd(), 'scripts/laya_sidecar.py'));
  });
});
