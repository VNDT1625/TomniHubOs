import { EventEmitter } from 'node:events';
import type { BrowserTabInfo } from '@process/browser/browserViewManager';
import type { TabContents, TabsViewManager } from '@process/integrations/browserExtensions/wiring/browserTabsPort';
import type { BrowserTabLifecycleEvent } from '@process/integrations/browserExtensions/wiring/tabLifecycle';

export class FakeContents extends EventEmitter {
  destroyed = false;
  muted = false;
  loading = false;
  audible = false;
  title = '';

  constructor(
    readonly id: number,
    readonly session: unknown,
    public url: string
  ) {
    super();
  }

  getURL = (): string => this.url;
  getTitle = (): string => this.title;
  isLoading = (): boolean => this.loading;
  isDestroyed = (): boolean => this.destroyed;
  isAudioMuted = (): boolean => this.muted;
  isCurrentlyAudible = (): boolean => this.audible;
  setAudioMuted = (muted: boolean): void => {
    this.muted = muted;
  };

  asContents(): TabContents {
    return this as unknown as TabContents;
  }

  total(): number {
    return this.eventNames().reduce((sum, name) => sum + this.listenerCount(name), 0);
  }
}

export const PROFILE = { name: 'profile' };
export const OTHER = { name: 'web-embed' };

/** A view manager double that records what the adapter asks of it. */
export const fakeViewManager = () => {
  const tabs = new Map<string, { info: BrowserTabInfo; contents: FakeContents }>();
  const calls: string[] = [];
  const created: Record<string, unknown>[] = [];
  let counter = 0;
  const listeners = new Set<(event: BrowserTabLifecycleEvent) => void>();

  const add = (key: string, contents: FakeContents, extra: Partial<BrowserTabInfo> = {}): void => {
    tabs.set(key, {
      contents,
      info: {
        id: key,
        url: contents.url,
        title: '',
        visible: true,
        bounds: { x: 0, y: 0, width: 640, height: 480 },
        ...extra,
      },
    });
  };

  const manager: TabsViewManager = {
    listTabs: () => [...tabs.values()].map((tab) => tab.info),
    getWebContents: (key) => tabs.get(key)?.contents,
    createTab: (options) => {
      counter += 1;
      const key = `new-${counter}`;
      created.push(options);
      add(key, new FakeContents(500 + counter, PROFILE, options.url ?? ''), {
        visible: options.visible,
        background: options.background,
      });
      return key;
    },
    destroyTab: (key) => {
      calls.push(`destroy:${key}`);
    },
    loadURL: async (key, url) => {
      calls.push(`load:${key}:${url}`);
    },
    show: (key) => {
      calls.push(`show:${key}`);
      for (const [other, tab] of tabs) tab.info = { ...tab.info, visible: other === key };
    },
  };

  return {
    manager,
    calls,
    created,
    add,
    remove: (key: string) => tabs.delete(key),
    announce: (event: BrowserTabLifecycleEvent) => {
      for (const listener of Array.from(listeners)) listener(event);
    },
    subscribe: (listener: (event: BrowserTabLifecycleEvent) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    listenerCount: () => listeners.size,
  };
};
