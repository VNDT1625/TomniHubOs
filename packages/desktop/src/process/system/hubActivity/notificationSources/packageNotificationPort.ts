/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Seam between the package capability broker and the notification hub, so the
 * package bridge does not load the hub. The hub registers its handler when it
 * starts; until then package posts are refused.
 */
export type PackageNotificationHandler = (packageId: string, args: unknown) => boolean;

let handler: PackageNotificationHandler | undefined;

export const setPackageNotificationHandler = (next: PackageNotificationHandler | undefined): void => {
  handler = next;
};

export const postPackageNotification: PackageNotificationHandler = (packageId, args) => {
  try {
    return handler?.(packageId, args) ?? false;
  } catch {
    return false;
  }
};
