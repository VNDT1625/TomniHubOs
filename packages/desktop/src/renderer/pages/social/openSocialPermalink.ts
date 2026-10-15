/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/** Open only known social-network HTTPS permalinks, never untrusted schemes. */
const ALLOWED_HOSTS = [
  'x.com',
  'twitter.com',
  'facebook.com',
  'threads.net',
  'reddit.com',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
] as const;

export function openSocialPermalink(permalink: string): boolean {
  try {
    const url = new URL(permalink);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
      return false;
    }
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
}
