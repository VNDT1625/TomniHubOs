/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { RepoPackagingError } from './types';

export type RepoToPackageCommand = Readonly<{
  source: string;
  ref?: string;
  subdirectory?: string;
  name?: string;
  packageId?: string;
  version?: string;
  publisherId?: string;
}>;

const FLAGS: Readonly<Record<string, keyof RepoToPackageCommand>> = {
  '--ref': 'ref',
  '--path': 'subdirectory',
  '--name': 'name',
  '--id': 'packageId',
  '--version': 'version',
  '--publisher': 'publisherId',
};

/** Splits on whitespace, keeping quoted text together. Backslashes stay literal so Windows paths work. */
const tokenize = (input: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let quote: string | undefined;
  let started = false;
  for (const character of input) {
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/u.test(character)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
    } else {
      current += character;
      started = true;
    }
  }
  if (quote !== undefined) throw new RepoPackagingError('SOURCE_INVALID', 'Thiếu dấu ngoặc đóng trong lệnh.');
  if (started) tokens.push(current);
  return tokens;
};

/**
 * Parses what follows `/repotopackage`: an optional source, then optional `--ref`, `--path`, `--name`,
 * `--id`, `--version`, `--publisher`. An empty source means the workspace root.
 */
export const parseRepoToPackageCommand = (input: string): RepoToPackageCommand => {
  const tokens = tokenize(input.trim());
  const command: { -readonly [Key in keyof RepoToPackageCommand]: RepoToPackageCommand[Key] } = { source: '' };
  let sourceSeen = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    const field = FLAGS[token.toLowerCase()];
    if (field !== undefined) {
      const value = tokens[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new RepoPackagingError('SOURCE_INVALID', `Thiếu giá trị cho ${token}.`);
      }
      command[field] = value;
      index += 1;
    } else if (token.startsWith('--')) {
      throw new RepoPackagingError('SOURCE_INVALID', `Tuỳ chọn không được hỗ trợ: ${token}.`);
    } else if (sourceSeen) {
      throw new RepoPackagingError(
        'SOURCE_INVALID',
        `Chỉ nhận một nguồn; thừa "${token}". Dùng dấu ngoặc kép nếu đường dẫn có khoảng trắng.`
      );
    } else {
      command.source = token;
      sourceSeen = true;
    }
  }
  return command;
};
