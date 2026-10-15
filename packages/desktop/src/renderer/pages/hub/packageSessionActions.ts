/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Requests from the sidebar "Active" section to a package app that is open in the Hub: add a session (the "+"
 * button on its row) or close one (the "x" on a session). The package host that shows the app listens, forwards
 * the request into the package, and the package answers by reporting its new list of sessions. A request nobody
 * is listening for is simply dropped.
 */
export type PackageSessionAction =
  | { packageId: string; kind: 'create' }
  | { packageId: string; kind: 'close'; sessionId: string };

const EVENT_NAME = 'tomni-hub-session-action';

export const emitPackageSessionAction = (action: PackageSessionAction): void => {
  window.dispatchEvent(new CustomEvent<PackageSessionAction>(EVENT_NAME, { detail: action }));
};

const readAction = (value: unknown): PackageSessionAction | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const { packageId, kind, sessionId } = value as Record<string, unknown>;
  if (typeof packageId !== 'string' || packageId.length === 0) return undefined;
  if (kind === 'create') return { packageId, kind };
  if (kind === 'close' && typeof sessionId === 'string' && sessionId.length > 0) return { packageId, kind, sessionId };
  return undefined;
};

/** Returns the unsubscribe function. */
export const onPackageSessionAction = (listener: (action: PackageSessionAction) => void): (() => void) => {
  const handler = (event: Event): void => {
    const action = readAction((event as CustomEvent<unknown>).detail);
    if (action) listener(action);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
};
