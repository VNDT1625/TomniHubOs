/**
 * @license
 * Copyright 2025 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { TomniGatewayAuthConfig } from './types';

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

const tokenMatches = (presented: string, expected: string): boolean =>
  presented.length > 0 && timingSafeEqual(digest(presented), digest(expected));

export const assertValidGatewayAuth = (config: TomniGatewayAuthConfig): void => {
  if (config.sessionTokens.length === 0 || config.sessionTokens.some((token) => token.trim().length < 16)) {
    throw new Error('[TomnyGateway] At least one session token of 16 or more characters is required.');
  }
  for (const origin of config.allowedOrigins) {
    if (origin.includes('*') || new URL(origin).origin !== origin) {
      throw new Error(`[TomnyGateway] Invalid exact origin: ${origin}`);
    }
  }
};

export const isOriginAllowed = (origin: string | undefined, config: TomniGatewayAuthConfig): boolean => {
  if (!origin) return config.allowMissingOrigin === true;
  return config.allowedOrigins.includes(origin);
};

const bearerToken = (headers: IncomingHttpHeaders): string => {
  const value = headers.authorization;
  if (typeof value !== 'string') return '';
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1]?.trim() ?? '';
};

export const isHttpAuthorized = (headers: IncomingHttpHeaders, config: TomniGatewayAuthConfig): boolean => {
  const presented = bearerToken(headers);
  return config.sessionTokens.some((token) => tokenMatches(presented, token));
};

const decodeProtocolToken = (protocol: string): string => {
  const prefix = 'tomni-auth.';
  if (!protocol.startsWith(prefix)) return '';
  try {
    return Buffer.from(protocol.slice(prefix.length), 'base64url').toString('utf8');
  } catch {
    return '';
  }
};

/** Browser WebSocket clients authenticate without URL tokens through Sec-WebSocket-Protocol. */
export const authorizeWebSocketProtocols = (
  header: string | string[] | undefined,
  config: TomniGatewayAuthConfig
): string | undefined => {
  const values = (Array.isArray(header) ? header.join(',') : (header ?? '')).split(',').map((value) => value.trim());
  if (!values.includes('tomni-v1')) return undefined;
  const presented = values.map(decodeProtocolToken).find((value) => value.length > 0) ?? '';
  return config.sessionTokens.some((token) => tokenMatches(presented, token)) ? 'tomni-v1' : undefined;
};
