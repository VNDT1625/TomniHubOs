/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');

describe('build-with-builder', () => {
  it('prepares bundled Tomny artifacts before every desktop development entry point', () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['prepare:dev']).toBe('bun run prepare:tomny && bun run prepare:runtime');
    expect(
      ['dev', 'start', 'start:multi', 'cli'].map((name) =>
        packageJson.scripts[name]?.startsWith('bun run prepare:dev &&')
      )
    ).toEqual([true, true, true, true]);
  });

  it('reports bundled Tomny artifact identities in the development doctor', () => {
    const result = spawnSync(process.execPath, ['scripts/dev-bootstrap.mjs', 'doctor'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status, output).toBe(0);
    expect(output).toContain('Tomny CLI artifact:');
    expect(output).toContain('Tomny Runtime artifact:');
  });

  it.each([
    {
      args: ['arm64', '--win', '--arm64'],
      expectedArch: 'arm64',
    },
    {
      args: ['auto', '--mac', '--x64'],
      expectedArch: 'x64',
    },
  ])('builds bundled Tomny Core for $expectedArch with args $args', ({ args, expectedArch }) => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tomny-build-test-'));
    const hookPath = join(tempDir, 'hook.cjs');
    const callsPath = join(tempDir, 'prepare-calls.json');

    const outputPaths = [join(repoRoot, 'out/main/index.js'), join(repoRoot, 'out/renderer/index.html')];
    const outputSnapshots = outputPaths.map((filePath) => ({
      filePath,
      content: existsSync(filePath) ? readFileSync(filePath) : null,
    }));

    writeFileSync(
      hookPath,
      `
const childProcess = require('node:child_process');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const originalLoad = Module._load;

function recordPrepareCall(options) {
  const callsPath = process.env.TOMNY_PREPARE_CALLS_FILE;
  const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, 'utf8')) : [];
  calls.push(options ?? null);
  fs.writeFileSync(callsPath, JSON.stringify(calls));
  return { prepared: true, dir: 'mock-bundled-tomny-core', sourceType: 'source-build' };
}

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === './prepareTomnyCore' || request.endsWith('/prepareTomnyCore')) {
    return recordPrepareCall;
  }

  if (request.endsWith('packages/shared-scripts/src/prepare-tomny-core.js')) {
    return { prepareTomnyCore: recordPrepareCall };
  }


  if (request.endsWith('packages/shared-scripts/src/prepare-tomny-runtime.js')) {
    return { prepareTomnyRuntime: recordPrepareCall };
  }


  if (request.endsWith('packages/shared-scripts/src/prepare-tomny-cli.js')) {
    return { prepareTomnyCli: () => ({ prepared: true, cached: true }) };
  }


  return originalLoad.call(this, request, parent, isMain);
};

childProcess.execSync = function mockedExecSync(command) {
  const commandText = String(command);
  if (commandText.includes('electron-vite build')) {
    fs.mkdirSync(path.join(process.cwd(), 'out/main'), { recursive: true });
    fs.mkdirSync(path.join(process.cwd(), 'out/renderer'), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), 'out/main/index.js'), 'console.log("main bundle");\\n');
    fs.writeFileSync(path.join(process.cwd(), 'out/renderer/index.html'), '<div id="root"></div>\\n');
  }
  return Buffer.from('');
};
`,
      'utf8'
    );

    try {
      const result = spawnSync(process.execPath, ['scripts/build-with-builder.js', ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          TOMNY_PREPARE_CALLS_FILE: callsPath,
          TOMNY_SKIP_PACK_CLEANUP: '1',
          NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${hookPath}`].filter(Boolean).join(' '),
        },
      });

      expect(result.status, result.stderr || result.stdout).toBe(0);

      const calls = JSON.parse(readFileSync(callsPath, 'utf8')) as Array<{ arch?: string } | null>;
      expect(calls).toContainEqual(expect.objectContaining({ arch: expectedArch }));
    } finally {
      for (const snapshot of outputSnapshots) {
        if (snapshot.content === null) {
          rmSync(snapshot.filePath, { force: true });
        } else {
          writeFileSync(snapshot.filePath, snapshot.content);
        }
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
