#!/usr/bin/env bun
/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  buildTomnyPackageFromRepo,
  renderFailure,
  renderSuccess,
  type RepoPackagingProgress,
  type RepoToPackageOptions,
} from '../packages/desktop/src/process/extensions/package-manager/repoPackaging';

const USAGE = `
TomniHubOS Repo-to-Package (.tomny)

Usage:
  bun scripts/repo-to-package.ts [source] [options]

  source            A folder, or an https Git URL on github.com, gitlab.com, bitbucket.org or codeberg.org.
                    Defaults to the current folder.

Options:
  --output, -o      Folder for the .tomny file (default: ./store-artifacts)
  --path            Package only this folder of the repository (for example dist)
  --ref             Branch or tag to clone (Git URLs only)
  --name, -n        Package display name
  --id              Package identifier (for example com.community.myapp)
  --publisher       Publisher identifier (default: com.community)
  --version, -v     Package version
  --key             Ed25519 private key (PEM) to sign with, for example your enrolled publisher key
  --key-id          Identifier of that key (required with --key)
  --key-dir         Folder of the persistent local signing key (default: ~/.tomny/keys, created on first use)
  --help, -h        Show this help

Examples:
  bun scripts/repo-to-package.ts ./examples/sample-notes-package
  bun scripts/repo-to-package.ts https://github.com/user/my-web-tool --output ./dist
  bun scripts/repo-to-package.ts . --path dist --name "My Tool"
`;

type CliOptions = {
  source: string;
  output: string;
  subdirectory?: string;
  ref?: string;
  name?: string;
  packageId?: string;
  publisherId?: string;
  version?: string;
  keyFile?: string;
  keyId?: string;
  keyDirectory: string;
};

const VALUE_FLAGS: Readonly<Record<string, keyof CliOptions>> = {
  '--output': 'output',
  '-o': 'output',
  '--path': 'subdirectory',
  '--ref': 'ref',
  '--name': 'name',
  '-n': 'name',
  '--id': 'packageId',
  '--publisher': 'publisherId',
  '--version': 'version',
  '-v': 'version',
  '--key': 'keyFile',
  '--key-id': 'keyId',
  '--key-dir': 'keyDirectory',
};

const parseArguments = (argv: readonly string[]): CliOptions => {
  const options: CliOptions = {
    source: '',
    output: './store-artifacts',
    keyDirectory: process.env.TOMNY_KEY_DIR ?? path.join(homedir(), '.tomny', 'keys'),
  };
  let sourceSeen = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    const field = VALUE_FLAGS[argument];
    if (field !== undefined) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      (options as Record<string, string>)[field] = value;
      index += 1;
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (sourceSeen) {
      throw new Error(`Only one source is accepted; got an extra "${argument}".`);
    } else {
      options.source = argument;
      sourceSeen = true;
    }
  }
  return options;
};

const describeProgress = (event: RepoPackagingProgress): string =>
  `  [${event.status === 'done' ? 'x' : ' '}] ${event.stage}${event.detail ? ` — ${event.detail}` : ''}`;

const main = async (): Promise<number> => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }

  let cli: CliOptions;
  try {
    cli = parseArguments(argv);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    console.error(USAGE);
    return 1;
  }

  let signing: RepoToPackageOptions['signing'] = { keyDirectory: cli.keyDirectory };
  if (cli.keyFile !== undefined) {
    if (cli.keyId === undefined) {
      console.error('Error: --key needs --key-id.');
      return 1;
    }
    signing = { privateKeyPem: await readFile(path.resolve(cli.keyFile), 'utf8'), keyId: cli.keyId };
  }

  console.log(`Packaging ${cli.source === '' ? '.' : cli.source} ...`);
  try {
    const result = await buildTomnyPackageFromRepo({
      source: cli.source,
      allowLocalOutsideWorkspace: true,
      outputDirectory: path.resolve(cli.output),
      subdirectory: cli.subdirectory,
      ref: cli.ref,
      name: cli.name,
      packageId: cli.packageId,
      publisherId: cli.publisherId,
      version: cli.version,
      signing,
      onProgress: (event) => {
        if (event.status === 'done') console.log(describeProgress(event));
      },
    });
    console.log(`\n${renderSuccess(result)}\n`);
    return 0;
  } catch (error) {
    console.error(`\n${renderFailure(cli.source, error)}\n`);
    return 1;
  }
};

// The shared package contracts start background work on import, so exit explicitly.
void main().then((code) => process.exit(code));
