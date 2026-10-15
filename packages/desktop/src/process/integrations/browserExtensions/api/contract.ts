/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wire contract of the `chrome.*` shim (docs/platform/repotopackage-design.md sections 12.3 and 12.8).
 *
 * It is imported by both sides: the Main router and the two preload entries. It therefore has no imports and no
 * runtime dependency, so the sandboxed preload bundles stay small and standalone.
 *
 * Identity never travels in this contract: no message carries an extension id. Main derives it from the sender
 * (`ServiceWorkerMain` scope or the sending frame URL), never from a parameter.
 */

/** Request channel. `ipcRenderer.invoke` from frames, `ServiceWorkerMain.ipc.handle` for service workers. */
export const SHIM_CALL_CHANNEL = 'tomny-ext:call';
/** Frame preload asks once, synchronously, whether its page belongs to an extension the host loaded. */
export const SHIM_HELLO_CHANNEL = 'tomny-ext:hello';
/** Main to service worker events (`permissions.onAdded` ...). */
export const SHIM_EVENT_CHANNEL = 'tomny-ext:event';

/** Stable ids so a second registration replaces the first instead of stacking. */
export const SHIM_FRAME_SCRIPT_ID = 'tomny-ext-frame-shim';
export const SHIM_WORKER_SCRIPT_ID = 'tomny-ext-worker-shim';
/** File names of the built preload bundles (see electron.vite.config.ts), next to `out/main`. */
export const SHIM_FRAME_SCRIPT_FILE = 'extensionFrame.js';
export const SHIM_WORKER_SCRIPT_FILE = 'extensionWorker.js';

/** Extension ids are 32 characters from `a` to `p` (a SHA-256 prefix, one nibble per letter). */
export const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

/** Bounds on what one call may carry. */
export const MAX_ENVELOPE_BYTES = 64 * 1024;
export const MAX_ARGUMENTS = 8;
export const MAX_IN_FLIGHT_PER_EXTENSION = 32;

/** Stable error codes returned to the preload (the message is for the extension developer, not the user). */
export type ApiErrorCode =
  | 'INVALID_CALLER'
  | 'INVALID_REQUEST'
  | 'UNKNOWN_METHOD'
  | 'PERMISSION_DENIED'
  | 'INVALID_ARGUMENTS'
  | 'REJECTED'
  /** The API is outside the v1 list of the design, or its host port is not wired. */
  | 'UNSUPPORTED'
  | 'BUSY'
  | 'FAILED';

export type ApiResult =
  | Readonly<{ ok: true; value: unknown }>
  | Readonly<{ ok: false; code: ApiErrorCode; message: string }>;

/** What the preload installs into the page or worker as `chrome.<path>.<method>` and `chrome.<path>.<event>`. */
export type ShimNamespaceSpec = Readonly<{
  /** The `chrome` member path. A dotted path names an object inside another one, such as `storage.sync`. */
  path: string;
  methods: readonly string[];
  events: readonly string[];
  /**
   * Members that replace what Electron already provides. Needed where Electron's own version cannot see Hub state
   * (tabs of the Browser, toolbar state). Every other member only fills a gap.
   */
  replace?: readonly string[];
}>;

/**
 * Namespaces the shim adds. A member the browser already provides is left alone (the shim only fills gaps), unless it
 * is listed in `replace`: those are Electron members that exist but do not work in Tomny. Add a group here and in the
 * router together: a unit test fails when the two disagree.
 */
export const SHIM_NAMESPACES: readonly ShimNamespaceSpec[] = [
  {
    path: 'permissions',
    methods: ['contains', 'getAll', 'request', 'remove'],
    events: ['onAdded', 'onRemoved'],
  },
  {
    path: 'tabs',
    methods: ['create', 'query', 'update', 'remove', 'get'],
    events: ['onCreated', 'onUpdated', 'onRemoved', 'onActivated'],
    replace: ['create', 'query', 'update', 'remove', 'get', 'onCreated', 'onUpdated', 'onRemoved', 'onActivated'],
  },
  {
    path: 'contextMenus',
    methods: ['create', 'update', 'remove', 'removeAll'],
    events: ['onClicked'],
  },
  {
    path: 'action',
    methods: [
      'setTitle',
      'getTitle',
      'setPopup',
      'getPopup',
      'setBadgeText',
      'getBadgeText',
      'setBadgeBackgroundColor',
      'getBadgeBackgroundColor',
      'openPopup',
      'setIcon',
    ],
    events: ['onClicked'],
    replace: [
      'setTitle',
      'getTitle',
      'setPopup',
      'getPopup',
      'setBadgeText',
      'getBadgeText',
      'setBadgeBackgroundColor',
      'getBadgeBackgroundColor',
      'openPopup',
      'setIcon',
      'onClicked',
    ],
  },
  {
    path: 'cookies',
    methods: ['get', 'getAll', 'set', 'remove'],
    events: ['onChanged'],
  },
  {
    path: 'windows',
    methods: ['get', 'getAll', 'getCurrent', 'getLastFocused', 'create', 'update', 'remove'],
    events: ['onFocusChanged'],
  },
  {
    path: 'notifications',
    methods: ['create', 'clear', 'getAll'],
    events: ['onClicked'],
  },
  {
    path: 'webNavigation',
    methods: ['getFrame', 'getAllFrames'],
    events: ['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted'],
  },
  {
    path: 'downloads',
    methods: ['download', 'search', 'cancel'],
    events: ['onCreated', 'onChanged'],
  },
  {
    // Electron exposes these members, but every call fails ("sync is not available"), so they are replaced.
    path: 'storage.sync',
    methods: ['get', 'getKeys', 'set', 'remove', 'clear', 'getBytesInUse'],
    events: [],
    replace: ['get', 'getKeys', 'set', 'remove', 'clear', 'getBytesInUse'],
  },
  {
    path: 'commands',
    methods: ['getAll'],
    events: ['onCommand'],
  },
];

/** Router name of a namespace member. */
export const methodName = (path: string, member: string): string => `${path}.${member}`;

/** Events a service worker may be sent. */
export const SHIM_EVENT_NAMES: readonly string[] = SHIM_NAMESPACES.flatMap((namespace) =>
  namespace.events.map((event) => methodName(namespace.path, event))
);

/**
 * Internal call, not part of `chrome.*`: the worker preload asks which of its own static rulesets to switch on
 * (spike S-3: Electron never enables them). Only a service worker may call it.
 */
export const INTERNAL_DNR_PLAN_METHOD = 'tomny.declarativeNetRequest.staticRulesetPlan';
