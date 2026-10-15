/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  NotificationCategory,
  NotificationClassifier,
  NotificationLevel,
  NotificationRules,
  NotificationSourceKind,
} from '@/common/types/platform/notificationHub';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_LEVELS } from '@/common/types/platform/notificationHub';
import type { LayaPredictor, LayaQuestion } from '@process/services/security/layaSemanticEgressModel';
import type { SourceSignals } from '../notificationSources/sourceAdapter';

export type ClassifierInput = {
  source: NotificationSourceKind;
  sender?: string;
  title: string;
  body: string;
  /** Level the source itself proposes (Tomny events know what they mean). */
  hint?: { level: NotificationLevel; category: NotificationCategory; reason: string };
  /** Free ranking signals the transport already has (Gmail importance and tabs). */
  signals?: SourceSignals;
  /** A package suggested its post is important (at most P1). */
  packageImportant?: boolean;
};

export type Classification = {
  level: NotificationLevel;
  category: NotificationCategory;
  classifiedBy: NotificationClassifier;
  reason: string;
  /** Rule outcomes the model and learned reputation must not override. */
  final?: boolean;
  confidence?: number;
};

const MIN_LAYA_CONFIDENCE = 0.55;
const LAYA_DEADLINE_MS = 1_500;
const MAX_MODEL_TEXT = 1_200;

const OTP =
  /(\botp\b|\b2fa\b|one[- ]time (pass)?code|verification code|security code|mã (xác (thực|nhận|minh)|otp)|mật khẩu một lần)/iu;
const URGENT =
  /(\burgent\b|\basap\b|\bimmediately\b|\bcritical\b|\boutage\b|is down|\bincident\b|\bemergency\b|gấp|khẩn|ngay bây giờ|ngay lập tức|sập|cảnh báo)/iu;
const SECURITY = /(sign[- ]in attempt|new (login|sign[- ]in)|password (reset|changed)|đăng nhập mới|đổi mật khẩu)/iu;
const FINANCE =
  /(\binvoice\b|\breceipt\b|\bpayment\b|\brefund\b|\bstatement\b|hóa đơn|thanh toán|chuyển khoản|chuyển tiền|sao kê|biên lai|hoàn tiền)/iu;
const PROMOTION =
  /(\bunsubscribe\b|\bnewsletter\b|\bsale\b|% off|\bdiscount\b|\bcoupon\b|\bvoucher\b|\bpromo(tion)?\b|giảm giá|khuyến mãi|ưu đãi|hủy đăng ký)/iu;
const SOCIAL =
  /(\bliked\b|\bcommented\b|\bmentioned\b|\btagged\b|friend request|\bfollowed\b|bình luận|nhắc đến|gắn thẻ|lời mời kết bạn|đã thích)/iu;
const BULK_SENDER = /(no[-_.]?reply|newsletter|marketing|promo)@/iu;

const matchesSender = (sender: string | undefined, patterns: readonly string[]): boolean => {
  if (!sender) return false;
  const value = sender.toLowerCase();
  return patterns.some((pattern) => {
    const needle = pattern.trim().toLowerCase();
    return needle.length > 0 && value.includes(needle);
  });
};

const containsKeyword = (text: string, keywords: readonly string[]): boolean => {
  const value = text.toLowerCase();
  return keywords.some((keyword) => keyword.trim().length > 0 && value.includes(keyword.trim().toLowerCase()));
};

type RuleResult = Omit<Classification, 'classifiedBy'> & { final: boolean };

/**
 * Deterministic ranking. `final` results (the user's own lists, one-time codes,
 * security alerts and Tomny's own events) are never overridden by the model.
 */
