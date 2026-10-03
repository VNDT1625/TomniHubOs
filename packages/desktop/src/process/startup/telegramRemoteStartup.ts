/**
 * Tomny-native remote startup. The tunnel targets the native gateway and never
 * depends on the legacy core, globalThis.__backendPort, or a legacy /api route.
 */

import { randomBytes } from 'node:crypto';
import {
  configureRegisteredTomniRemoteGateway,
  startRegisteredTomniRemoteGateway,
  stopRegisteredTomniRemoteGateway,
} from '@process/services/remoteGateway/registry';
import { startTunnel, stopTunnel, type TunnelResult } from '@process/services/remoteGateway/cloudflareTunnel';

const TUNNEL_KEY = 'telegram-remote';
const SECRET_ENV = 'TOMNI_TELEGRAM_REMOTE_SECRET';
const LEGACY_SECRET_ENV = 'TOMNY_TELEGRAM_REMOTE_SECRET';
let startPromise: Promise<TunnelResult> | undefined;
let activePublicUrl: string | undefined;
let appLanguage = 'en-US';

export type TelegramRemoteTunnelResult = TunnelResult | { ok: false; reason: 'external-authority-required' };

/** Returns the per-process bearer used by remote clients and the local gateway. */
export function prepareTelegramRemoteSecret(): string {
  const existing = process.env[SECRET_ENV]?.trim() || process.env[LEGACY_SECRET_ENV]?.trim();
  if (existing) {
    process.env[SECRET_ENV] = existing;
    return existing;
  }
  const secret = randomBytes(32).toString('hex');
  process.env[SECRET_ENV] = secret;
  return secret;
}

/**
 * Starts the Tomny gateway and exposes it through the quick tunnel only after a
 * Main-owned governed authority admits public egress. This gate precedes secret
 * creation, gateway startup, and child-process tunnel spawn.
 */
export async function startTelegramRemoteTunnel(
  language = 'en-US',
  isExternalAuthorityGranted?: () => boolean
): Promise<TelegramRemoteTunnelResult> {
  if (isExternalAuthorityGranted?.() !== true) return { ok: false, reason: 'external-authority-required' };
  appLanguage = language;
  const gateway = await startRegisteredTomniRemoteGateway({
    secret: prepareTelegramRemoteSecret(),
    language: appLanguage,
  });
  if (activePublicUrl) {
    gateway.configure({ publicUrl: activePublicUrl, language: appLanguage });
    return { ok: true, url: activePublicUrl };
  }
  startPromise ??= startTunnel(TUNNEL_KEY, gateway.localUrl).then((result) => {
    if (result.ok) {
      activePublicUrl = result.url;
      gateway.configure({ publicUrl: result.url, language: appLanguage });
    }
    return result;
  });
  const result = await startPromise;
  if (!result.ok) startPromise = undefined;
  return result;
}

/** Keeps native remote clients aligned with the app language without an HTTP round-trip. */
export async function syncTelegramRemoteLanguage(language: string): Promise<boolean> {
  appLanguage = language;
  return configureRegisteredTomniRemoteGateway({ language });
}

export function stopTelegramRemoteTunnel(): void {
  stopTunnel(TUNNEL_KEY);
  startPromise = undefined;
  activePublicUrl = undefined;
  void stopRegisteredTomniRemoteGateway();
}
