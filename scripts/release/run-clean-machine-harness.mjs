#!/usr/bin/env node
/**
 * Release-owned clean-machine harness.
 *
 * The harness intentionally delegates platform signature validation and product
 * lifecycle assertions to explicit verifier commands from an immutable plan.
 * It supplies an isolated profile directory and writes an atomic receipt for
 * every run. A local build is never treated as a signed candidate by default.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const SCHEMA_VERSION = 1;
const DEFAULT_SIGNATURE_TIMEOUT_MS = 120_000;
const DEFAULT_LIFECYCLE_TIMEOUT_MS = 600_000;
const MAX_COMMAND_ARGUMENTS = 128;
const MAX_COMMAND_ARGUMENT_LENGTH = 4_096;

class HarnessError extends Error {
  constructor(code, message, evidence = undefined) {
    super(message);
    this.code = code;
    this.evidence = evidence;
  }
}

const fail = (code, message, evidence = undefined) => {
  throw new HarnessError(code, message, evidence);
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const resolvePath = (value, base = process.cwd()) => (isAbsolute(value) ? resolve(value) : resolve(base, value));

const parseCli = (argv) => {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--plan', '--receipt', '--profile-root'].includes(flag)) {
      fail('ERROR_UNKNOWN_ARGUMENT', `Unsupported argument: ${flag ?? '(missing)'}.`);
    }
    if (!value || value.startsWith('--')) fail('ERROR_ARGUMENT_VALUE_REQUIRED', `${flag} requires a value.`);
    if (values.has(flag)) fail('ERROR_DUPLICATE_ARGUMENT', `${flag} may be supplied only once.`);
    values.set(flag, value);
  }

  for (const flag of ['--plan', '--receipt', '--profile-root']) {
    if (!values.has(flag))
      fail(`ERROR_${flag.slice(2).replaceAll('-', '_').toUpperCase()}_REQUIRED`, `${flag} is required.`);
  }

  return Object.freeze({
    planPath: resolvePath(values.get('--plan')),
    receiptPath: resolvePath(values.get('--receipt')),
    profileRoot: resolvePath(values.get('--profile-root')),
  });
};

const assertExactKeys = (value, keys, code, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, `${label} must be an object.`);
  const received = Object.keys(value).toSorted();
  const expected = [...keys].toSorted();
  if (received.length !== expected.length || received.some((key, index) => key !== expected[index])) {
    fail(code, `${label} must contain exactly: ${expected.join(', ')}.`);
  }
};

const assertString = (value, code, label, maxLength = MAX_COMMAND_ARGUMENT_LENGTH) => {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || value.includes('\0')) {
    fail(code, `${label} must be a non-empty string no longer than ${maxLength} characters.`);
  }
  return value;
};

const parseCommand = (value, label, requiredPlaceholders, defaultTimeoutMs) => {
  assertExactKeys(value, ['command', 'label', 'timeoutMs'], 'ERROR_PLAN_SCHEMA_INVALID', label);
  assertString(value.label, 'ERROR_PLAN_SCHEMA_INVALID', `${label}.label`, 128);
  if (!Array.isArray(value.command) || value.command.length === 0 || value.command.length > MAX_COMMAND_ARGUMENTS) {
    fail('ERROR_PLAN_SCHEMA_INVALID', `${label}.command must contain 1-${MAX_COMMAND_ARGUMENTS} arguments.`);
  }
  const command = value.command.map((argument, index) =>
    assertString(argument, 'ERROR_PLAN_SCHEMA_INVALID', `${label}.command[${index}]`)
  );
  for (const placeholder of requiredPlaceholders) {
    if (!command.some((argument) => argument.includes(placeholder))) {
      fail('ERROR_PLAN_SCHEMA_INVALID', `${label}.command must reference ${placeholder}.`);
    }
  }
  const timeoutMs = value.timeoutMs ?? defaultTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 1_800_000) {
    fail('ERROR_PLAN_SCHEMA_INVALID', `${label}.timeoutMs must be an integer from 1000 to 1800000.`);
  }
  return Object.freeze({ label: value.label, command, timeoutMs });
};

const readPlan = (planPath) => {
  if (!existsSync(planPath)) fail('ERROR_PLAN_NOT_FOUND', `Plan does not exist: ${planPath}`);
  let content;
  try {
    content = readFileSync(planPath, 'utf8');
  } catch (error) {
    fail('ERROR_PLAN_READ_FAILED', `Could not read plan: ${error instanceof Error ? error.message : String(error)}`);
  }

  let value;
  try {
    value = JSON.parse(content);
  } catch (error) {
    fail(
      'ERROR_PLAN_PARSE_FAILED',
      `Plan is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  assertExactKeys(
    value,
    ['artifact', 'candidate', 'lifecycleVerifier', 'schemaVersion', 'signatureVerifier'],
    'ERROR_PLAN_SCHEMA_INVALID',
    'plan'
  );
  if (value.schemaVersion !== SCHEMA_VERSION)
    fail('ERROR_PLAN_SCHEMA_INVALID', `plan.schemaVersion must equal ${SCHEMA_VERSION}.`);

  assertExactKeys(value.candidate, ['releaseVersion', 'sourceRevision'], 'ERROR_PLAN_SCHEMA_INVALID', 'candidate');
  const sourceRevision = assertString(
    value.candidate.sourceRevision,
    'ERROR_PLAN_SCHEMA_INVALID',
    'candidate.sourceRevision',
    64
  );
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(sourceRevision)) {
    fail('ERROR_PLAN_SCHEMA_INVALID', 'candidate.sourceRevision must be a full 40- or 64-character Git hash.');
  }
  const releaseVersion = assertString(
    value.candidate.releaseVersion,
    'ERROR_PLAN_SCHEMA_INVALID',
    'candidate.releaseVersion',
    128
  );

  assertExactKeys(value.artifact, ['path', 'sha256'], 'ERROR_PLAN_SCHEMA_INVALID', 'artifact');
  const artifactPath = assertString(value.artifact.path, 'ERROR_PLAN_SCHEMA_INVALID', 'artifact.path');
  const artifactSha256 = assertString(
    value.artifact.sha256,
    'ERROR_PLAN_SCHEMA_INVALID',
    'artifact.sha256',
    64
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(artifactSha256))
    fail('ERROR_PLAN_SCHEMA_INVALID', 'artifact.sha256 must be a 64-character SHA-256 hex digest.');

  const planDirectory = dirname(planPath);
  return Object.freeze({
    rawDigest: sha256(content),
    sourceRevision: sourceRevision.toLowerCase(),
    releaseVersion,
    artifact: Object.freeze({ path: resolvePath(artifactPath, planDirectory), sha256: artifactSha256 }),
    signatureVerifier: parseCommand(
      value.signatureVerifier,
      'signatureVerifier',
      ['{artifact}'],
      DEFAULT_SIGNATURE_TIMEOUT_MS
    ),
    lifecycleVerifier: parseCommand(
      value.lifecycleVerifier,
      'lifecycleVerifier',
      ['{artifact}', '{profile}'],
      DEFAULT_LIFECYCLE_TIMEOUT_MS
    ),
  });
};

const replacePlaceholders = (command, paths) =>
  command.map((argument) =>
    argument
      .replaceAll('{artifact}', paths.artifact)
      .replaceAll('{profile}', paths.profile)
      .replaceAll('{receipt}', paths.receipt)
  );

const runCommand = async (kind, spec, paths, environment) => {
  const command = replacePlaceholders(spec.command, paths);
  const startedAt = now();
  const started = Date.now();
  let child;
  try {
    child = spawn(command[0], command.slice(1), {
      cwd: dirname(paths.artifact),
      env: environment,
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
  } catch (error) {
    fail(
      `ERROR_${kind}_SPAWN_FAILED`,
      `${spec.label} could not start: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const result = await new Promise((resolveResult) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, spec.timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      resolveResult({ error, timedOut: false });
    });
    child.once('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolveResult({ exitCode, signal, timedOut });
    });
  });

  const evidence = Object.freeze({
    label: spec.label,
    startedAt,
    finishedAt: now(),
    durationMs: Date.now() - started,
    timeoutMs: spec.timeoutMs,
    exitCode: result.exitCode ?? null,
    signal: result.signal ?? null,
  });
  if (result.timedOut) fail(`ERROR_${kind}_TIMED_OUT`, `${spec.label} exceeded ${spec.timeoutMs}ms.`, evidence);
  if (result.error)
    fail(`ERROR_${kind}_SPAWN_FAILED`, `${spec.label} could not start: ${result.error.message}`, evidence);
  if (result.exitCode !== 0)
    fail(`ERROR_${kind}_FAILED`, `${spec.label} exited with code ${result.exitCode ?? 'unknown'}.`, evidence);
  return evidence;
};

const writeReceipt = (receiptPath, receipt) => {
  mkdirSync(dirname(receiptPath), { recursive: true });
  const temporaryPath = `${receiptPath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flush: true });
  renameSync(temporaryPath, receiptPath);
};

const main = async () => {
  let cli;
  let receipt;
  try {
    cli = parseCli(process.argv.slice(2));
    const runId = randomUUID();
    receipt = {
      schemaVersion: SCHEMA_VERSION,
      runId,
      status: 'running',
      startedAt: now(),
      finishedAt: null,
      candidate: null,
      artifact: null,
      isolation: { profileDirectory: null, preserved: true },
      signatureVerification: null,
      lifecycleVerification: null,
      error: null,
      machine: { platform: process.platform, arch: process.arch, node: process.version },
    };
    writeReceipt(cli.receiptPath, receipt);

    const plan = readPlan(cli.planPath);
    receipt.candidate = {
      sourceRevision: plan.sourceRevision,
      releaseVersion: plan.releaseVersion,
      planSha256: plan.rawDigest,
    };
    receipt.artifact = { path: plan.artifact.path, sha256: plan.artifact.sha256, verifiedSha256: null };
    writeReceipt(cli.receiptPath, receipt);

    if (!existsSync(plan.artifact.path))
      fail('ERROR_ARTIFACT_NOT_FOUND', `Artifact does not exist: ${plan.artifact.path}`);
    if (!lstatSync(plan.artifact.path).isFile())
      fail('ERROR_ARTIFACT_NOT_FILE', `Artifact is not a regular file: ${plan.artifact.path}`);
    const actualSha256 = sha256(readFileSync(plan.artifact.path));
    receipt.artifact.verifiedSha256 = actualSha256;
    if (actualSha256 !== plan.artifact.sha256) {
      fail(
        'ERROR_ARTIFACT_DIGEST_MISMATCH',
        `Artifact hash did not match the release plan for ${basename(plan.artifact.path)}.`
      );
    }

    mkdirSync(cli.profileRoot, { recursive: true });
    const profileDirectory = mkdtempSync(join(cli.profileRoot, 'tomni-clean-machine-'));
    receipt.isolation.profileDirectory = profileDirectory;
    writeReceipt(cli.receiptPath, receipt);

    const environment = Object.freeze({
      ...process.env,
      TOMNI_CLEAN_MACHINE: '1',
      TOMNI_CLEAN_MACHINE_ARTIFACT: plan.artifact.path,
      TOMNI_CLEAN_MACHINE_PROFILE_DIR: profileDirectory,
      TOMNI_CLEAN_MACHINE_RECEIPT: cli.receiptPath,
      TOMNI_CLEAN_MACHINE_RUN_ID: runId,
      TOMNI_CLEAN_MACHINE_SOURCE_REVISION: plan.sourceRevision,
    });
    const paths = Object.freeze({ artifact: plan.artifact.path, profile: profileDirectory, receipt: cli.receiptPath });

    receipt.signatureVerification = await runCommand(
      'SIGNATURE_VERIFICATION',
      plan.signatureVerifier,
      paths,
      environment
    );
    writeReceipt(cli.receiptPath, receipt);
    receipt.lifecycleVerification = await runCommand(
      'LIFECYCLE_VERIFICATION',
      plan.lifecycleVerifier,
      paths,
      environment
    );
    receipt.status = 'passed';
    receipt.finishedAt = now();
    writeReceipt(cli.receiptPath, receipt);
    process.stdout.write(`[clean-machine-harness] PASSED ${receipt.runId}; receipt: ${cli.receiptPath}\n`);
  } catch (error) {
    const code = error instanceof HarnessError ? error.code : 'ERROR_UNEXPECTED';
    const message = error instanceof Error ? error.message : String(error);
    if (receipt && cli) {
      receipt.status = 'failed';
      receipt.finishedAt = now();
      receipt.error = { code, message };
      if (error instanceof HarnessError && error.evidence) {
        if (code.startsWith('ERROR_SIGNATURE')) receipt.signatureVerification = error.evidence;
        if (code.startsWith('ERROR_LIFECYCLE')) receipt.lifecycleVerification = error.evidence;
      }
      writeReceipt(cli.receiptPath, receipt);
    }
    process.stderr.write(`[clean-machine-harness] ${code}: ${message}\n`);
    process.exitCode = 1;
  }
};

void main();
