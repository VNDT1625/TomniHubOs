import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type PackageManifest = Readonly<{
  scripts?: Readonly<Record<string, string>>;
}>;

const PROJECT_ROOT = process.cwd();
const readProjectFile = (path: string): string => readFileSync(resolve(PROJECT_ROOT, path), 'utf8');
const packageScripts = (): Readonly<Record<string, string>> => {
  const manifest = JSON.parse(readProjectFile('package.json')) as PackageManifest;
  return manifest.scripts ?? {};
};

describe('C2/C5 clean-machine harness inventory', () => {
  it('keeps a release-owned fail-closed harness separate from the legacy packaged E2E fixture', () => {
    const scripts = packageScripts();
    const fixture = readProjectFile('tests/e2e/fixtures.ts');
    const harness = readProjectFile('scripts/release/run-clean-machine-harness.mjs');

    expect(scripts['test:release:base-artifact']).toContain('electron-vite build');
    expect(scripts['test:release:base-artifact']).not.toContain('playwright');
    expect(scripts['test:e2e']).not.toContain('E2E_PACKAGED=1');
    expect(scripts['test:release:clean-machine']).toBe('node scripts/release/run-clean-machine-harness.mjs');
    expect(harness).toContain("['--plan', '--receipt', '--profile-root']");
    expect(harness).toContain("'ERROR_ARTIFACT_NOT_FOUND'");
    expect(harness).toContain("'ERROR_ARTIFACT_DIGEST_MISMATCH'");
    expect(harness).toContain('TOMNI_CLEAN_MACHINE_PROFILE_DIR');
    expect(harness).toContain("['{artifact}', '{profile}']");
    expect(harness).toContain('signatureVerifier');
    expect(harness).toContain('lifecycleVerifier');
    const lifecycleVerifier = readProjectFile('scripts/release/verify-windows-desktop-lifecycle.mjs');
    const desktopMain = readProjectFile('packages/desktop/src/index.ts');
    const chromiumConfig = readProjectFile('packages/desktop/src/process/utils/configureChromium.ts');
    expect(lifecycleVerifier).toContain('clean-machine-ready.json');
    expect(lifecycleVerifier).toContain('Expected unpacked Tomny.exe');
    expect(lifecycleVerifier).toContain('TOMNY_CLEAN_MACHINE_RUN_ID');
    expect(desktopMain).toContain('writeCleanMachineReadyReceipt();');
    expect(chromiumConfig).toContain('TOMNY_CLEAN_MACHINE');

    expect(fixture).toContain("const e2eStateSandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tomny-e2e-state-'));");
    expect(fixture).toContain('TOMNY_EXTENSION_STATES_FILE: process.env.TOMNY_EXTENSION_STATES_FILE || e2eStateFile,');
    expect(fixture).not.toContain('--user-data-dir');
    expect(fixture).not.toContain('TOMNY_CLEAN_MACHINE');
  });
});
