import type {
  AccountClientContract,
  AccountListener,
  AccountPlanId,
  AccountResult,
  AccountSnapshot,
  AccountStorage,
  LoginInput,
  OrganizationMember,
  ProfileInput,
  RegisterInput,
  SyncPreferences,
} from '../types';
import { createDemoState, createEmptyState, type InternalAccountState } from './seed';
import {
  demoPasswordHash,
  getPasswordStrength,
  initialsFromName,
  isValidEmail,
  normalizeEmail,
  slugifyOrganization,
} from './validation';

const STORAGE_KEY = 'tomni-account-kit.prototype.v1';
const LOCKOUT_MS = 30_000;
const MAX_FAILED_ATTEMPTS = 5;

const clone = <T>(value: T): T => structuredClone(value);
const id = (prefix: string): string => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
const now = (): number => Date.now();

export class MemoryAccountStorage implements AccountStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

export const createBrowserAccountStorage = (): AccountStorage => ({
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
});

export class MockAccountClient implements AccountClientContract {
  private state: InternalAccountState;
  private readonly listeners = new Set<AccountListener>();

  constructor(private readonly storage: AccountStorage = new MemoryAccountStorage()) {
    this.state = this.read();
  }

  snapshot(): AccountSnapshot {
    const {
      credentialHash: _credentialHash,
      verificationCode: _verificationCode,
      resetToken: _resetToken,
      failedAttempts: _failedAttempts,
      ...snapshot
    } = this.state;
    return clone(snapshot);
  }

