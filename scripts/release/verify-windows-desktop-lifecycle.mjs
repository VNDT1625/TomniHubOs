#!/usr/bin/env node
/**
 * Runs a packaged Windows desktop executable with a fresh profile and accepts
 * only the Main-owned readiness receipt emitted after the renderer loads.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const READY_FILE = 'clean-machine-ready.json';
const READY_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 250;
const fail = (message) => {
  throw new Error(message);
};

const readArgument = (name) => {
  const prefix = `${name}=`;
  const value = process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
  if (!value) fail(`${name} is required.`);
  return resolve(value);
};
const terminateProcessTree = (child) => {
  if (!child.pid || child.exitCode !== null) return;
  const command = process.platform === 'win32' ? 'taskkill' : 'kill';
  const args = process.platform === 'win32' ? ['/pid', String(child.pid), '/t', '/f'] : ['-TERM', String(child.pid)];
  spawn(command, args, { stdio: 'ignore', windowsHide: true }).unref();
};
const waitForReadyReceipt = async (path, child) => {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      fail(
        'Packaged app exited before readiness receipt (code=' +
          child.exitCode +
          ', signal=' +
          (child.signalCode ?? 'none') +
          ').'
      );
    if (existsSync(path)) {
      try {
        return JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        /* atomic write in progress */
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, POLL_INTERVAL_MS));
  }
  fail(`Timed out waiting for Main readiness receipt: ${path}`);
};
const main = async () => {
  if (process.platform !== 'win32') fail('Windows packaged lifecycle verification requires win32.');
  const artifact = readArgument('--artifact');
  const profile = readArgument('--profile');
  const expectedRunId = process.env.TOMNY_CLEAN_MACHINE_RUN_ID ?? randomUUID();
  if (basename(artifact).toLowerCase() !== 'tomny.exe') fail(`Expected unpacked Tomny.exe, received ${artifact}.`);
  if (!existsSync(artifact)) fail(`Packaged executable does not exist: ${artifact}`);

  const receiptPath = resolve(profile, READY_FILE);
  rmSync(receiptPath, { force: true });
  const child = spawn(artifact, [`--user-data-dir=${profile}`], {
    cwd: dirname(artifact),
    env: {
      ...process.env,
      TOMNY_CLEAN_MACHINE: '1',
      TOMNY_CLEAN_MACHINE_RUN_ID: expectedRunId,
      TOMNY_CLEAN_MACHINE_PROFILE_DIR: profile,
    },
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    const receipt = await waitForReadyReceipt(receiptPath, child);
    if (
      !receipt ||
      receipt.schemaVersion !== 1 ||
      receipt.runId !== expectedRunId ||
      receipt.isPackaged !== true ||
      typeof receipt.processId !== 'number' ||
      resolve(receipt.userDataPath) !== profile ||
      typeof receipt.rendererLoadedAt !== 'string'
    ) {
      fail('Main readiness receipt did not prove the expected packaged clean-profile launch.');
    }
    process.stdout.write(`[windows-desktop-lifecycle] PASSED ${receiptPath}\n`);
  } finally {
    terminateProcessTree(child);
  }
};
main().catch((error) => {
  process.stderr.write(`[windows-desktop-lifecycle] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
