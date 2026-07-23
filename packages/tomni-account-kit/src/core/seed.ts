import type { AccountSnapshot, AccountUser } from '../types';
import { demoPasswordHash, initialsFromName } from './validation';

const now = (): number => Date.now();

export type InternalAccountState = AccountSnapshot & {
  credentialHash?: string;
  verificationCode?: string;
  resetToken?: string;
  failedAttempts: number;
};

export const createEmptyState = (): InternalAccountState => ({
  authStatus: 'signedOut',
  user: null,
  sessions: [],
  devices: [],
  subscription: {
    planId: 'local',
    status: 'active',
    seats: 1,
    creditsRemaining: 0,
    creditsLimit: 0,
  },
  sync: {
    enabled: false,
    settings: false,
    automations: false,
    accountProfile: false,
    workspaceMetadata: false,
    conversations: false,
    sourceCode: false,
  },
  organization: null,
  audit: [],
  failedAttempts: 0,
});

export const createDemoState = (): InternalAccountState => {
  const timestamp = now();
  const user: AccountUser = {
    id: 'usr_demo_thuan',
    email: 'thuan@tomni.local',
    displayName: 'Nguyễn Duy Thuận',
    avatarInitials: initialsFromName('Nguyễn Duy Thuận'),
    emailVerified: true,
    locale: 'vi-VN',
    timezone: 'Asia/Ho_Chi_Minh',
    createdAt: timestamp - 86_400_000 * 48,
  };

  return {
    authStatus: 'signedIn',
    currentSessionId: 'ses_current',
    user,
    credentialHash: demoPasswordHash('Tomni@2026'),
    sessions: [
      {
        id: 'ses_current',
        deviceId: 'dev_windows',
        label: 'Tomni Desktop',
        platform: 'Windows 11',
        location: 'Thành phố Hồ Chí Minh',
        ipAddress: '192.168.1.24',
        createdAt: timestamp - 86_400_000 * 3,
        lastActiveAt: timestamp,
        expiresAt: timestamp + 86_400_000 * 30,
        current: true,
      },
      {
        id: 'ses_mobile',
        deviceId: 'dev_iphone',
        label: 'Tomni Mobile',
        platform: 'iOS',
        location: 'Thành phố Hồ Chí Minh',
        ipAddress: '10.10.0.12',
        createdAt: timestamp - 86_400_000 * 6,
        lastActiveAt: timestamp - 3_600_000,
        expiresAt: timestamp + 86_400_000 * 12,
        current: false,
      },
    ],
    devices: [
      {
        id: 'dev_windows',
        name: 'Laptop chính',
        platform: 'Windows 11',
        trusted: true,
        firstSeenAt: timestamp - 86_400_000 * 48,
        lastSeenAt: timestamp,
      },
      {
        id: 'dev_iphone',
        name: 'iPhone',
        platform: 'iOS',
        trusted: true,
        firstSeenAt: timestamp - 86_400_000 * 20,
        lastSeenAt: timestamp - 3_600_000,
      },
    ],
    subscription: {
      planId: 'pro',
      status: 'trialing',
      renewsAt: timestamp + 86_400_000 * 12,
      seats: 1,
      creditsRemaining: 7420,
      creditsLimit: 10000,
    },
    sync: {
      enabled: true,
      settings: true,
      automations: true,
      accountProfile: true,
      workspaceMetadata: true,
      conversations: false,
      sourceCode: false,
    },
    organization: {
      id: 'org_tomni_lab',
      name: 'Tomni Lab',
      slug: 'tomni-lab',
      members: [
        {
          id: 'mem_owner',
          email: user.email,
          displayName: user.displayName,
          role: 'owner',
          status: 'active',
        },
        {
          id: 'mem_khang',
          email: 'khang@example.com',
          displayName: 'Khang',
          role: 'member',
          status: 'invited',
        },
      ],
    },
    audit: [
      {
        id: 'aud_demo_1',
        type: 'session.created',
        label: 'Phiên đăng nhập trên Tomni Desktop',
        createdAt: timestamp - 86_400_000 * 3,
      },
      {
        id: 'aud_demo_2',
        type: 'sync.updated',
        label: 'Đã bật đồng bộ cài đặt và automation',
        createdAt: timestamp - 86_400_000,
      },
    ],
    failedAttempts: 0,
  };
};
