/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export type CoreBootMode = 'tomny' | 'compat' | 'legacy';

export type CoreBootPolicy = {
  mode: CoreBootMode;
  startLegacyBackend: boolean;
  requireLegacyBackend: boolean;
};

type ResolveCoreBootPolicyInput = {
  requestedMode?: string;
  isWebUIMode?: boolean;
  isResetPasswordMode?: boolean;
};

const VALID_MODES = new Set<CoreBootMode>(['tomny', 'compat', 'legacy']);

/**
 * Resolves the desktop core cutover policy without touching the legacy binary.
 * Compatibility mode is the desktop default until every HTTP-dependent feature is native to Tomny Core.
 */
export function resolveCoreBootPolicy(input: ResolveCoreBootPolicyInput = {}): CoreBootPolicy {
  const requested = input.requestedMode?.trim().toLowerCase();
  if (requested && !VALID_MODES.has(requested as CoreBootMode)) {
    throw new Error(`Invalid Tomny Core boot mode ${input.requestedMode}. Expected one of: tomny, compat, legacy.`);
  }

  // WebUI and password reset are served by the native Tomny Gateway. Surface
  // flags no longer widen the compatibility-backend requirement.
  const mode = (requested || 'compat') as CoreBootMode;

  if (mode === 'legacy') {
    return { mode: 'legacy', startLegacyBackend: true, requireLegacyBackend: true };
  }
  if (mode === 'compat') {
    return { mode, startLegacyBackend: true, requireLegacyBackend: false };
  }
  return { mode, startLegacyBackend: false, requireLegacyBackend: false };
}