export const classifyByRules = (input: ClassifierInput, rules: NotificationRules): RuleResult => {
  const text = `${input.title}\n${input.body}`;
  // Desktop chat toasts and page notifications put the person's name first, so the lists match it there.
  const who = input.sender ?? (input.source === 'os' || input.source === 'web' ? input.title : undefined);
  if (matchesSender(who, rules.mutedSenders)) {
    return { level: 'P3', category: 'other', reason: 'muted-sender', final: true };
  }
  if (input.hint) return { ...input.hint, final: true };
  if (matchesSender(who, rules.vipSenders)) {
    return { level: 'P0', category: 'work', reason: 'vip-sender', final: true };
  }
  if (OTP.test(text)) return { level: 'P0', category: 'security', reason: 'otp', final: true };
  if (SECURITY.test(text)) return { level: 'P0', category: 'security', reason: 'security-alert', final: true };
  if (containsKeyword(text, rules.urgentKeywords) || URGENT.test(text)) {
    return { level: 'P0', category: 'work', reason: 'urgent-keyword', final: false };
  }
  const mailCategory = input.signals?.mailCategory;
  if (mailCategory === 'promotions' || PROMOTION.test(text) || BULK_SENDER.test(input.sender ?? '')) {
    return { level: 'P3', category: 'promotion', reason: 'promotion', final: false };
  }
  if (FINANCE.test(text)) return { level: 'P1', category: 'finance', reason: 'finance', final: false };
  if (input.signals?.important) return { level: 'P1', category: 'personal', reason: 'mail-important', final: false };
  if (mailCategory === 'social' || mailCategory === 'forums') {
    return { level: 'P2', category: 'social', reason: 'mail-social', final: false };
  }
  if (mailCategory === 'updates') return { level: 'P2', category: 'other', reason: 'mail-updates', final: false };
  if (input.source === 'app') {
    return input.packageImportant
      ? { level: 'P1', category: 'other', reason: 'package-important', final: false }
      : { level: 'P2', category: 'other', reason: 'package-app', final: false };
  }
  if (SOCIAL.test(text)) return { level: 'P2', category: 'social', reason: 'social', final: false };
  if (input.source === 'web') return { level: 'P2', category: 'social', reason: 'web-notification', final: false };
  if (input.source === 'os') return { level: 'P2', category: 'personal', reason: 'os-toast', final: false };
  if (input.source === 'youtube') return { level: 'P2', category: 'social', reason: 'youtube', final: false };
  if (input.source === 'feed') return { level: 'P2', category: 'other', reason: 'feed', final: false };
  if (input.source === 'email') return { level: 'P1', category: 'personal', reason: 'direct-mail', final: false };
  return { level: 'P2', category: 'other', reason: 'default', final: false };
};

const LEVEL_CRITERIA: Record<NotificationLevel, string> = {
  P0: 'urgent: a person needs an answer now, an outage or a deadline today, money or account security at risk',
  P1: 'important today: a direct request, a reply, a meeting, work progress, a bill',
  P2: 'informational: group chatter, social updates, subscribed newsletters, routine reports',
  P3: 'noise: advertising, promotions, spam, automated marketing',
};

const CATEGORY_CRITERIA: Record<NotificationCategory, string> = {
  work: 'work, colleagues, customers or projects',
  personal: 'friends, family or personal matters',
  finance: 'banks, bills, payments or money',
  security: 'logins, passwords, verification codes or account safety',
  promotion: 'ads, sales, discounts or marketing',
  social: 'social network activity such as likes, comments or friend requests',
  system: 'software, servers, builds or automated system reports',
  other: 'anything else',
};

const LAYA_QUESTIONS: Readonly<Record<string, LayaQuestion>> = {
  priority: {
    type: 'choice',
    instructions: 'How urgently should the person see this notification?',
    criteria: LEVEL_CRITERIA,
  },
  category: {
    type: 'choice',
    instructions: 'What kind of notification is this?',
    criteria: CATEGORY_CRITERIA,
  },
};

const isLevel = (value: string): value is NotificationLevel =>
  (NOTIFICATION_LEVELS as readonly string[]).includes(value);
const isCategory = (value: string): value is NotificationCategory =>
  (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);

const choiceOf = (answer: unknown): { choice: string; confidence: number } | undefined => {
  if (!answer || typeof answer !== 'object') return undefined;
  const { choice, confidence } = answer as { choice?: unknown; confidence?: unknown };
  return typeof choice === 'string' && typeof confidence === 'number' ? { choice, confidence } : undefined;
};

export type NotificationClassifierDeps = {
  /** Returns a predictor only when the local model is already running; classification never starts it. */
  laya?: () => LayaPredictor | undefined;
};

export type NotificationClassifierFn = (input: ClassifierInput, rules: NotificationRules) => Promise<Classification>;

/** Ranks one notification. The text stays on this machine: Laya runs locally and nothing is sent elsewhere. */
export const createNotificationClassifier = (deps: NotificationClassifierDeps = {}): NotificationClassifierFn => {
  return async (input, rules) => {
    const ruled = classifyByRules(input, rules);
    const fallback: Classification = {
      level: ruled.level,
      category: ruled.category,
      reason: ruled.reason,
      classifiedBy: 'rules',
      final: ruled.final,
    };
    if (ruled.final || !rules.useLaya) return fallback;
    const predictor = deps.laya?.();
    if (!predictor) return fallback;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LAYA_DEADLINE_MS);
    try {
      const sender = input.sender ? `From: ${input.sender}\n` : '';
      const body = `${sender}Subject: ${input.title}\n${input.body}`.slice(0, MAX_MODEL_TEXT);
      const result = await predictor({ body }, LAYA_QUESTIONS, controller.signal);
      const priority = choiceOf(result.answers.priority);
      const category = choiceOf(result.answers.category);
      if (!priority || !isLevel(priority.choice) || priority.confidence < MIN_LAYA_CONFIDENCE) return fallback;
      return {
        level: priority.choice,
        category:
          category && isCategory(category.choice) && category.confidence >= MIN_LAYA_CONFIDENCE
            ? category.choice
            : ruled.category,
        reason: 'laya',
        classifiedBy: 'laya',
        confidence: Math.round(priority.confidence * 100) / 100,
      };
    } catch {
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  };
};
