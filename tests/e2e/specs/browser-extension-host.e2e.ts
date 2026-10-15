/**
 * Browser extension host (T4.2) - e2e skeleton.
 *
 * Pending on a built Manifest V3 fixture extension packaged as a `local-built` package and on the connection IPC
 * being reachable from the helper (T0.8). Unit coverage with a fake loader lives in
 * tests/unit/integrations/browserExtensions and tests/unit/integrations/connections/hosts/extensionHost.test.ts.
 * What only a real Electron can show, and this spec must check once unblocked:
 *  - enabling loads the extension into the `persist:tomny-browser` session, never the default session;
 *  - the extension id equals the id derived from the pinned manifest `key`, and is the same after a package update;
 *  - `chrome.storage.local` written before an update is still there after it;
 *  - after an app restart the enabled extension is loaded again; disabling unloads it.
 */
import { test } from '../fixtures';

test.describe('Browser extension host', () => {
  test.fixme('loads, keeps its id and storage across an update, reloads at startup, unloads on disable', async () => {
    // Arrange: install the fixture package, approve the `extension` connection, then drive the steps above.
  });
});
