/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turns on what a freshly installed package offers, once the install itself has finished (docs/platform/repotopackage-design.md
 * section 9.4, owner decision 2026-10-15). Data kinds (skill, command, agent, rules, knowledge) switch on without a question.
 * Code-running kinds are listed in ONE confirmation per package; the person approves all of them or none, and a "start again
 * automatically" choice applies to every approved one. Every hash is recomputed by the registry from the package on disk, so a
 * connection whose content changed after the dialog stays off. A connection that cannot run (unsupported, missing values)
 * is never offered and stays off with its reason.
 */

/* oxlint-disable no-await-in-loop -- connections of one package are switched on in order, one at a time */

import type { AdapterConnection, AdapterConnectionKind } from '@/common/packages/adapter';
import {
  DATA_KINDS,
  type ConnectionRegistry,
  type ConnectionView,
} from '@process/integrations/connections/core/registry';
import type { ApprovalSubject } from '@process/integrations/connections/core/types';

/** One code-running connection the person is asked about, with the description its approval hash covers. */
export type InstallActivationItem = Readonly<{
  key: string;
  kind: AdapterConnectionKind;
  subject: ApprovalSubject;
}>;

export type InstallActivationRequest = Readonly<{
  packageId: string;
  items: readonly InstallActivationItem[];
}>;

/**
 * `approved` must be an explicit yes; anything else (cancel, closed window, error) leaves every item off. `dismissed` is set
 * only by the start-again question: the person chose not to be asked again for this package.
 */
export type InstallActivationAnswer = Readonly<{ approved: boolean; autoStart: boolean; dismissed?: boolean }>;

/** Shows the consolidated confirmation. Main builds it; the renderer never reaches it. */
export type InstallActivationConfirm = (request: InstallActivationRequest) => Promise<InstallActivationAnswer>;

export type InstallActivationReport = Readonly<{
  /** Connections switched on by this install. `autoStart` is what the person chose for them. */
  enabled: readonly Readonly<{ key: string; kind: AdapterConnectionKind; autoStart: boolean }>[];
  /** Connections still off, each with the reason in words the person can read. */
  stayedOff: readonly Readonly<{ key: string; reason: string }>[];
}>;

export type InstallActivationDeps = Readonly<{
  registry: Pick<ConnectionRegistry, 'describe' | 'enable' | 'setAutoStart'>;
  /** Without a confirmation, code-running connections stay off. */
  confirm?: InstallActivationConfirm;
}>;

/**
 * The one place Main keeps the confirmation of this machine: set by the connection bootstrap (it owns the window), read by
 * the install paths. Unset means no window exists, so code-running connections stay off.
 */
let activationConfirm: InstallActivationConfirm | undefined;

export const setInstallActivationConfirm = (confirm: InstallActivationConfirm | undefined): void => {
  activationConfirm = confirm;
};

export const getInstallActivationConfirm = (): InstallActivationConfirm | undefined => activationConfirm;

const MAX_REASON_LENGTH = 300;
const NOT_APPROVED = 'Bạn chưa duyệt, kết nối vẫn tắt. Có thể bật từng cái trong chi tiết gói.';
const NO_CONFIRMATION = 'Máy này chưa có hộp xác nhận, kết nối vẫn tắt. Có thể bật trong chi tiết gói.';
const UNKNOWN_REASON = 'Chưa thể bật kết nối này.';
/** A connection that may be turned on now: off, or stopped by a failed host (`error`), and not on already. */
const isCandidate = (view: ConnectionView): boolean =>
  !view.state.enabled && (view.state.status === 'off' || view.state.status === 'error');

/** The group of an alternative connection (`group`), or undefined when it has none. */
const groupOf = (connection: AdapterConnection): string | undefined =>
  'group' in connection && typeof connection.group === 'string' ? connection.group : undefined;
const alternativeReason = (group: string): string =>
  `Phương án thay thế trong nhóm "${group}": một kết nối khác của nhóm đã được chọn.`;

const reasonOf = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  const clipped = text.trim() === '' ? UNKNOWN_REASON : text;
  return clipped.length > MAX_REASON_LENGTH ? `${clipped.slice(0, MAX_REASON_LENGTH - 1)}…` : clipped;
};

