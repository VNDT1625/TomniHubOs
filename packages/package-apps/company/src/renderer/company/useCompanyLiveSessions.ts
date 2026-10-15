/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { liveSessionsChannels } from '@/common/types/agent/liveSessions';
import { useEffect } from 'react';
import { COMPANY_APP_ID, companyRunsToLiveSessions } from './companyLiveSessions';
import { listCompanyRuns, subscribeCompanyRuns } from './useCompanyPipeline';

let started = false;
let lastSent = '';

const sendRuns = (): void => {
  try {
    const sessions = companyRunsToLiveSessions(listCompanyRuns());
    const signature = JSON.stringify(sessions);
    if (signature === lastSent) return;
    lastSent = signature;
    void liveSessionsChannels.report.invoke({ appId: COMPANY_APP_ID, sessions }).catch((): undefined => undefined);
  } catch {
    // The sidebar is optional for the app; a report that cannot be sent is skipped.
  }
};

/**
 * Reports the companies' pipeline runs to the sidebar "Active" section from the module-level run store. A run
 * keeps going after the Company page is left, so the report is not tied to the page's mount: it starts once and
 * follows the store.
 */
export const startCompanyLiveSessionsReporter = (): void => {
  if (started) return;
  started = true;
  subscribeCompanyRuns(sendRuns);
  sendRuns();
};

/** Call from the Company page so the reporter runs as soon as the app is first opened. */
export const useCompanyLiveSessions = (): void => {
  useEffect(() => {
    startCompanyLiveSessionsReporter();
  }, []);
};
