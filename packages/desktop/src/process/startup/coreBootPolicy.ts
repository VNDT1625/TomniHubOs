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
  /** True only for an unpackaged desktop development build. */
  isPackaged?: boolean;
  /** Explicit, development-only acknowledgement to launch the legacy HTTP backend. */
  developmentCompatibilityOptIn?: boolean;
  isWebUIMode?: boolean;
  isResetPasswordMode?: boolean;
};

const VALID_MODES = new Set<CoreBootMode>(['tomny', 'compat', 'legacy']);

/** Only the exact development acknowledgement enables the compatibility backend. */
export function isDevelopmentCompatibilityOptIn(value: string | undefined): boolean {
  return value === '1';
}

/**
 * Resolves the desktop core cutover policy without touching the legacy binary.
 *
 * The legacy HTTP backend is never a production default. Compatibility is
 * available only to an unpackaged development build that explicitly opts in;
 * a packaged app, an omitted packaging signal, or an omitted opt-in always
 * falls back to native Tomny Core.
 */
export function resolveCoreBootPolicy(input: ResolveCoreBootPolicyInput = {}): CoreBootPolicy {
  const requested = input.requestedMode?.trim().toLowerCase();
  if (requested && !VALID_MODES.has(requested as CoreBootMode)) {
    throw new Error(`Invalid Tomny Core boot mode ${input.requestedMode}. Expected one of: tomny, compat, legacy.`);
  }

  const requestedMode = (requested || 'tomny') as CoreBootMode;
  const developmentCompatibilityAllowed = input.isPackaged === false && input.developmentCompatibilityOptIn === true;

  // Surface flags do not widen the compatibility-backend requirement. A
  // production command-line/environment override must likewise remain native.
  const mode = developmentCompatibilityAllowed ? requestedMode : 'tomny';

  if (mode === 'legacy') {
    return { mode: 'legacy', startLegacyBackend: true, requireLegacyBackend: true };
  }
  if (mode === 'compat') {
    return { mode, startLegacyBackend: true, requireLegacyBackend: false };
  }
  return { mode, startLegacyBackend: false, requireLegacyBackend: false };
}
