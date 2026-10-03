import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

type PackageManifest = Readonly<{
  scripts?: Readonly<Record<string, string>>;
}>;

const PROJECT_ROOT = process.cwd();
const readProjectFile = (relativePath: string): string => readFileSync(resolve(PROJECT_ROOT, relativePath), 'utf8');

const packageScripts = (): Readonly<Record<string, string>> => {
  const manifest = JSON.parse(readProjectFile('package.json')) as PackageManifest;
  return manifest.scripts ?? {};
};

describe('C4 denied-install cleanup evidence inventory', () => {
  it('retains component and restart-recovery proofs while recording the missing packaged clean-machine journey', () => {
    const serviceSource = readProjectFile(
      'packages/desktop/src/process/extensions/package-manager/PackageManagerService.ts'
    );
    const deniedInstallTest = readProjectFile('tests/integration/package-manager/deniedInstallCleanup.test.ts');
    const restartRecoveryTest = readProjectFile(
      'tests/integration/package-manager/packageMutationRestartRecovery.test.ts'
    );
    const e2eFixture = readProjectFile('tests/e2e/fixtures.ts');
    const harness = readProjectFile('scripts/release/run-clean-machine-harness.mjs');
    const scripts = packageScripts();

    expect(serviceSource).toContain("const stagingDir = path.join(rootDir, '.staging');");
    expect(serviceSource).toContain("const trashDir = path.join(rootDir, '.trash');");
    expect(serviceSource).toContain("const downloadsDir = path.join(rootDir, '.downloads');");
    expect(serviceSource).toContain('await recoverFilesystem();');
    expect(serviceSource).toContain('await safeRemove(downloadedSource, downloadsDir)');
    expect(serviceSource).toContain('const rollbackTasks: Promise<unknown>[] = [artifactTransaction.rollback()]');

    expect(deniedInstallTest).toContain('expect(fetchArtifact).not.toHaveBeenCalled();');
    expect(deniedInstallTest).toContain("await expect(readdir(path.join(rootDir, 'packages'))).resolves.toEqual([]);");
    expect(deniedInstallTest).toContain("await expect(readdir(path.join(rootDir, '.staging'))).resolves.toEqual([]);");
    expect(deniedInstallTest).toContain("await expect(readdir(path.join(rootDir, '.trash'))).resolves.toEqual([]);");
    expect(deniedInstallTest).toContain(
      "await expect(readdir(path.join(rootDir, '.downloads'))).resolves.toEqual([]);"
    );

    expect(restartRecoveryTest).toContain("process.kill(process.pid, 'SIGKILL');");
    expect(restartRecoveryTest).toContain(
      'recovers a child process terminated after payload transfer and before durable state commit'
    );
    expect(restartRecoveryTest).toContain(
      'removes an unregistered payload left by a process terminated before durable install commit'
    );

    expect(scripts['test:release:clean-machine']).toBe('node scripts/release/run-clean-machine-harness.mjs');
    expect(harness).toContain("'ERROR_ARTIFACT_NOT_FOUND'");
    expect(harness).toContain('signatureVerifier');
    expect(harness).toContain('lifecycleVerifier');
    expect(scripts['test:e2e']).not.toContain('E2E_PACKAGED=1');
    expect(e2eFixture).not.toContain('--user-data-dir');
    expect(e2eFixture).not.toContain('TOMNY_CLEAN_MACHINE');
  });
});
