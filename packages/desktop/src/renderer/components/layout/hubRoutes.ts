/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/** Routes outside the authenticated Hub shell. */
const SHELL_FREE_ROUTES = ['/login'] as const;

const isShellFreePath = (pathname: string): boolean =>
  SHELL_FREE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));

/**
 * Every authenticated route renders in the centre of the one Hub shell, so no
 * route owns a legacy sidebar any more.
 */
export const isHubPagePath = (pathname: string): boolean => !isShellFreePath(pathname);

/** Routes that share the Hub shell chrome (the titlebar toggles its sidebar). */
export const isGuidPath = (pathname: string): boolean => !isShellFreePath(pathname);
