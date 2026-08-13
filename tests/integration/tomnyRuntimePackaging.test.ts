/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const repoRoot = resolve(__dirname, '../..');
const {
  PROTOCOL_VERSION,
  binaryName,
  hashRuntimeSources,
  isReusableArtifact,
  targetTriple,
}: {
  PROTOCOL_VERSION: string;
  binaryName: (platform: string) => string;
  hashRuntimeSources: (runtimeDir: string) => string;
  isReusableArtifact: (input: {
    manifestPath: string;
    binaryPath: string;
    sourceHash: string;
    triple: string;
  }) => boolean;
  targetTriple: (platform: string, arch: string) => string | null;
} = require('../../packages/shared-scripts/src/prepare-tomny-runtime.js');

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('Tomny Runtime packaging', () => {
  it('maps Windows and Unix artifacts to explicit Rust target triples', () => {
    expect(targetTriple('win32', 'x64')).toBe('x86_64-pc-windows-msvc');
    expect(targetTriple('darwin', 'arm64')).toBe('aarch64-apple-darwin');
    expect(binaryName('win32')).toBe('tomny-runtime.exe');
  });

  it('rejects unsupported release architectures', () => {
    expect(targetTriple('freebsd', 'x64')).toBeNull();
    expect(targetTriple('win32', 'ia32')).toBeNull();
  });

  it('invalidates the cache when Rust source changes but ignores target output', () => {
    const runtimeDir = mkdtempSync(join(tmpdir(), 'tomny-runtime-source-'));
    mkdirSync(join(runtimeDir, 'src'));
    writeFileSync(join(runtimeDir, 'Cargo.toml'), '[package]\nname="fixture"\n');
    writeFileSync(join(runtimeDir, 'src', 'main.rs'), 'fn main() {}\n');
    const initial = hashRuntimeSources(runtimeDir);
    mkdirSync(join(runtimeDir, 'target'));
    writeFileSync(join(runtimeDir, 'target', 'ignored.exe'), 'build output');
    expect(hashRuntimeSources(runtimeDir)).toBe(initial);
    writeFileSync(join(runtimeDir, 'src', 'main.rs'), 'fn main() { println!("changed"); }\n');
    expect(hashRuntimeSources(runtimeDir)).not.toBe(initial);
  });

  it('only reuses an artifact whose protocol, target, source, and binary hash match', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tomny-runtime-artifact-'));
    const binaryPath = join(directory, 'tomny-runtime.exe');
    const manifestPath = join(directory, 'manifest.json');
    writeFileSync(binaryPath, 'trusted-runtime');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        name: 'Tomny Runtime',
        protocol: PROTOCOL_VERSION,
        sourceType: 'workspace-rust-build',
        sourceHash: 'source-hash',
        binarySha256: sha256('trusted-runtime'),
        targetTriple: 'x86_64-pc-windows-msvc',
      })
    );

    const input = {
      manifestPath,
      binaryPath,
      sourceHash: 'source-hash',
      triple: 'x86_64-pc-windows-msvc',
    };
    expect(isReusableArtifact(input)).toBe(true);
    writeFileSync(binaryPath, 'tampered-runtime');
    expect(isReusableArtifact(input)).toBe(false);
  });

  it('packages the workspace Rust runtime without importing TomnyCore source', () => {
    const builder = readFileSync(join(repoRoot, 'packages/shared-scripts/src/prepare-tomny-runtime.js'), 'utf8');
    const cargo = readFileSync(join(repoRoot, 'packages/tomny-runtime/Cargo.toml'), 'utf8');
    const electronConfig = readFileSync(join(repoRoot, 'packages/desktop/electron-builder.yml'), 'utf8');

    expect(`${builder}\n${cargo}`).not.toMatch(/tomnycore|tomny-core/iu);
    expect(builder).toContain("'packages', 'tomny-runtime'");
    expect(electronConfig).toContain('resources/bundled-tomny-runtime');
  });
});
