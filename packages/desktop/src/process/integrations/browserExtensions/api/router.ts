/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Main-side router of the `chrome.*` shim (docs/platform/repotopackage-design.md sections 12.3 and 15).
 *
 * The order of checks is the security argument, and each step fails closed:
 *
 * 1. Identity from the sender origin ({@link resolveCaller}); a sender that is not a well-formed extension origin,
 *    or an extension the host did not load, is `INVALID_CALLER`. Nothing in the payload is used to pick the extension.
 * 2. A strict envelope: `{ method, args }` and nothing else, bounded in size and argument count.
 * 3. The method must exist and accept this kind of caller (a page cannot call a worker-only method).
 * 4. The extension must hold one of the manifest permissions the method requires.
 * 5. The arguments must satisfy the method's strict schema.
 * 6. At most {@link MAX_IN_FLIGHT_PER_EXTENSION} calls per extension at once.
 *
 * An error that is not an {@link ApiError} is reported as a plain `FAILED`: internal messages (paths, stack frames)
 * never reach the extension. Sensitive methods leave an audit entry with names and outcomes, never with values.
 *
 * Pure: no Electron. The Electron wiring lives in `electronShim.ts`.
 */

import { z } from 'zod';
import {
  MAX_ARGUMENTS,
  MAX_ENVELOPE_BYTES,
  MAX_IN_FLIGHT_PER_EXTENSION,
  type ApiErrorCode,
  type ApiResult,
} from '@process/integrations/browserExtensions/api/contract';
import type { GrantRegistry } from '@process/integrations/browserExtensions/api/grants';
import { resolveCaller, type CallerSource } from '@process/integrations/browserExtensions/api/identity';
import { ApiError, type ApiMethod } from '@process/integrations/browserExtensions/api/types';

const envelopeSchema = z
  .object({
    method: z.string().min(1).max(96),
    args: z.array(z.unknown()).max(MAX_ARGUMENTS),
  })
  .strict();

export type ApiAuditEntry = Readonly<{
  extensionId: string;
  method: string;
  outcome: 'ok' | 'denied' | 'error';
  code?: ApiErrorCode;
}>;

export type ApiRouterDeps = Readonly<{
  grants: GrantRegistry;
  methods: readonly ApiMethod[];
  audit?: (entry: ApiAuditEntry) => void;
}>;

export type ApiRouter = Readonly<{
  handle: (source: CallerSource, envelope: unknown) => Promise<ApiResult>;
  /** Method names, for the consistency test against the preload spec. */
  methodNames: () => readonly string[];
}>;

const fail = (code: ApiErrorCode, message: string): ApiResult => ({ ok: false, code, message });

const envelopeTooLarge = (envelope: unknown): boolean => {
  try {
    const text = JSON.stringify(envelope);
    return text === undefined || text.length > MAX_ENVELOPE_BYTES;
  } catch {
    return true;
  }
};

export const createApiRouter = (deps: ApiRouterDeps): ApiRouter => {
  const byName = new Map<string, ApiMethod>();
  for (const method of deps.methods) {
    if (byName.has(method.name)) throw new Error(`Duplicate extension API method: ${method.name}`);
    byName.set(method.name, method);
  }
  const inFlight = new Map<string, number>();

  const audit = (method: ApiMethod, extensionId: string, outcome: ApiAuditEntry['outcome'], code?: ApiErrorCode) => {
    if (!method.audit) return;
    try {
      deps.audit?.({ extensionId, method: method.name, outcome, ...(code === undefined ? {} : { code }) });
    } catch {
      // Auditing must never change the answer.
    }
  };

  const handle = async (source: CallerSource, envelope: unknown): Promise<ApiResult> => {
    const caller = resolveCaller(source);
    if (caller === undefined) return fail('INVALID_CALLER', 'The caller is not a Tomny browser extension.');
    const grants = deps.grants.get(caller.extensionId);
    if (grants === undefined) return fail('INVALID_CALLER', 'The extension is not loaded.');

    if (envelopeTooLarge(envelope)) return fail('INVALID_REQUEST', 'The request is too large.');
    const parsed = envelopeSchema.safeParse(envelope);
    if (!parsed.success) return fail('INVALID_REQUEST', 'The request is malformed.');

    const method = byName.get(parsed.data.method);
    if (method === undefined) return fail('UNKNOWN_METHOD', 'This extension API is not available in Tomny.');
    if (!method.callers.includes(caller.kind)) {
      audit(method, caller.extensionId, 'denied', 'INVALID_CALLER');
      return fail('INVALID_CALLER', 'This extension API cannot be called from here.');
    }
    if (method.requires.length > 0 && !method.requires.some((name) => grants.hasPermission(name))) {
      audit(method, caller.extensionId, 'denied', 'PERMISSION_DENIED');
      return fail('PERMISSION_DENIED', `The extension does not have the "${method.requires[0]}" permission.`);
    }

    const running = inFlight.get(caller.extensionId) ?? 0;
    if (running >= MAX_IN_FLIGHT_PER_EXTENSION) return fail('BUSY', 'Too many extension API calls at once.');
    inFlight.set(caller.extensionId, running + 1);
    try {
      const value = await method.invoke(
        { extensionId: caller.extensionId, caller: caller.kind, grants },
        parsed.data.args
      );
      audit(method, caller.extensionId, 'ok');
      return { ok: true, value: value === undefined ? null : value };
    } catch (error) {
      if (error instanceof ApiError) {
        audit(method, caller.extensionId, 'denied', error.code);
        return fail(error.code, error.message);
      }
      audit(method, caller.extensionId, 'error', 'FAILED');
      return fail('FAILED', 'The extension API call failed.');
    } finally {
      const left = (inFlight.get(caller.extensionId) ?? 1) - 1;
      if (left <= 0) inFlight.delete(caller.extensionId);
      else inFlight.set(caller.extensionId, left);
    }
  };

  return { handle, methodNames: () => [...byName.keys()] };
};