  subscribe(listener: AccountListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  async register(input: RegisterInput): Promise<AccountResult<{ verificationCode: string }>> {
    const email = normalizeEmail(input.email);
    if (!isValidEmail(email)) return { ok: false, code: 'INVALID_EMAIL' };
    if (!getPasswordStrength(input.password).valid) return { ok: false, code: 'WEAK_PASSWORD' };
    if (this.state.user?.email === email) return { ok: false, code: 'EMAIL_EXISTS' };
    const displayName = input.displayName.trim();
    if (displayName.length < 2) return { ok: false, code: 'INVALID_INPUT' };

    const verificationCode = '246810';
    this.state = {
      ...createEmptyState(),
      authStatus: 'pendingVerification',
      user: {
        id: id('usr'),
        email,
        displayName,
        avatarInitials: initialsFromName(displayName),
        emailVerified: false,
        locale: input.locale ?? 'vi-VN',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: now(),
      },
      credentialHash: demoPasswordHash(input.password),
      verificationCode,
      audit: [this.audit('account.created', 'Account registration created')],
    };
    this.commit();
    return { ok: true, value: { verificationCode } };
  }

  async verifyEmail(code: string): Promise<AccountResult> {
    if (!this.state.user || this.state.authStatus !== 'pendingVerification') {
      return { ok: false, code: 'NOT_FOUND' };
    }
    if (code.trim() !== this.state.verificationCode) {
      return { ok: false, code: 'INVALID_VERIFICATION_CODE' };
    }
    this.state.user.emailVerified = true;
    this.state.authStatus = 'signedOut';
    this.state.verificationCode = undefined;
    this.state.audit.unshift(this.audit('email.verified', 'Email verified'));
    this.commit();
    return { ok: true, value: undefined };
  }

  async login(input: LoginInput): Promise<AccountResult> {
    if (this.state.lockoutUntil && this.state.lockoutUntil > now()) {
      return { ok: false, code: 'ACCOUNT_LOCKED', retryAt: this.state.lockoutUntil };
    }

    const valid =
      this.state.user?.email === normalizeEmail(input.email) &&
      this.state.credentialHash === demoPasswordHash(input.password);

    if (!valid) {
      this.state.failedAttempts += 1;
      if (this.state.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        this.state.lockoutUntil = now() + LOCKOUT_MS;
        this.state.failedAttempts = 0;
      }
      this.commit();
      return this.state.lockoutUntil
        ? { ok: false, code: 'ACCOUNT_LOCKED', retryAt: this.state.lockoutUntil }
        : { ok: false, code: 'INVALID_CREDENTIALS' };
    }

    if (!this.state.user?.emailVerified) return { ok: false, code: 'EMAIL_NOT_VERIFIED' };

    const deviceId = id('dev');
    const sessionId = id('ses');
    this.state.failedAttempts = 0;
    this.state.lockoutUntil = undefined;
    this.state.authStatus = 'signedIn';
    this.state.currentSessionId = sessionId;
    this.state.devices.unshift({
      id: deviceId,
      name: 'Thiết bị hiện tại',
      platform: 'Standalone browser prototype',
      trusted: input.remember,
      firstSeenAt: now(),
      lastSeenAt: now(),
    });
    this.state.sessions = this.state.sessions.map((session) => ({ ...session, current: false }));
    this.state.sessions.unshift({
      id: sessionId,
      deviceId,
      label: 'Tomni Account Preview',
      platform: 'Browser',
      location: 'Local prototype',
      ipAddress: '127.0.0.1',
      createdAt: now(),
      lastActiveAt: now(),
      expiresAt: now() + (input.remember ? 30 : 1) * 86_400_000,
      current: true,
    });
    this.state.audit.unshift(this.audit('session.created', 'New sign-in session'));
    this.commit();
    return { ok: true, value: undefined };
  }

  async logout(): Promise<void> {
    const currentId = this.state.currentSessionId;
    this.state.sessions = this.state.sessions.filter((session) => session.id !== currentId);
    this.state.authStatus = 'signedOut';
    this.state.currentSessionId = undefined;
    this.commit();
  }

  async requestPasswordReset(email: string): Promise<AccountResult<{ resetToken: string }>> {
    if (this.state.user?.email !== normalizeEmail(email)) return { ok: false, code: 'NOT_FOUND' };
    const resetToken = 'RESET-2468';
    this.state.resetToken = resetToken;
    this.commit();
    return { ok: true, value: { resetToken } };
  }

  async resetPassword(token: string, newPassword: string): Promise<AccountResult> {
    if (token.trim() !== this.state.resetToken) return { ok: false, code: 'INVALID_RESET_TOKEN' };
    if (!getPasswordStrength(newPassword).valid) return { ok: false, code: 'WEAK_PASSWORD' };
    this.state.credentialHash = demoPasswordHash(newPassword);
    this.state.resetToken = undefined;
    this.state.sessions = [];
    this.state.currentSessionId = undefined;
    this.state.authStatus = 'signedOut';
    this.state.audit.unshift(this.audit('password.changed', 'Password reset completed'));
    this.commit();
    return { ok: true, value: undefined };
  }

  async changePassword(currentPassword: string, nextPassword: string): Promise<AccountResult> {
    if (this.state.authStatus !== 'signedIn') return { ok: false, code: 'NOT_AUTHENTICATED' };
    if (this.state.credentialHash !== demoPasswordHash(currentPassword)) {
      return { ok: false, code: 'INVALID_CREDENTIALS' };
    }
    if (!getPasswordStrength(nextPassword).valid) return { ok: false, code: 'WEAK_PASSWORD' };
    this.state.credentialHash = demoPasswordHash(nextPassword);
    this.state.sessions = this.state.sessions.filter((session) => session.current);
    this.state.audit.unshift(this.audit('password.changed', 'Password changed'));
    this.commit();
    return { ok: true, value: undefined };
  }

  async updateProfile(input: ProfileInput): Promise<AccountResult> {
    if (!this.state.user) return { ok: false, code: 'NOT_AUTHENTICATED' };
    const displayName = input.displayName.trim();
    if (displayName.length < 2 || input.timezone.trim().length < 2) {
      return { ok: false, code: 'INVALID_INPUT' };
    }
    this.state.user = {
      ...this.state.user,
      displayName,
      avatarInitials: initialsFromName(displayName),
      locale: input.locale,
      timezone: input.timezone.trim(),
    };
    this.state.audit.unshift(this.audit('profile.updated', 'Profile updated'));
    this.commit();
    return { ok: true, value: undefined };
  }

  async revokeSession(sessionId: string): Promise<AccountResult> {
    const session = this.state.sessions.find((item) => item.id === sessionId);
    if (!session) return { ok: false, code: 'NOT_FOUND' };
    this.state.sessions = this.state.sessions.filter((item) => item.id !== sessionId);
    this.state.audit.unshift(this.audit('session.revoked', `Session revoked: ${session.label}`));
    if (session.current) {
      this.state.authStatus = 'signedOut';
      this.state.currentSessionId = undefined;
    }
    this.commit();
    return { ok: true, value: undefined };
  }

  async renameDevice(deviceId: string, name: string): Promise<AccountResult> {
    const device = this.state.devices.find((item) => item.id === deviceId);
    if (!device) return { ok: false, code: 'NOT_FOUND' };
    const normalized = name.trim();
    if (normalized.length < 2) return { ok: false, code: 'INVALID_INPUT' };
    device.name = normalized;
    this.commit();
    return { ok: true, value: undefined };
  }

  async revokeDevice(deviceId: string): Promise<AccountResult> {
    const device = this.state.devices.find((item) => item.id === deviceId);
    if (!device) return { ok: false, code: 'NOT_FOUND' };
    device.revokedAt = now();
    device.trusted = false;
    this.state.sessions = this.state.sessions.filter((session) => session.deviceId !== deviceId);
    this.state.audit.unshift(this.audit('device.revoked', `Device revoked: ${device.name}`));
    if (!this.state.sessions.some((session) => session.current)) {
      this.state.authStatus = 'signedOut';
      this.state.currentSessionId = undefined;
    }
    this.commit();
    return { ok: true, value: undefined };
  }

  async updateSync(preferences: SyncPreferences): Promise<AccountResult> {
    if (!this.state.user) return { ok: false, code: 'NOT_AUTHENTICATED' };
    this.state.sync = { ...preferences, sourceCode: false };
    this.state.audit.unshift(this.audit('sync.updated', 'Sync preferences updated'));
    this.commit();
    return { ok: true, value: undefined };
  }

  async changePlan(planId: AccountPlanId): Promise<AccountResult> {
    if (!this.state.user) return { ok: false, code: 'NOT_AUTHENTICATED' };
    const plan = {
      local: { creditsLimit: 0, seats: 1 },
      free: { creditsLimit: 1000, seats: 1 },
      pro: { creditsLimit: 10000, seats: 1 },
      team: { creditsLimit: 50000, seats: 5 },
    }[planId];
    this.state.subscription = {
      planId,
      status: 'active',
      renewsAt: planId === 'local' ? undefined : now() + 30 * 86_400_000,
      seats: plan.seats,
      creditsLimit: plan.creditsLimit,
      creditsRemaining: plan.creditsLimit,
    };
    this.state.audit.unshift(this.audit('subscription.changed', `Plan changed: ${planId}`));
    this.commit();
    return { ok: true, value: undefined };
  }

  async createOrganization(name: string): Promise<AccountResult> {
    if (!this.state.user) return { ok: false, code: 'NOT_AUTHENTICATED' };
    const normalized = name.trim();
    const slug = slugifyOrganization(normalized);
    if (normalized.length < 2 || !slug) return { ok: false, code: 'INVALID_INPUT' };
    this.state.organization = {
      id: id('org'),
      name: normalized,
      slug,
      members: [
        {
          id: id('mem'),
          email: this.state.user.email,
          displayName: this.state.user.displayName,
          role: 'owner',
          status: 'active',
        },
      ],
    };
    this.state.audit.unshift(this.audit('organization.updated', 'Organization created'));
    this.commit();
    return { ok: true, value: undefined };
  }

  async inviteOrganizationMember(email: string, role: OrganizationMember['role']): Promise<AccountResult> {
    if (!this.state.organization) return { ok: false, code: 'NOT_FOUND' };
    const normalized = normalizeEmail(email);
    if (!isValidEmail(normalized)) return { ok: false, code: 'INVALID_EMAIL' };
    if (this.state.organization.members.some((member) => member.email === normalized)) {
      return { ok: false, code: 'EMAIL_EXISTS' };
    }
    this.state.organization.members.push({
      id: id('mem'),
      email: normalized,
      displayName: normalized.split('@')[0] ?? normalized,
      role,
      status: 'invited',
    });
    this.state.audit.unshift(this.audit('organization.updated', `Member invited: ${normalized}`));
    this.commit();
    return { ok: true, value: undefined };
  }

  async exportData(): Promise<AccountResult<string>> {
    if (!this.state.user) return { ok: false, code: 'NOT_AUTHENTICATED' };
    this.state.audit.unshift(this.audit('data.exported', 'Account data exported'));
    this.commit();
    return { ok: true, value: JSON.stringify(this.snapshot(), null, 2) };
  }

  async deleteAccount(confirmation: string): Promise<AccountResult> {
    if (confirmation.trim() !== 'DELETE') {
      return { ok: false, code: 'CONFIRMATION_MISMATCH' };
    }
    this.state = createEmptyState();
    this.storage.removeItem(STORAGE_KEY);
    this.emit();
    return { ok: true, value: undefined };
  }

  async loadDemoAccount(): Promise<void> {
    this.state = createDemoState();
    this.commit();
  }

  async resetPrototype(): Promise<void> {
    this.state = createEmptyState();
    this.storage.removeItem(STORAGE_KEY);
    this.emit();
  }

  private audit(type: AccountSnapshot['audit'][number]['type'], label: string) {
    return { id: id('aud'), type, label, createdAt: now() };
  }

  private read(): InternalAccountState {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyState();
    try {
      return JSON.parse(raw) as InternalAccountState;
    } catch {
      this.storage.removeItem(STORAGE_KEY);
      return createEmptyState();
    }
  }

  private commit(): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
