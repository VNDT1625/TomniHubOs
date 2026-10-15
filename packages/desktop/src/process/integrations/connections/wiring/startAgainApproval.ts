/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one-time start-again approval at app start (docs/platform/repotopackage-design.md section 9.4). A code-running
 * connection that is marked to start again but holds no approval (a record from before approvals were kept) stays off. At
 * start, each package with such a connection gets one question per app run:
 * - Allow turns those connections on through the same describe and enable checks as an install; the start-again choice
 *   stays, so the approval is kept for the next launch;
 * - Cancel, no answer in time, or no window changes nothing: the question comes back at the next launch;
 * - "Do not ask again" clears the start-again choice of the package's connections, so they stay off for good.
 * Nothing runs before Allow. A package is asked at most once per run, however often startup runs.
 */

/* oxlint-disable no-await-in-loop -- one package's question and its changes run in order, one at a time */

import {
  awaitsStartApproval,
  type ConnectionRegistry,
  type ConnectionView,
} from '@process/integrations/connections/core/registry';
import type { InstallActivationAnswer, InstallActivationItem, InstallActivationRequest } from './installActivation';

export type StartAgainDeps = Readonly<{
  registry: Pick<ConnectionRegistry, 'view' | 'describe' | 'enable' | 'setAutoStart'>;
  /** Shows the package's question in the app. Resolves to `undefined` when no window can show it. */
  ask: (
    request: InstallActivationRequest,
    packageName: string,
    prompt: 'start-again'
  ) => Promise<InstallActivationAnswer | undefined>;
  /** The display name of an installed package; undefined when it is not known. */
  packageName: (packageId: string) => Promise<string | undefined>;
}>;

export type StartAgainRunner = (packageIds: readonly string[]) => Promise<void>;

/** One package: describe what waits, ask once, then act on the answer. Never throws. */
const askForPackage = async (deps: StartAgainDeps, packageId: string): Promise<void> => {
  const views: readonly ConnectionView[] = await deps.registry
    .view(packageId)
    .catch((): readonly ConnectionView[] => []);
  const waiting = views.filter((view) => awaitsStartApproval(view.state));
  if (waiting.length === 0) return;

  // Describing reads the package files only; nothing is started here.
  const hashes = new Map<string, string>();
  const items: InstallActivationItem[] = [];
  for (const view of waiting) {
    try {
      const approval = await deps.registry.describe(packageId, view.key);
      hashes.set(view.key, approval.approvalHash);
      items.push({ key: view.key, kind: view.connection.kind, subject: approval.subject });
    } catch {
      // Not describable: it stays off with its reason, as the install activation does.
    }
  }
  if (items.length === 0) return;

  const packageName = (await deps.packageName(packageId).catch((): undefined => undefined)) ?? packageId;
  const answer = await deps.ask({ packageId, items }, packageName, 'start-again').catch((): undefined => undefined);

  if (answer?.dismissed === true) {
    for (const item of items) {
      await deps.registry.setAutoStart(packageId, item.key, false).catch((): undefined => undefined);
    }
    return;
  }
  if (answer?.approved !== true) return;

  for (const item of items) {
    const approvalHash = hashes.get(item.key);
    if (approvalHash === undefined) continue;
    // The registry compares this hash with a fresh one before anything starts; a failure leaves the connection off with its reason.
    await deps.registry.enable(packageId, item.key, approvalHash).catch((): undefined => undefined);
  }
};

/**
 * The runner of one app run. Each package is asked at most once, in order, one question at a time; a later call for a
 * package that was already asked does nothing.
 */
export const createStartAgainRunner = (deps: StartAgainDeps): StartAgainRunner => {
  const asked = new Set<string>();
  return async (packageIds) => {
    for (const packageId of packageIds) {
      if (asked.has(packageId)) continue;
      asked.add(packageId);
      await askForPackage(deps, packageId);
    }
  };
};

/** The runner the bootstrap sets once the in-app dialog exists. Packages found before that wait for it. */
let activeRunner: StartAgainRunner | undefined;
let waitingPackages: readonly string[] = [];

/** Starts the questions for these packages now, or as soon as a runner is set. */
export const scheduleStartAgainApprovals = (packageIds: readonly string[]): void => {
  if (activeRunner === undefined) {
    waitingPackages = [...new Set([...waitingPackages, ...packageIds])];
    return;
  }
  void activeRunner(packageIds).catch((): undefined => undefined);
};

/** Sets (or clears, with undefined) the runner. Clearing also forgets packages that were waiting for one. */
export const setStartAgainRunner = (runner: StartAgainRunner | undefined): void => {
  activeRunner = runner;
  if (runner === undefined) {
    waitingPackages = [];
    return;
  }
  const packageIds = waitingPackages;
  waitingPackages = [];
  if (packageIds.length > 0) void runner(packageIds).catch((): undefined => undefined);
};