#!/usr/bin/env bun
/**
 * Build a signed .tomny artifact from a package project.
 *
 * Usage: bun run store:pack -- <project-directory> --key <private.pem> --key-id <id> [--out <directory>]
 */

import path from 'node:path';

import { buildPackageProject } from './packageProject.js';

const args = process.argv.slice(2);
const valueAfter = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const projectDirectory = args.find(
  (value, index) => !value.startsWith('--') && args[index - 1]?.startsWith('--') !== true
);
if (!projectDirectory) {
  throw new Error(
    'Usage: bun run store:pack -- <project-directory> --key <private.pem> --key-id <id> [--out <directory>]'
  );
}

const keyId = valueAfter('--key-id') ?? process.env.TOMNI_PACKAGE_SIGNING_KEY_ID;
const privateKeyPath = valueAfter('--key') ?? process.env.TOMNI_PACKAGE_SIGNING_PRIVATE_KEY_PATH;
const main = async (): Promise<void> => {
  if (!keyId || !privateKeyPath) {
    throw new Error(
      'Package signing requires --key and --key-id (or TOMNI_PACKAGE_SIGNING_PRIVATE_KEY_PATH and TOMNI_PACKAGE_SIGNING_KEY_ID).'
    );
  }
  const result = await buildPackageProject({
    projectDirectory,
    outputDirectory: valueAfter('--out') ?? path.resolve('store-artifacts'),
    privateKeyPath,
    keyId,
  });

  console.log(`Built ${result.manifest.id}@${result.manifest.version}`);
  console.log(`Artifact: ${result.artifactPath}`);
  console.log(`Archive: ${result.archiveBytes} bytes; payload: ${result.manifest.artifact?.sizeBytes ?? 0} bytes`);
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
