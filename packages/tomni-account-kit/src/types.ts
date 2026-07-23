export type AccountLocale = 'vi-VN' | 'en-US';

export type AuthStatus = 'signedOut' | 'pendingVerification' | 'signedIn';

export type AccountPlanId = 'local' | 'free' | 'pro' | 'team';

export type AccountNavigationKey =
  | 'overview'
  | 'profile'
  | 'security'
  | 'devices'
  | 'organization'
  | 'subscription'
  | 'privacy';

export type AccountUser = {
  id: string;
  email: string;
  displayName: string;
  avatarInitials: string;
  emailVerified: boolean;
  locale: AccountLocale;
  timezone: string;
  createdAt: number;
};

export type AccountSession = {
  id: string;
  deviceId: string;
  label: string;
  platform: string;
  location: string;
  ipAddress: string;
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
  current: boolean;
};

export type AccountDevice = {
  id: string;
  name: string;
  platform: string;
  trusted: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  revokedAt?: number;
};

export type AccountSubscription = {
  planId: AccountPlanId;
  status: 'active' | 'trialing' | 'pastDue' | 'canceled';
  renewsAt?: number;
  seats: number;
  creditsRemaining: number;
  creditsLimit: number;
};

export type SyncPreferences = {
  enabled: boolean;
  settings: boolean;
  automations: boolean;
  accountProfile: boolean;
  workspaceMetadata: boolean;
  conversations: boolean;
  sourceCode: boolean;
};

export type OrganizationMember = {
  id: string;
  email: string;
  displayName: string;
  role: 'owner' | 'admin' | 'member';
  status: 'active' | 'invited';
};

export type AccountOrganization = {
  id: string;
  name: string;
  slug: string;
  members: OrganizationMember[];
};

export type AccountAuditEvent = {
  id: string;
  type:
    | 'account.created'
    | 'email.verified'
    | 'session.created'
    | 'session.revoked'
    | 'device.revoked'
    | 'password.changed'
    | 'profile.updated'
    | 'subscription.changed'
    | 'sync.updated'
    | 'organization.updated'
    | 'data.exported';
  label: string;
  createdAt: number;
};

export type AccountSnapshot = {
  authStatus: AuthStatus;
  currentSessionId?: string;
  user: AccountUser | null;
  sessions: AccountSession[];
  devices: AccountDevice[];
  subscription: AccountSubscription;
  sync: SyncPreferences;
  organization: AccountOrganization | null;
  audit: AccountAuditEvent[];
  lockoutUntil?: number;
};

export type RegisterInput = {
  email: string;
  password: string;
  displayName: string;
  locale?: AccountLocale;
};

export type LoginInput = {
  email: string;
  password: string;
  remember: boolean;
};

export type ProfileInput = {
  displayName: string;
  locale: AccountLocale;
  timezone: string;
};

export type AccountResult<T = void> =
  | { ok: true; value: T }
  | {
      ok: false;
      code:
        | 'EMAIL_EXISTS'
        | 'INVALID_EMAIL'
        | 'WEAK_PASSWORD'
        | 'INVALID_CREDENTIALS'
        | 'ACCOUNT_LOCKED'
        | 'EMAIL_NOT_VERIFIED'
        | 'INVALID_VERIFICATION_CODE'
        | 'INVALID_RESET_TOKEN'
        | 'NOT_AUTHENTICATED'
        | 'NOT_FOUND'
        | 'CONFIRMATION_MISMATCH'
        | 'INVALID_INPUT';
      retryAt?: number;
    };

export type AccountListener = (snapshot: AccountSnapshot) => void;

export type AccountStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type AccountClientContract = {
  snapshot(): AccountSnapshot;
  subscribe(listener: AccountListener): () => void;
  register(input: RegisterInput): Promise<AccountResult<{ verificationCode: string }>>;
  verifyEmail(code: string): Promise<AccountResult>;
  login(input: LoginInput): Promise<AccountResult>;
  logout(): Promise<void>;
  requestPasswordReset(email: string): Promise<AccountResult<{ resetToken: string }>>;
  resetPassword(token: string, newPassword: string): Promise<AccountResult>;
  changePassword(currentPassword: string, nextPassword: string): Promise<AccountResult>;
  updateProfile(input: ProfileInput): Promise<AccountResult>;
  revokeSession(sessionId: string): Promise<AccountResult>;
  renameDevice(deviceId: string, name: string): Promise<AccountResult>;
  revokeDevice(deviceId: string): Promise<AccountResult>;
  updateSync(preferences: SyncPreferences): Promise<AccountResult>;
  changePlan(planId: AccountPlanId): Promise<AccountResult>;
  createOrganization(name: string): Promise<AccountResult>;
  inviteOrganizationMember(email: string, role: OrganizationMember['role']): Promise<AccountResult>;
  exportData(): Promise<AccountResult<string>>;
  deleteAccount(confirmation: string): Promise<AccountResult>;
  loadDemoAccount(): Promise<void>;
  resetPrototype(): Promise<void>;
};
