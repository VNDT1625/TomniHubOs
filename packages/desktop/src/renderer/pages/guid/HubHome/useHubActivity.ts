/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { hubActivityChannels, type HubActivityItem, type HubActivitySnapshot } from '@/common/types/agent/hubActivity';
import { extractHtmlPreviewBlocks } from '@/common/chat/htmlPreviewStream';
import { useCallback, useEffect, useState } from 'react';

export type HubActivityControls = {
  items: HubActivityItem[];
  ready: boolean;
  stop: (id: string) => Promise<boolean>;
  respond: (id: string, promptId: string, value: string) => Promise<boolean>;
  dismiss: (id: string) => Promise<boolean>;
};

/** Live Hub work from Main: an initial snapshot, then coalesced pushes.
 * The same complete agent output also powers Home's HTML Preview, independent
 * of Markdown component identity and without duplicating an IPC stream.
 */
export const useHubActivity = (): HubActivityControls => {
  const [items, setItems] = useState<HubActivityItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    let receivedPush = false;
    const previews = new Map<string, { blocks: string[]; pending: boolean }>();

    const applySnapshot = (snapshot: HubActivitySnapshot) => {
      const present = new Set<string>();
      for (const item of snapshot.items) {
        if (item.kind !== 'agent' || !item.preview) continue;
        const blocks = extractHtmlPreviewBlocks(item.preview);
        if (!blocks.length) continue;
        present.add(item.id);
        const pending = item.status === 'running' || item.status === 'needs_input';
        const previous = previews.get(item.id);
        if (
          previous?.pending === pending &&
          previous.blocks.length === blocks.length &&
          previous.blocks.every((block, index) => block === blocks[index])
        )
          continue;
        const update = { sourceId: item.id, blocks, pending };
        previews.set(item.id, { blocks, pending });
        window.dispatchEvent(new CustomEvent('preview.source-update', { detail: update }));
      }
      for (const key of previews.keys()) {
        if (!present.has(key)) previews.delete(key);
      }
      setItems(snapshot.items);
      setReady(true);
    };

    const replayCurrentSource = (event: Event) => {
      const detail = (event as CustomEvent<{ metadata?: { sourceId?: string } }>).detail;
      const sourceId = detail?.metadata?.sourceId;
      if (!sourceId) return;
      const latest = previews.get(sourceId);
      if (!latest) return;
      queueMicrotask(() => {
        if (alive) window.dispatchEvent(new CustomEvent('preview.source-update', { detail: { sourceId, ...latest } }));
      });
    };
    window.addEventListener('preview.open', replayCurrentSource);
    const unsubscribe = hubActivityChannels.changed.on((snapshot) => {
      if (!alive) return;
      receivedPush = true;
      applySnapshot(snapshot);
    });
    void hubActivityChannels.snapshot
      .invoke()
      .then((snapshot) => {
        if (!alive || receivedPush) return;
        applySnapshot(snapshot);
      })
      .catch(() => {
        if (alive) setReady(true);
      });

    return () => {
      alive = false;
      unsubscribe();
      window.removeEventListener('preview.open', replayCurrentSource);
      previews.clear();
    };
  }, []);

  const stop = useCallback((id: string) => hubActivityChannels.stop.invoke({ id }), []);
  const respond = useCallback(
    (id: string, promptId: string, value: string) =>
      hubActivityChannels.respond.invoke({ id, prompt_id: promptId, value }),
    []
  );
  const dismiss = useCallback((id: string) => hubActivityChannels.dismiss.invoke({ id }), []);

  return { items, ready, stop, respond, dismiss };
};
