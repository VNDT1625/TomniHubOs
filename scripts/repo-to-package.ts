#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { buildTomnyPackageFromRepo } from '../packages/desktop/src/process/extensions/package-manager/repoPackager';

const printUsage = (): void => {
  console.log(`
TomniHubOS Repo-to-Package Automated Packager (.tomny)
Usage:
  bun scripts/repo-to-package.ts <source-path-or-git-url> [options]

Options:
  --output, -o     Output directory for the .tomny bundle (default: ./store-artifacts)
  --name, -n       Override package display name
  --id             Override package identifier (e.g. com.community.myapp)
  --publisher      Override publisher ID (default: com.community)
  --version, -v    Override package version (default: 1.0.0)
  --help, -h       Display this help message

Examples:
  bun scripts/repo-to-package.ts ./examples/sample-notes-package
  bun scripts/repo-to-package.ts https://github.com/user/my-web-tool --output ./dist
`);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  let source = '';
  let outputDirectory: string | undefined;
  let name: string | undefined;
  let packageId: string | undefined;
  let publisherId: string | undefined;
  let version: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--output' || arg === '-o') {
      outputDirectory = args[++i];
    } else if (arg === '--name' || arg === '-n') {
      name = args[++i];
    } else if (arg === '--id') {
      packageId = args[++i];
    } else if (arg === '--publisher') {
      publisherId = args[++i];
    } else if (arg === '--version' || arg === '-v') {
      version = args[++i];
    } else if (!arg.startsWith('-') && !source) {
      source = arg;
    }
  }

  if (!source) {
    console.error('Error: Source path or Git URL is required.');
    printUsage();
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`  TomniHubOS Automated Repo-to-Package Packager`);
  console.log(`======================================================\n`);
  console.log(`[1/4] Scanning source: ${source}...`);

  const startTime = Date.now();
  try {
    const result = await buildTomnyPackageFromRepo({
      source,
      outputDirectory: outputDirectory ? path.resolve(outputDirectory) : path.resolve('./store-artifacts'),
      name,
      packageId,
      publisherId,
      version,
    });

    console.log(`[2/4] Archetype Detected:`);
    console.log(`      - Archetype:    ${result.classification.archetype}`);
    console.log(`      - Package Type: ${result.classification.packageType}`);
    console.log(`      - Reasons:`);
    for (const reason of result.classification.reasons) {
      console.log(`        * ${reason}`);
    }

    console.log(`\n[3/4] Manifest Generated (Least Privilege):`);
    console.log(`      - Package ID:   ${result.manifest.id}`);
    console.log(`      - Name:         ${result.manifest.name}`);
    console.log(`      - Version:      ${result.manifest.version}`);
    console.log(`      - Permissions:  ${JSON.stringify(result.manifest.permissions)}`);
    console.log(`      - Integrity:    ${result.manifest.artifact?.integrity}`);

    console.log(`\n[4/4] Package Built & Signed Successfully!`);
    console.log(`      - Artifact:     ${result.artifactPath}`);
    console.log(`      - Bundle Size:  ${(result.archiveBytes / 1024).toFixed(2)} KB`);
    console.log(`      - Time Taken:   ${Date.now() - startTime}ms`);
    console.log(`\nPackage is ready for sideloading or Store submission!\n`);
  } catch (error) {
    console.error(`\nPackaging failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
};

void main();
