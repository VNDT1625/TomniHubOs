/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Chrome API support table of design section 12.3 (decision D10) and the userscript `GM_*` list of section
 * 12.4, kept as data. The `browser-ext` detector reads it to decide which permissions of a manifest the Hub host can
 * serve; every permission outside the table becomes an `unsupported` entry of the extension connection. Updating the
 * host's coverage means editing this table, not the detector.
 *
 * `native` means Electron 37 already provides the API (measured in spike S-2 on 2026-10-09); `shim` means the host
 * adds it through a preload shim backed by the Hub (design 12.3).
 */

export type ChromeApiStatus = 'native' | 'shim';
export type ChromePermissionSupport = ChromeApiStatus | 'unsupported';

export type ChromeApiRow = Readonly<{
  /** Manifest permissions that grant the APIs of this row; empty when the API needs no permission. */
  permissions: readonly string[];
  apis: readonly string[];
  status: ChromeApiStatus;
  /** Where the host maps the API (Vietnamese, as in the design). */
  hub: string;
}>;

/** Design section 12.3, "Phạm vi v1", plus the APIs measured as already present. */
export const CHROME_API_SUPPORT: readonly ChromeApiRow[] = [
  {
    permissions: ['storage', 'unlimitedStorage'],
    apis: ['storage.local'],
    status: 'native',
    hub: 'Có sẵn trong Electron',
  },
  { permissions: ['alarms'], apis: ['alarms'], status: 'native', hub: 'Có sẵn trong Electron' },
  {
    permissions: ['declarativeNetRequest', 'declarativeNetRequestWithHostAccess', 'declarativeNetRequestFeedback'],
    apis: ['declarativeNetRequest'],
    status: 'native',
    hub: 'Có sẵn trong Electron',
  },
  { permissions: ['scripting'], apis: ['scripting'], status: 'native', hub: 'Có sẵn trong Electron' },
  {
    permissions: ['clipboardWrite', 'clipboardRead', 'geolocation', 'background'],
    apis: [],
    status: 'native',
    hub: 'Quyền web hoặc cờ Chromium, không có API chrome.* nào cần bù; quyền web hỏi người dùng theo origin',
  },
  {
    permissions: ['tabs', 'activeTab'],
    apis: [
      'tabs.create',
      'tabs.update',
      'tabs.remove',
      'tabs.get',
      'tabs.query',
      'tabs.onCreated',
      'tabs.onUpdated',
      'tabs.onRemoved',
      'tabs.onActivated',
      'tabs.sendMessage',
    ],
    status: 'shim',
    hub: 'BrowserViewManager, chỉ tab của hồ sơ duyệt web',
  },
  {
    permissions: [],
    apis: ['windows.getCurrent', 'windows.getAll', 'windows.get', 'windows.create', 'windows.onFocusChanged'],
    status: 'shim',
    hub: 'Một "cửa sổ" ảo là cửa sổ Browser',
  },
  {
    permissions: ['contextMenus'],
    apis: [
      'contextMenus.create',
      'contextMenus.update',
      'contextMenus.remove',
      'contextMenus.removeAll',
      'contextMenus.onClicked',
    ],
    status: 'shim',
    hub: 'Menu chuột phải của tab Browser',
  },
  {
    permissions: ['notifications'],
    apis: ['notifications.create', 'notifications.clear', 'notifications.onClicked'],
    status: 'shim',
    hub: 'Thông báo của Hub (Notification Hub)',
  },
  {
    permissions: ['cookies'],
    apis: ['cookies.get', 'cookies.getAll', 'cookies.set', 'cookies.remove', 'cookies.onChanged'],
    status: 'shim',
    hub: 'Cookie của hồ sơ duyệt web, lọc theo host_permissions',
  },
  {
    permissions: ['webNavigation'],
    apis: [
      'webNavigation.onBeforeNavigate',
      'webNavigation.onCommitted',
      'webNavigation.onDOMContentLoaded',
      'webNavigation.onCompleted',
      'webNavigation.getFrame',
      'webNavigation.getAllFrames',
    ],
    status: 'shim',
    hub: 'Sự kiện webContents của tab',
  },
  {
    permissions: ['downloads'],
    apis: ['downloads.download', 'downloads.onCreated', 'downloads.onChanged', 'downloads.search'],
    status: 'shim',
    hub: 'will-download của hồ sơ, thư mục tải của người dùng',
  },
  {
    permissions: [],
    apis: ['permissions.contains', 'permissions.getAll', 'permissions.request', 'permissions.remove'],
    status: 'shim',
    hub: 'Trạng thái quyền đã duyệt',
  },
  { permissions: [], apis: ['storage.sync'], status: 'shim', hub: 'Bí danh của storage.local' },
  {
    permissions: [],
    apis: ['action.openPopup', 'action.setPopup', 'action.setIcon', 'action.setTitle'],
    status: 'shim',
    hub: 'Nút extension trên thanh Browser',
  },
  { permissions: [], apis: ['commands.getAll'], status: 'shim', hub: 'Danh sách lệnh (phím tắt: đợt sau)' },
];

/** Permissions design 12.3 names as "Chưa làm ở v1", with the reason shown to the user. */
export const UNSUPPORTED_CHROME_PERMISSIONS: Readonly<Record<string, string>> = {
  webRequest: 'chưa chặn được request; dùng declarativeNetRequest',
  webRequestBlocking: 'chưa chặn được request; dùng declarativeNetRequest',
  webRequestAuthProvider: 'chưa chặn được request; dùng declarativeNetRequest',
  history: 'Browser chưa có lịch sử',
  bookmarks: 'Browser chưa có dấu trang',
  identity: 'chưa có API identity',
  'identity.email': 'chưa có API identity',
  sidePanel: 'chưa có side panel',
  offscreen: 'chưa có offscreen document',
  debugger: 'chưa có API debugger',
  nativeMessaging: 'chưa có native messaging',
};

/** Manifest keys (not permissions) that need an API the host lacks, mapped to the entry recorded as `unsupported`. */
export const UNSUPPORTED_MANIFEST_KEYS: Readonly<Record<string, string>> = {
  side_panel: 'sidePanel',
};

const PERMISSION_STATUS: ReadonlyMap<string, ChromeApiStatus> = new Map(
  CHROME_API_SUPPORT.flatMap((row) => row.permissions.map((permission) => [permission, row.status] as const))
);

/** How the host serves a manifest permission; anything the table does not list has no shim and is `unsupported`. */
export const supportOfPermission = (permission: string): ChromePermissionSupport =>
  PERMISSION_STATUS.get(permission) ?? 'unsupported';

/** Why a permission is unsupported: the design's reason when it names one, a generic one otherwise. */
export const unsupportedReason = (permission: string): string =>
  UNSUPPORTED_CHROME_PERMISSIONS[permission] ?? 'chưa có phần bù trong bảng API v1';

/** `GM_*` functions the userscript converter provides in v1 (design section 12.4). */
export const USERSCRIPT_GRANTS: ReadonlySet<string> = new Set([
  'GM_getValue',
  'GM_setValue',
  'GM_deleteValue',
  'GM_listValues',
  'GM_addStyle',
  'GM_xmlhttpRequest',
]);
