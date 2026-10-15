/**
 * Browser extension Chrome API shim (T4.3) - e2e skeleton.
 *
 * Pending on a built Manifest V3 fixture extension packaged as a `local-built` package, on the connection IPC being
 * reachable from the helper (T0.8), and on `out/preload/extensionFrame.js` + `extensionWorker.js` being built. Router,
 * identity, permission and preload-installer behavior is covered by unit tests with fakes in
 * tests/unit/integrations/browserExtensions/api. What only a real Electron can show, and this spec must check once
 * unblocked (fixture: a worker + popup that call each API and report back to a local test server):
 *
 * permissions
 *  - in the service worker and in the popup, `chrome.permissions.contains/getAll` match the approved manifest;
 *  - `request` for an optional permission shows the native question; "Từ chối" resolves false, "Cho phép" resolves
 *    true, fires `onAdded` in the worker, and the grant survives a worker restart;
 *  - `remove` of the granted optional permission fires `onRemoved`; `remove` of a required one rejects.
 *
 * declarativeNetRequest
 *  - an extension whose manifest has an enabled static ruleset blocks the matching request after load although
 *    Electron enabled none (S-3); an extension without the permission blocks nothing;
 *  - two extensions with different `rule_resources` never enable each other's ruleset ids.
 *
 * identity and isolation
 *  - an ordinary web page in the Browser profile has no `chrome.permissions` shim and opens no `tomny-ext:*` channel
 *    (the frame preload leaves at once; check with a page that logs `ipcRenderer` reachability and the globals);
 *  - the Hub window (default session) cannot reach `tomny-ext:call`;
 *  - a web page's own service worker gets no handler.
 *
 * uBlock Origin Lite (Web Store package, T4.9 when available)
 *  - its service worker no longer fails with "Cannot read properties of undefined (reading 'onRemoved')" and its
 *    static rulesets block ads on a fixture page. If it fails on another missing API, record the API name in the
 *    design doc 12.8 and add it to the shim.
 */
import { test } from '../fixtures';

test.describe('Browser extension Chrome API shim', () => {
  test.fixme('permissions: contains, getAll, request, remove and their events', async () => {
    // Arrange: install the fixture package, approve the `extension` connection, open the popup in the Browser profile.
  });

  test.fixme('declarativeNetRequest: static rulesets are enabled per extension and block', async () => {
    // Arrange: two fixture extensions with different rule_resources; load a page that requests the blocked URL.
  });

  test.fixme('web pages and the Hub window get no shim and no channel', async () => {
    // Arrange: a page in the Browser profile and the Hub window; probe globals and IPC reachability.
  });

  test.fixme('uBlock Origin Lite service worker starts and blocks', async () => {
    // Arrange: package uBOL (CRX3, key pinned), enable it, load the fixture page.
  });
});
