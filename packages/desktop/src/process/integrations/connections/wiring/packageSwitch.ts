/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The package master switch (docs/platform/repotopackage-design.md section 9.4, "Giao diện theo cụm", owner decision
 * 2026-10-15). A package is one cluster: turning it on activates what the install activation would (data kinds without a
 * question, code-running kinds through ONE confirmation with Cancel as default); turning it off turns every connection of
 * the package off. It is a shortcut only: each connection keeps its own control inside the package, and standalone items
 * are not part of any package switch. Every check stays in the registry: the approval hash is recomputed in Main, and a
 * connection that is revoked, unsupported or missing values stays off with its reason.
 */

/* oxlint-disable no-await-in-loop -- connections of one package are switched in order, one at a time */

import type { PackageEnableReport } from '@/common/types/platform/packageConnections';
import type { ConnectionRegistry } from '@process/integrations/connections/core/registry';
import { activateInstalledConnections, type InstallActivationConfirm } from './installActivation';

export type PackageSwitchDeps = Readonly<{
  registry: Pick<ConnectionRegistry, 'view' | 'describe' | 'enable' | 'disable' | 'setAutoStart'>;
  /** Main's one confirmation for the code-running connections. Without it they stay off with a reason. */
  confirm?: InstallActivationConfirm;
}>;

/** Shown for a connection that is off after the package was turned off and has no reason of its own. */
const OFF_WITH_PACKAGE = 'Tắt cùng gói.';

/**
 * Turns the package's connections on or off. Never throws for a single connection: each one is reported. `enabled` lists
 * what this call turned on; `stayedOff` lists every connection still off afterwards, with the reason.
 */
export const setPackageEnabled = async (
  deps: PackageSwitchDeps,
  packageId: string,
  enabled: boolean
): Promise<PackageEnableReport> => {
  if (enabled) {
    const views = await deps.registry.view(packageId);
    const report = await activateInstalledConnections(
      { registry: deps.registry, ...(deps.confirm === undefined ? {} : { confirm: deps.confirm }) },
      packageId,
      views
    );
    return {
      enabled: report.enabled.map((item) => ({ key: item.key, kind: item.kind, autoStart: item.autoStart })),
      stayedOff: report.stayedOff.map((item) => ({ key: item.key, reason: item.reason })),
    };
  }

  const views = await deps.registry.view(packageId);
  const failures = new Map<string, string>();
  for (const view of views) {
    if (!view.state.enabled) continue;
    // A failing host is recorded as `error` with its reason; the loop still reaches every other connection.
    const state = await deps.registry.disable(packageId, view.key);
    if (state.lastError !== undefined) failures.set(view.key, state.lastError);
  }
  // A re-read rebuilds the states and drops a recorded error, so the failure reasons come from the disable calls above.
  const after = await deps.registry.view(packageId);
  return {
    enabled: [],
    stayedOff: after
      .filter((view) => !view.state.enabled)
      .map((view) => ({ key: view.key, reason: failures.get(view.key) ?? view.state.reason ?? OFF_WITH_PACKAGE })),
  };
};
