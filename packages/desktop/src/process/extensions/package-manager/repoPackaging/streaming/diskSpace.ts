/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Refuses to start writing a package the output drive cannot hold. The archive is written through a
 * temporary file next to the result, so twice the payload (plus a safety reserve) must be free.
 */

import { stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { RepoPackagingError, type PackagingWarning } from '../types';

/** Free space that must remain after the package is written, whatever its size. */
export const DISK_RESERVE_BYTES = 1024 * 1024 * 1024;

/** Reads the free bytes of the drive that holds `directory`. It may reject when the platform cannot say. */
export type FreeSpaceReader = (directory: string) => Promise<number>;

export const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

/** The folder itself, or its nearest ancestor that exists, because the output folder may not be created yet. */
const nearestExistingDirectory = async (directory: string): Promise<string> => {
  let current = path.resolve(directory);
  for (;;) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- each step depends on the previous one failing.
      if ((await stat(current)).isDirectory()) return current;
    } catch {
      // Keep climbing.
    }
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
};

/** Free bytes available to this user on the drive of `directory`, from `fs.statfs`. */
export const readFreeSpaceBytes: FreeSpaceReader = async (directory) => {
  const stats = await statfs(await nearestExistingDirectory(directory));
  return Number(stats.bavail) * Number(stats.bsize);
};

/**
 * Throws `DISK_SPACE_LOW` when the free space is below `2 × estimatedBytes + 1 GB`. When the free space
 * cannot be read the package is not blocked; a warning says the check did not happen.
 */
export const checkDiskSpace = async (
  outputDirectory: string,
  estimatedBytes: number,
  readFreeSpace: FreeSpaceReader = readFreeSpaceBytes
): Promise<PackagingWarning[]> => {
  let freeBytes: number;
  try {
    freeBytes = await readFreeSpace(outputDirectory);
  } catch {
    freeBytes = Number.NaN;
  }
  if (!Number.isFinite(freeBytes) || freeBytes < 0) {
    return [
      {
        code: 'DISK_SPACE_UNKNOWN',
        message:
          'Không đọc được dung lượng trống của ổ đĩa chứa thư mục đầu ra nên chưa kiểm tra được. Hãy chắc rằng ổ còn đủ chỗ.',
      },
    ];
  }
  const requiredBytes = 2 * estimatedBytes + DISK_RESERVE_BYTES;
  if (freeBytes < requiredBytes) {
    throw new RepoPackagingError(
      'DISK_SPACE_LOW',
      `Ổ đĩa chứa thư mục đầu ra không đủ chỗ trống: còn ${formatBytes(freeBytes)}, cần ít nhất ${formatBytes(requiredBytes)} (2 × ${formatBytes(estimatedBytes)} dung lượng ước tính + 1 GB dự phòng). Hãy giải phóng ổ đĩa hoặc đổi thư mục đầu ra.`,
      { freeBytes, requiredBytes, estimatedBytes }
    );
  }
  return [];
};
