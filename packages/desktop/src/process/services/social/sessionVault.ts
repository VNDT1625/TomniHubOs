/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

export class SocialSessionVault {
  private activePartitions = new Set<string>();

  /**
   * Generates a completely isolated Electron partition key for an account on a platform.
   * Example: persist:social_x_user123
   */
  getPartitionKey(platform: string, accountId: string): string {
    const sanitizedPlatform = platform.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const sanitizedAccountId = accountId.replace(/[^a-zA-Z0-9_-]/g, '');
    const partitionKey = `persist:social_${sanitizedPlatform}_${sanitizedAccountId}`;
    this.activePartitions.add(partitionKey);
    return partitionKey;
  }

  getActivePartitions(): string[] {
    return Array.from(this.activePartitions);
  }

  releasePartition(partitionKey: string): void {
    this.activePartitions.delete(partitionKey);
  }
}
