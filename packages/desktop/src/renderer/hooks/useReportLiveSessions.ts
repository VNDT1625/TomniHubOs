/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LiveSession, LiveSessionActions } from '@/common/liveSessions/model';
import { liveSessionsChannels } from '@/common/types/agent/liveSessions';
import { useEffect } from 'react';

const send = (appId: string, sessions: readonly LiveSession[], actions?: LiveSessionActions): void => {
  try {
    void liveSessionsChannels.report
      .invoke(actions ? { appId, sessions, actions } : { appId, sessions })
      .catch((): undefined => undefined);
  } catch {
    // The sidebar is optional for an app; a report that cannot be sent is simply skipped.
  }
};

/**
 * Lets a first-party desktop app show the sessions it keeps alive (open documents, projects, chats) under
 * the sidebar "Active" section. Pass the app's package id and its current list; the list is sent when it
 * changes and the app is removed from Active when the screen unmounts. Errors are never raised to the app.
 */
export const useReportLiveSessions = (
  appId: string,
  sessions: readonly LiveSession[],
  actions?: LiveSessionActions
): void => {
  const signature = JSON.stringify([sessions, actions ?? null]);
  useEffect(() => {
    send(appId, sessions, actions);
    // `signature` stands for the list's content; re-sending an unchanged list would only add noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId, signature]);
  useEffect(() => () => send(appId, []), [appId]);
};