/**
 * Activates the connections of one package right after its install. `views` is the registry's state after the sync that
 * followed the install. Never throws: each connection that cannot be enabled is reported with its reason instead.
 */
export const activateInstalledConnections = async (
  deps: InstallActivationDeps,
  packageId: string,
  views: readonly ConnectionView[]
): Promise<InstallActivationReport> => {
  const enabled: { key: string; kind: AdapterConnectionKind; autoStart: boolean }[] = [];
  const stayedOff: { key: string; reason: string }[] = [];

  for (const view of views) {
    if (view.state.enabled || isCandidate(view)) continue;
    stayedOff.push({ key: view.key, reason: view.state.reason ?? UNKNOWN_REASON });
  }
  const candidates = views.filter(isCandidate);
  // Only one alternative of a group may be on: a group already on keeps the others off, and so does one kept here.
  const takenGroups = new Set<string>();
  for (const view of views) {
    const group = groupOf(view.connection);
    if (view.state.enabled && group !== undefined) takenGroups.add(group);
  }
  const alternativeOf = (view: ConnectionView): boolean => {
    const group = groupOf(view.connection);
    if (group === undefined || !takenGroups.has(group)) return false;
    stayedOff.push({ key: view.key, reason: alternativeReason(group) });
    return true;
  };
  const reserve = (view: ConnectionView): void => {
    const group = groupOf(view.connection);
    if (group !== undefined) takenGroups.add(group);
  };

  for (const view of candidates.filter((candidate) => DATA_KINDS.has(candidate.connection.kind))) {
    if (alternativeOf(view)) continue;
    try {
      const approval = await deps.registry.describe(packageId, view.key);
      await deps.registry.enable(packageId, view.key, approval.approvalHash);
      reserve(view);
      enabled.push({ key: view.key, kind: view.connection.kind, autoStart: false });
    } catch (error) {
      stayedOff.push({ key: view.key, reason: reasonOf(error) });
    }
  }

  const prepared: Array<{ key: string; kind: AdapterConnectionKind; approvalHash: string; subject: ApprovalSubject }> =
    [];
  for (const view of candidates.filter((candidate) => !DATA_KINDS.has(candidate.connection.kind))) {
    if (alternativeOf(view)) continue;
    try {
      const approval = await deps.registry.describe(packageId, view.key);
      reserve(view);
      prepared.push({
        key: view.key,
        kind: view.connection.kind,
        approvalHash: approval.approvalHash,
        subject: approval.subject,
      });
    } catch (error) {
      stayedOff.push({ key: view.key, reason: reasonOf(error) });
    }
  }
  if (prepared.length === 0) return { enabled, stayedOff };

  if (deps.confirm === undefined) {
    for (const item of prepared) stayedOff.push({ key: item.key, reason: NO_CONFIRMATION });
    return { enabled, stayedOff };
  }

  let answer: InstallActivationAnswer;
  try {
    answer = await deps.confirm({
      packageId,
      items: prepared.map((item) => ({ key: item.key, kind: item.kind, subject: item.subject })),
    });
  } catch {
    answer = { approved: false, autoStart: false };
  }
  if (answer.approved !== true) {
    for (const item of prepared) stayedOff.push({ key: item.key, reason: NOT_APPROVED });
    return { enabled, stayedOff };
  }

  for (const item of prepared) {
    try {
      // The hash is the one the person was shown; the registry compares it with a fresh one before anything starts.
      await deps.registry.enable(packageId, item.key, item.approvalHash);
    } catch (error) {
      stayedOff.push({ key: item.key, reason: reasonOf(error) });
      continue;
    }
    let autoStart = false;
    if (answer.autoStart === true) {
      try {
        await deps.registry.setAutoStart(packageId, item.key, true);
        autoStart = true;
      } catch {
        // The connection is on for this session; only the start-again choice was not kept.
      }
    }
    enabled.push({ key: item.key, kind: item.kind, autoStart });
  }
  return { enabled, stayedOff };
};
