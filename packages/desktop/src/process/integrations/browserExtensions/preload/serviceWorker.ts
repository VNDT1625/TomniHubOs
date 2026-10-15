/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Entry of the service-worker preload (`out/preload/extensionWorker.js`), registered on the Browser profile session
 * with `registerPreloadScript({ type: 'service-worker' })`. See `bootWorker.ts`.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { bootWorker } from '@/process/integrations/browserExtensions/preload/bootWorker';

bootWorker({ ipcRenderer, contextBridge }).catch((): undefined => undefined);
