/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `chrome.permissions` (docs/platform/repotopackage-design.md section 12.3): `contains`, `getAll`, `request`,
 * `remove`, and the `onAdded` / `onRemoved` events.
 *
 * The extension's own grants are the only state. `request` can only ask for what the manifest declared as optional
 * (or already requires), and it needs a yes from the person through {@link PermissionPromptPort}; with no prompt
 * the answer is no. `remove` can only take back what was granted later: a manifest permission is refused. Nothing
 * here reads an id from the arguments; the caller is the extension the router resolved from the sender origin.
 *
 * Gap this fills: uBlock Origin Lite's service worker registers `permissions.onRemoved`, which Electron 37 does not
 * provide (spike S-6). The namespace has no manifest permission of its own, so every extension may call it.
 */

import { z } from 'zod';
import { isPermissionName, type PermissionSet } from '@process/integrations/browserExtensions/api/grants';
import { parseMatchPattern } from '@process/integrations/browserExtensions/api/matchPattern';
import {
  ApiError,
  defineApiMethod,
  type ApiMethod,
  type ExtensionEventBus,
} from '@process/integrations/browserExtensions/api/types';

const MAX_ITEMS = 50;

/** What the prompt shows: the extension, and only the items that are not granted yet. */
export type PermissionPromptRequest = Readonly<{
  extensionId: string;
  extensionName: string;
  permissions: readonly string[];
  origins: readonly string[];
}>;

/** Asks the person. Resolves true only for an explicit yes; a rejection or a close counts as no. */
export type PermissionPromptPort = Readonly<{ ask: (request: PermissionPromptRequest) => Promise<boolean> }>;

export const denyAllPrompt: PermissionPromptPort = { ask: async () => false };

const detailsSchema = z
  .object({
    permissions: z.array(z.string().refine(isPermissionName)).max(MAX_ITEMS).optional(),
    origins: z
      .array(z.string().refine((value) => parseMatchPattern(value) !== undefined))
      .max(MAX_ITEMS)
      .optional(),
  })
  .strict();

const normalize = (details: z.output<typeof detailsSchema>): PermissionSet => ({
  permissions: [...new Set(details.permissions ?? [])],
  origins: [...new Set(details.origins ?? [])],
});

const isEmpty = (set: PermissionSet): boolean => set.permissions.length === 0 && set.origins.length === 0;

export type PermissionsApiDeps = Readonly<{ prompt: PermissionPromptPort; events: ExtensionEventBus }>;

export const createPermissionsApi = (deps: PermissionsApiDeps): readonly ApiMethod[] => {
  // One prompt per extension at a time: a page that calls `request` in a loop cannot stack dialogs.
  const asking = new Set<string>();
  const both = ['service-worker', 'frame'] as const;

  return [
    defineApiMethod({
      name: 'permissions.contains',
      callers: both,
      args: z.tuple([detailsSchema]),
      handle: (context, [details]) => context.grants.contains(normalize(details)),
    }),
    defineApiMethod({
      name: 'permissions.getAll',
      callers: both,
      args: z.tuple([]),
      handle: (context) => {
        const granted = context.grants.granted();
        return { permissions: [...granted.permissions], origins: [...granted.origins] };
      },
    }),
    defineApiMethod({
      name: 'permissions.request',
      callers: both,
      audit: true,
      args: z.tuple([detailsSchema]),
      handle: async (context, [details]) => {
        const wanted = normalize(details);
        if (!context.grants.isDeclared(wanted)) {
          throw new ApiError('REJECTED', 'Only permissions specified in the extension manifest can be requested.');
        }
        const absent = context.grants.missing(wanted);
        if (isEmpty(absent)) return true;
        if (asking.has(context.extensionId)) throw new ApiError('BUSY', 'A permission request is already open.');
        asking.add(context.extensionId);
        let allowed = false;
        try {
          allowed = await deps.prompt.ask({
            extensionId: context.extensionId,
            extensionName: context.grants.name,
            permissions: absent.permissions,
            origins: absent.origins,
          });
        } catch {
          allowed = false;
        } finally {
          asking.delete(context.extensionId);
        }
        if (!allowed) return false;
        const added = context.grants.grantOptional(absent);
        if (isEmpty(added)) return false;
        deps.events.emit({
          extensionId: context.extensionId,
          name: 'permissions.onAdded',
          payload: { permissions: [...added.permissions], origins: [...added.origins] },
        });
        return true;
      },
    }),
    defineApiMethod({
      name: 'permissions.remove',
      callers: both,
      audit: true,
      args: z.tuple([detailsSchema]),
      handle: (context, [details]) => {
        const outcome = context.grants.revokeOptional(normalize(details));
        if (outcome.kind === 'required') {
          throw new ApiError('REJECTED', 'You cannot remove required permissions.');
        }
        if (outcome.kind === 'not-held') return false;
        deps.events.emit({
          extensionId: context.extensionId,
          name: 'permissions.onRemoved',
          payload: { permissions: [...outcome.removed.permissions], origins: [...outcome.removed.origins] },
        });
        return true;
      },
    }),
  ];
};
