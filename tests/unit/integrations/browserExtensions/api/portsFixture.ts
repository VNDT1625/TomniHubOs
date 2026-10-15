import type { PortTab } from '@process/integrations/browserExtensions/api/groups/shared/tabAccess';
import type { TabsPort, TabsPortEvent } from '@process/integrations/browserExtensions/api/groups/browser/tabs';
import type {
  CookieChange,
  CookieFilter,
  CookieSetDetails,
  CookiesPort,
  PortCookie,
} from '@process/integrations/browserExtensions/api/groups/data/cookies';
import type {
  ContextMenuHost,
  ContextMenuRequest,
  ContextMenusPort,
} from '@process/integrations/browserExtensions/api/groups/browser/contextMenus';
import type { ExtensionEvent } from '@process/integrations/browserExtensions/api/types';

export const makeTab = (id: number, url: string, extra: Partial<PortTab> = {}): PortTab => ({
  id,
  windowId: 1,
  index: id,
  url,
  title: `Title ${id}`,
  active: false,
  loading: false,
  audible: false,
  muted: false,
  width: 800,
  height: 600,
  ...extra,
});

export const fakeTabs = (initial: readonly PortTab[]) => {
  let tabs = [...initial];
  const listeners = new Set<(event: TabsPortEvent) => void>();
  const calls: string[] = [];
  let nextId = 100;
  const port: TabsPort = {
    list: () => tabs,
    create: async (input) => {
      calls.push(`create:${input.url ?? ''}:${input.active}`);
      nextId += 1;
      const tab = makeTab(nextId, input.url ?? '', { active: input.active });
      tabs = [...tabs, tab];
      return tab;
    },
    navigate: async (id, url) => {
      calls.push(`navigate:${id}:${url}`);
    },
    activate: (id) => {
      calls.push(`activate:${id}`);
    },
    setMuted: (id, muted) => {
      calls.push(`mute:${id}:${muted}`);
    },
    remove: (id) => {
      calls.push(`remove:${id}`);
      tabs = tabs.filter((tab) => tab.id !== id);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return {
    port,
    calls,
    listenerCount: () => listeners.size,
    emit: (event: TabsPortEvent) => {
      for (const listener of Array.from(listeners)) listener(event);
    },
    setTabs: (next: readonly PortTab[]) => {
      tabs = [...next];
    },
  };
};

export const cookieOf = (extra: Partial<PortCookie> & Pick<PortCookie, 'name' | 'domain'>): PortCookie => ({
  value: 'v',
  hostOnly: true,
  path: '/',
  secure: true,
  httpOnly: false,
  session: true,
  sameSite: 'lax',
  ...extra,
});

export const fakeCookies = (initial: readonly PortCookie[]) => {
  let jar = [...initial];
  const listeners = new Set<(change: CookieChange) => void>();
  const log: string[] = [];
  const port: CookiesPort = {
    get: async (filter: CookieFilter) => {
      log.push(`get:${JSON.stringify(filter)}`);
      const host = filter.url === undefined ? undefined : new URL(filter.url).hostname;
      return jar.filter(
        (cookie) =>
          (filter.name === undefined || cookie.name === filter.name) &&
          (host === undefined || host === cookie.domain.replace(/^\./, '') || host.endsWith(cookie.domain)) &&
          (filter.domain === undefined || cookie.domain.endsWith(filter.domain.replace(/^\./, '')))
      );
    },
    set: async (details: CookieSetDetails) => {
      log.push(`set:${details.name}`);
      jar = [
        ...jar.filter((cookie) => cookie.name !== details.name),
        cookieOf({
          name: details.name,
          value: details.value,
          domain: details.domain ?? new URL(details.url).hostname,
          hostOnly: details.domain === undefined,
          secure: details.url.startsWith('https:'),
        }),
      ];
    },
    remove: async (url, name) => {
      log.push(`remove:${url}:${name}`);
      jar = jar.filter((cookie) => cookie.name !== name);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  return {
    port,
    log,
    emit: (change: CookieChange) => {
      for (const listener of Array.from(listeners)) listener(change);
    },
  };
};

export const fakeMenus = (tabs: readonly PortTab[] = []) => {
  let host: ContextMenuHost | undefined;
  let registered = 0;
  const port: ContextMenusPort = {
    register: (value) => {
      host = value;
      registered += 1;
      return () => {
        host = undefined;
      };
    },
    tab: (id) => tabs.find((tab) => tab.id === id),
  };
  return {
    port,
    registered: () => registered,
    host: () => host as ContextMenuHost,
  };
};

export const pageRequest = (extra: Partial<ContextMenuRequest> = {}): ContextMenuRequest => ({
  tabId: 7,
  pageUrl: 'https://a.example.com/page',
  editable: false,
  contexts: ['page'],
  ...extra,
});

export const eventsOf = (shim: { events: { subscribe: (l: (event: ExtensionEvent) => void) => () => void } }) => {
  const seen: ExtensionEvent[] = [];
  shim.events.subscribe((event) => seen.push(event));
  return seen;
};
