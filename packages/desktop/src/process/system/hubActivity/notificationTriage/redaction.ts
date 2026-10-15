/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Redaction for notification text that leaves the hub: to an agent's model
 * (secrets masked, people kept) or to the opt-in escalation model (secrets and
 * addresses masked, only sender domains kept).
 */

const URL_PATTERN = /\bhttps?:\/\/([^\s/?#<>"']+)[^\s<>"']*/giu;
const EMAIL_PATTERN = /\b[\p{L}\p{N}._%+-]+@([\p{L}\p{N}.-]+\.[\p{L}]{2,})\b/giu;
/** Card, account and phone numbers: long digit runs, possibly grouped. */
const LONG_NUMBER_PATTERN = /(?<![\p{L}\p{N}])\+?\d(?:[\d .-]{6,}\d)(?![\p{L}\p{N}])/gu;
/** One-time codes and PINs. */
const CODE_PATTERN = /(?<![\p{L}\p{N}])\d{4,8}(?![\p{L}\p{N}])/gu;
/** Known credential prefixes and long mixed tokens. */
const KEY_PATTERN = /\b(?:sk|pk|rk|ghp|gho|ghs|github_pat|xox[abpr]|AKIA|AIza|ya29)[-_.A-Za-z0-9]{8,}/gu;
const TOKEN_PATTERN = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/gu;
const PASSWORD_PATTERN = /((?:password|passcode|mật khẩu|mat khau|pwd)\s*[:=]\s*)\S+/giu;

/** Masks secrets (codes, keys, tokens, card/account numbers, link queries); keeps names and addresses. */
export const redactSecrets = (text: string): string =>
  text
    .replace(PASSWORD_PATTERN, '$1[secret]')
    .replace(KEY_PATTERN, '[secret]')
    .replace(TOKEN_PATTERN, '[secret]')
    .replace(URL_PATTERN, (_match, host: string) => `https://${host}/…`)
    .replace(LONG_NUMBER_PATTERN, '[number]')
    .replace(CODE_PATTERN, '[code]');

/** Masks secrets and personal identifiers: mail addresses keep only their domain. */
export const redactForModel = (text: string): string =>
  redactSecrets(text.replace(EMAIL_PATTERN, (_match, domain: string) => `[email@${domain}]`));

/** Mail domain of a sender such as `Name <a@b.com>` or `a@b.com`. */
export const senderDomain = (sender: string | undefined): string | undefined => {
  if (!sender) return undefined;
  const match = /@([\p{L}\p{N}.-]+\.[\p{L}]{2,})/u.exec(sender);
  return match?.[1]?.toLowerCase();
};

/** Lower-case mail address inside a sender, or the trimmed display name. */
export const senderIdentity = (sender: string | undefined): string | undefined => {
  if (!sender) return undefined;
  const address =
    /<([^>]+)>/.exec(sender)?.[1] ?? (/^[^\s@]+@[^\s@]+$/.test(sender.trim()) ? sender.trim() : undefined);
  const identity = (address ?? sender).trim().toLowerCase();
  return identity.length > 0 ? identity.slice(0, 200) : undefined;
};
