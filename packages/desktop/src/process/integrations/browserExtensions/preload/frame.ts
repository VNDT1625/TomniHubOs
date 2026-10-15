/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Entry of the frame preload (`out/preload/extensionFrame.js`), registered on the Browser profile session with
 * `registerPreloadScript({ type: 'frame' })`. It runs in every frame of that session; `bootFrame` leaves at once
 * unless the page is a `chrome-extension:` page of a loaded extension. See `bootFrame.ts`.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { bootFrame } from '@/process/integrations/browserExtensions/preload/bootFrame';

bootFrame({ protocol: location.protocol, ipcRenderer, contextBridge });
