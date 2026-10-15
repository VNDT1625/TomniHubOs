/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/** Constrain untrusted model-provided image and source URLs to public HTTPS hosts.
 * This prevents accidental loopback/file URLs and strips private browsing context. */
export const isSafePublicImageUrl = (source: string): boolean => {
  if (source.length > 2048 || !source.startsWith('https://')) return false;
  try {
    const url = new URL(source);
    if (url.username || url.password || url.port || url.hash) return false;
    const hostname = url.hostname.toLowerCase();
    if (
      !hostname ||
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    )
      return false;
    // Literal IPs and IPv6 hosts are not accepted. DNS and remote image hosts
    // remain third-party, so use no-referrer on every image.
    if (/^\[|^[0-9.]+$/.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
};
