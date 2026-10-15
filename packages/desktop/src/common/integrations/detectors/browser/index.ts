/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Detectors of browser extensions and userscripts. Registered in `../index.ts`. */

export { browserExt } from './browserExt';
export {
  CHROME_API_SUPPORT,
  supportOfPermission,
  UNSUPPORTED_CHROME_PERMISSIONS,
  USERSCRIPT_GRANTS,
} from './chromeApiSupport';
