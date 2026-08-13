/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export type VerificationResult = {
  passed: boolean;
  /** Captured terminal output (truncated tail). */
  output: string;
  /** Process exit code, or null when killed / unknown. */
  exitCode: number | null;
};

/**
 * Guard a Goal Mode "done" claim with a real workspace verification command.
 * The base never launches the optional Terminal package to do this. Until the
 * Hub-owned supervised command verifier is available, this fails closed.
 *
 * Best-effort: if the terminal bridge is unavailable, resolves as not-passed so
 * the caller can decide (it never throws).
 */
export const runWorkspaceVerification = async (
  workspacePath: string,
  command: string,
  _timeoutMs?: number
): Promise<VerificationResult> => {
  if (!workspacePath || !command.trim()) {
    return { passed: false, output: '(missing workspace or command)', exitCode: null };
  }

  return {
    passed: false,
    output: '(Hub command verifier unavailable; optional Terminal package was not activated.)',
    exitCode: null,
  };
};
