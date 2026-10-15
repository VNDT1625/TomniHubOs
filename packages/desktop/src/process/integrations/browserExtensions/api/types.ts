/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared types of the `chrome.*` shim's Main side: how an API method is defined, what it may see of its caller, the
 * port the extension host uses to attach and detach an extension, and the bus that carries events to workers.
 *
 * A method sees only a {@link CallContext}. The extension id in it was derived from the sender by the router, so a
 * method has no way to act for another extension, and arguments never decide who the caller is.
 */

import type { z } from 'zod';
import type { ApiErrorCode } from '@process/integrations/browserExtensions/api/contract';
import type { ExtensionGrants, GrantRegistry } from '@process/integrations/browserExtensions/api/grants';
import type { SiteAccessConfig } from '@/common/integrations/extensions/siteAccess';

/** A failure with a stable code. Anything else a method throws is reported as `FAILED` without its message. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

export type CallerKind = 'service-worker' | 'frame';

export type CallContext = Readonly<{
  /** Derived by the router from the sender; always a loaded extension. */
  extensionId: string;
  caller: CallerKind;
  grants: ExtensionGrants;
}>;

/** A method with its argument schema folded in; built with {@link defineApiMethod}. */
export type ApiMethod = Readonly<{
  /** `<namespace>.<member>`, for example `permissions.contains`. */
  name: string;
  callers: readonly CallerKind[];
  /** Manifest permissions, any one of which is enough. Empty means the method needs none. */
  requires: readonly string[];
  /** Calls to this method are written to the audit log (design 15.1: cookies, downloads, grants). */
  audit: boolean;
  invoke: (context: CallContext, args: readonly unknown[]) => Promise<unknown>;
}>;

export type ApiMethodDefinition<S extends z.ZodTypeAny> = Readonly<{
  name: string;
  callers: readonly CallerKind[];
  requires?: readonly string[];
  audit?: boolean;
  /** Strict schema of the whole argument list (a tuple); an extra or malformed argument is refused. */
  args: S;
  handle: (context: CallContext, args: z.output<S>) => unknown;
}>;

export const defineApiMethod = <S extends z.ZodTypeAny>(definition: ApiMethodDefinition<S>): ApiMethod => ({
  name: definition.name,
  callers: definition.callers,
  requires: definition.requires ?? [],
  audit: definition.audit ?? false,
  invoke: async (context, args) => {
    const parsed = definition.args.safeParse(args);
    if (!parsed.success) throw new ApiError('INVALID_ARGUMENTS', `Invalid arguments for ${definition.name}.`);
    return definition.handle(context, parsed.data);
  },
});

/** One Main-to-worker event. `payload` is structured-clone data. */
export type ExtensionEvent = Readonly<{
  extensionId: string;
  name: string;
  payload: unknown;
  /** When present the listeners are called with these arguments (Chrome events such as `tabs.onUpdated` have several). */
  args?: readonly unknown[];
}>;

/** What every group receives: the grants (to find who may hear an event) and the bus. */
export type GroupContext = Readonly<{ grants: GrantRegistry; events: ExtensionEventBus }>;

/** The methods of one API group and what to release when the shim is disposed. */
export type ApiGroup = Readonly<{ methods: readonly ApiMethod[]; dispose?: () => void }>;

export type ExtensionEventBus = Readonly<{
  emit: (event: ExtensionEvent) => void;
  /** Returns the unsubscribe function. A listener that throws never breaks the emitter or other listeners. */
  subscribe: (listener: (event: ExtensionEvent) => void) => () => void;
}>;

export const createExtensionEventBus = (): ExtensionEventBus => {
  const listeners = new Set<(event: ExtensionEvent) => void>();
  return {
    emit: (event) => {
      for (const listener of Array.from(listeners)) {
        try {
          listener(event);
        } catch {
          // A delivery failure of one subscriber must not affect the call that raised the event.
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export type ExtensionShimAttachInput = Readonly<{
  /** The stable id the host expects Electron to report. */
  extensionId: string;
  packageId: string;
  connectionId: string;
  /** The parsed source `manifest.json` (as the package ships it, not the rewritten copy). Untrusted until the shim reads it. */
  manifest: unknown;
  /** What the person chose for site access. Absent means the default for the manifest (broad access: on click). */
  siteAccess?: SiteAccessConfig;
}>;

/**
 * What the extension host needs from the shim. `attach` runs before the extension is loaded, so the permissions
 * exist before its service worker reaches the `starting` state; it throws when the manifest cannot be used, and the
 * host then refuses to load. `detach` is safe for an id that was never attached.
 */
export type ExtensionShimPort = Readonly<{
  attach: (input: ExtensionShimAttachInput) => void;
  detach: (extensionId: string) => void;
  /** Applies a new site access choice to an attached extension at once. Unknown ids are ignored. */
  setSiteAccess: (extensionId: string, siteAccess: SiteAccessConfig) => void;
}>;
