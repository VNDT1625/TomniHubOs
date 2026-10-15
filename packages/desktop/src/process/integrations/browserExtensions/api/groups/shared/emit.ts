/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Event delivery shared by the API groups (docs/platform/repotopackage-design.md section 12.3). A group never sends
 * an event to "everyone": it names the test an extension must pass (a permission, a host permission, a tab it can
 * see), and only the extensions that pass hear it. Sending to a worker that is not running is the bus's concern.
 */

import type { ExtensionGrants } from '@process/integrations/browserExtensions/api/grants';
import type { GroupContext } from '@process/integrations/browserExtensions/api/types';

/** Sends `name(...args)` to every loaded extension for which `allow` is true. A throwing test counts as no. */
export const broadcast = (
  context: GroupContext,
  name: string,
  args: readonly unknown[],
  allow: (grants: ExtensionGrants) => boolean
): void => {
  for (const extensionId of context.grants.ids()) {
    const grants = context.grants.get(extensionId);
    if (grants === undefined) continue;
    let wanted = false;
    try {
      wanted = allow(grants);
    } catch {
      wanted = false;
    }
    if (wanted) context.events.emit({ extensionId, name, payload: args[0] ?? null, args });
  }
};

/** Sends one event to one extension (a click on its own menu item or toolbar button). */
export const emitTo = (context: GroupContext, extensionId: string, name: string, args: readonly unknown[]): void => {
  if (!context.grants.has(extensionId)) return;
  context.events.emit({ extensionId, name, payload: args[0] ?? null, args });
};
