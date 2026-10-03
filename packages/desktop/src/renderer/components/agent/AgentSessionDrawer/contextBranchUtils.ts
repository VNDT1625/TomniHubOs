/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TomnyAgenticContextBranch } from '@/common';

const MAX_CONTEXT_BRANCH_CHARS = 8_000;

/** Validate the same branch invariants enforced by the legacy core before persistence. */
export const areContextBranchesValid = (branches: readonly TomnyAgenticContextBranch[]): boolean => {
  const ids = new Set<string>();
  return branches.every((branch) => {
    const id = branch.id.trim();
    if (!id || !branch.content.trim() || ids.has(id)) return false;
    ids.add(id);
    return Array.from(branch.content).length <= MAX_CONTEXT_BRANCH_CHARS;
  });
};

/** Approximate the prompt cost shown beside a branch before it becomes active. */
export const estimateContextBranchTokens = (content: string): number => Math.ceil(content.length / 4);
