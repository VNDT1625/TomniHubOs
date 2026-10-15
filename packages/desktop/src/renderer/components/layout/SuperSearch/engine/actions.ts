/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { emitter, requestBrowserUrl } from '@/renderer/utils/emitter';
import { isSafeAction } from './searchEngine';
import type { SearchAction } from './types';

export type ActionDeps = {
  navigate: (path: string) => void;
  restart: () => void;
  /** True while the Browser app is the current route (its page is mounted and listening). */
  onBrowserRoute: boolean;
};

/**
 * Runs a hit's action. Actions are re-validated here (not only in the engine) because this is the
 * single point where a provider-supplied value becomes navigation or a command.
 */
export const executeAction = (action: SearchAction, deps: ActionDeps): void => {
  if (!isSafeAction(action)) return;
  if (action.kind === 'route') {
    deps.navigate(action.path);
    return;
  }
  if (action.kind === 'url') {
    requestBrowserUrl(action.url);
    if (deps.onBrowserRoute) emitter.emit('browser.openUrl', action.url);
    else deps.navigate('/browser');
    return;
  }
  deps.restart();
};
