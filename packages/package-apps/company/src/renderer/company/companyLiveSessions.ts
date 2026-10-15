/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LiveSession } from '@/common/liveSessions/model';
import type { PipelineSnapshot } from './pipeline/pipelineStore';

/** Package id of the Company app (see the package manager's local-dev package list). */
export const COMPANY_APP_ID = 'com.tomni.company';

export type CompanyRunEntry = { companyId: string; snapshot: PipelineSnapshot };

/**
 * Map the companies' pipeline runs to sidebar live sessions. Only runs that are in progress (or failed)
 * are live; idle, finished and stopped runs are not reported.
 */
export const companyRunsToLiveSessions = (runs: readonly CompanyRunEntry[]): LiveSession[] => {
  const out: LiveSession[] = [];
  for (const { companyId, snapshot } of runs) {
    if (snapshot.phase !== 'running' && snapshot.phase !== 'error') continue;
    const states = Object.values(snapshot.states);
    const lastActiveAt = states.reduce((max, s) => (s.updatedAt > max ? s.updatedAt : max), 0);
    const task = states.find((s) => s.task)?.task;
    const status = snapshot.phase === 'error' ? 'error' : snapshot.pending.length > 0 ? 'attention' : 'working';
    const session: LiveSession = { id: companyId, title: companyId, status, icon: 'building' };
    if (lastActiveAt > 0) session.lastActiveAt = lastActiveAt;
    if (task) session.detail = task;
    out.push(session);
  }
  return out;
};
