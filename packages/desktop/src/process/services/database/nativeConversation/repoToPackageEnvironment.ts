/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, safeStorage } from 'electron';
import path from 'node:path';
import type { RepoToPackageChatEnvironment } from '@process/extensions/package-manager/repoPackaging';
import { createLocalKeyStore } from '@process/integrations/connections/wiring/localKeys';

/**
 * Host paths and key protection for `/repotopackage`. Packages and the local signing key live in the
 * app's user-data folder, never inside the repository being packaged. When the operating system
 * keystore is available the private key is stored encrypted; otherwise it is stored in a file only the
 * current user can read.
 */
export const createRepoToPackageEnvironment = (workspaceRoot: string | undefined): RepoToPackageChatEnvironment => {
  const userData = app.getPath('userData');
  return {
    workspaceRoot,
    outputDirectory: path.join(userData, 'tomny-packages'),
    // The package manager reads the same key store, so packaging and verification can never use different keys.
    keyStore: createLocalKeyStore(userData, safeStorage),
  };
};
