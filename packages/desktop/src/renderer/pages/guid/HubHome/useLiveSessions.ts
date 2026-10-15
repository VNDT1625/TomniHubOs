/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LiveSessionApp } from '@/common/liveSessions/model';
import { liveSessionsChannels } from '@/common/types/agent/liveSessions';
import { useEffect, useState } from 'react';

/** Sessions apps keep alive: an initial snapshot, then coalesced pushes. A failed read just shows nothing. */
export const useLiveSessions = (): { apps: LiveSessionApp[]; ready: boolean } => {
  const [apps, setApps] = useState<LiveSessionApp[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    let receivedPush = false;
    const unsubscribe = liveSessionsChannels.changed.on((snapshot) => {
      if (!alive) return;
      receivedPush = true;
      setApps(snapshot.apps);
      setReady(true);
    });
    void liveSessionsChannels.snapshot
      .invoke()
      .then((snapshot) => {
        if (!alive || receivedPush) return;
        setApps(snapshot.apps);
        setReady(true);
      })
      .catch(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return { apps, ready };
};
