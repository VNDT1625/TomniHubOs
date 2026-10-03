/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import './adapter/bridgeErrorWrapper';
export * as ipcBridge from './adapter/ipcBridge';
export { conversation } from './adapter/ipcBridge';
export type {
  TomnyAgenticContextBranch,
  TomnyAgenticContextResult,
  TomnyAgenticContextSnapshot,
} from './adapter/ipcBridge';
export * from './types/pipeline';
