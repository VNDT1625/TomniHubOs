import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const HARNESS = resolve(PROJECT_ROOT, 'scripts/release/run-clean-machine-harness.mjs');
const tempDirectories: string[] = [];

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

const makeTemporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'tomni-clean-machine-harness-'));
  tempDirectories.push(directory);
  return directory;
};

const runHarness = (directory: string, planPath: string, receiptPath: string) => {
  const result = spawnSync(
    process.execPath,
    [HARNESS, '--plan', planPath, '--receipt', receiptPath, '--profile-root', join(directory, 'profiles')],
    { cwd: PROJECT_ROOT, encoding: 'utf8' }
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const makePlan = (artifactSha256: string) => ({
  schemaVersion: 1,
  candidate: {
    sourceRevision: 'df9468b5eaf0902a563bf808e7aab01b821e8f69',
    releaseVersion: '1.0.0-candidate.1',
  },
  artifact: { path: 'candidate.bin', sha256: artifactSha256 },
  signatureVerifier: {
    label: 'fixture signature verifier',
    timeoutMs: 1_000,
    command: [
      process.execPath,
      '-e',
      'if (!process.argv.includes(process.env.TOMNI_CLEAN_MACHINE_ARTIFACT)) process.exit(7);',
      '{artifact}',
    ],
  },
  lifecycleVerifier: {
    label: 'fixture lifecycle verifier',
    timeoutMs: 1_000,
    command: [
      process.execPath,
      '-e',
      [
        "import { writeFileSync } from 'node:fs';",
        "if (process.env.TOMNI_CLEAN_MACHINE !== '1') process.exit(8);",
        "if (!process.argv.includes('--user-data-dir=' + process.env.TOMNI_CLEAN_MACHINE_PROFILE_DIR)) process.exit(9);",
        "writeFileSync(process.env.TOMNI_CLEAN_MACHINE_PROFILE_DIR + '/lifecycle-proof.json', JSON.stringify({ artifact: process.env.TOMNI_CLEAN_MACHINE_ARTIFACT, receipt: process.env.TOMNI_CLEAN_MACHINE_RECEIPT }));",
      ].join(' '),
      '{artifact}',
      '--user-data-dir={profile}',
      '{receipt}',
    ],
  },
});

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('release clean-machine harness', () => {
  it('fails closed before creating a receipt when required invocation inputs are absent', () => {
    const result = spawnSync(process.execPath, [HARNESS], { cwd: PROJECT_ROOT, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ERROR_PLAN_REQUIRED');
  });

  it('records a durable failed receipt and never runs a verifier when the explicit artifact is absent', () => {
    const directory = makeTemporaryDirectory();
    const planPath = join(directory, 'plan.json');
    const receiptPath = join(directory, 'receipt.json');
    writeFileSync(planPath, JSON.stringify(makePlan('0'.repeat(64))));

    const result = runHarness(directory, planPath, receiptPath);
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
      status: string;
      error: { code: string };
      signatureVerification: unknown;
    };

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ERROR_ARTIFACT_NOT_FOUND');
    expect(receipt.status).toBe('failed');
    expect(receipt.error.code).toBe('ERROR_ARTIFACT_NOT_FOUND');
    expect(receipt.signatureVerification).toBeNull();
  });

  it('runs explicit signature and lifecycle verifiers against a new isolated profile and writes a passing receipt', () => {
    const directory = makeTemporaryDirectory();
    const artifactPath = join(directory, 'candidate.bin');
    const planPath = join(directory, 'plan.json');
    const receiptPath = join(directory, 'receipt.json');
    writeFileSync(artifactPath, 'signed fixture payload');
    writeFileSync(planPath, JSON.stringify(makePlan(sha256(readFileSync(artifactPath)))));

    const result = runHarness(directory, planPath, receiptPath);
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
      status: string;
      artifact: { path: string; sha256: string; verifiedSha256: string };
      isolation: { profileDirectory: string; preserved: boolean };
      signatureVerification: { exitCode: number; label: string };
      lifecycleVerification: { exitCode: number; label: string };
    };
    const lifecycleProof = JSON.parse(
      readFileSync(join(receipt.isolation.profileDirectory, 'lifecycle-proof.json'), 'utf8')
    ) as {
      artifact: string;
      receipt: string;
    };

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PASSED');
    expect(receipt.status).toBe('passed');
    expect(receipt.artifact.path).toBe(artifactPath);
    expect(receipt.artifact.verifiedSha256).toBe(receipt.artifact.sha256);
    expect(receipt.isolation.profileDirectory).toContain(join('profiles', 'tomni-clean-machine-'));
    expect(receipt.isolation.preserved).toBe(true);
    expect(receipt.signatureVerification).toMatchObject({ exitCode: 0, label: 'fixture signature verifier' });
    expect(receipt.lifecycleVerification).toMatchObject({ exitCode: 0, label: 'fixture lifecycle verifier' });
    expect(lifecycleProof).toEqual({ artifact: artifactPath, receipt: receiptPath });
  });

  it('fails closed on a digest mismatch before a clean profile or verifier execution', () => {
    const directory = makeTemporaryDirectory();
    const artifactPath = join(directory, 'candidate.bin');
    const planPath = join(directory, 'plan.json');
    const receiptPath = join(directory, 'receipt.json');
    writeFileSync(artifactPath, 'changed payload');
    writeFileSync(planPath, JSON.stringify(makePlan('f'.repeat(64))));

    const result = runHarness(directory, planPath, receiptPath);
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
      error: { code: string };
      isolation: { profileDirectory: string | null };
      signatureVerification: unknown;
      lifecycleVerification: unknown;
    };

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ERROR_ARTIFACT_DIGEST_MISMATCH');
    expect(receipt.error.code).toBe('ERROR_ARTIFACT_DIGEST_MISMATCH');
    expect(receipt.isolation.profileDirectory).toBeNull();
    expect(receipt.signatureVerification).toBeNull();
    expect(receipt.lifecycleVerification).toBeNull();
    expect(basename(artifactPath)).toBe('candidate.bin');
  });
});
