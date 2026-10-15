/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { bridge } from '@office-ai/platform';
import type {
  SocialAccount,
  SocialPermissions,
  SocialPlatform,
  SocialStorageStats,
  UnifiedConversation,
  UnifiedMessage,
  UnifiedPost,
  UnifiedReel,
} from '@/common/types/social';
import { socialChannels } from '@/common/types/social/socialChannels';
import { BasePlatformAdapter } from './adapters/mockPlatformAdapters';
import type { IPlatformAdapter } from './adapters/types';
import {
  validProviderBatch,
  validProviderPost,
  validProviderReel,
  validProviderConversation,
  validProviderMessage,
} from './adapters/providerPayload';
import { initSocialDb, type SocialDbInstance } from './socialDb';
import { SocialSessionVault } from './sessionVault';
import { SocialWebViewController, type SocialWebBounds, type SocialWebSection } from './socialWebView';
import { runAutoEviction } from './cacheEviction';

export type AddSocialAccountParams = {
  platform: string;
  username?: string;
  displayName?: string;
  permissions?: Partial<SocialPermissions>;
};

export interface ISocialBridgeService {
  listAccounts(): Promise<SocialAccount[]>;
  addAccount(params: AddSocialAccountParams): Promise<SocialAccount>;
  connectAccount(params: { platform: string }): Promise<SocialAccount>;
  removeAccount(params: { accountId: string }): Promise<{ success: boolean }>;
  updatePermissions(params: { accountId: string; permissions: SocialPermissions }): Promise<SocialAccount>;
  openLoginWindow(params: { accountId: string }): Promise<{ success: boolean }>;
  getFeedQueue(params: {
    accountId?: string;
    platform?: SocialPlatform;
    limit?: number;
    offset?: number;
  }): Promise<UnifiedPost[]>;
  refreshFeed(params?: { accountId?: string }): Promise<{ count: number }>;
  markPostViewed(params: { postId: string }): Promise<{ success: boolean }>;
  getReelsQueue(params: { accountId?: string; limit?: number; offset?: number }): Promise<UnifiedReel[]>;
  refreshReels(params?: { accountId?: string }): Promise<{ count: number }>;
  markReelViewed(params: { reelId: string }): Promise<{ success: boolean }>;
  getConversations(params?: { accountId?: string }): Promise<UnifiedConversation[]>;
  refreshConversations(params?: { accountId?: string }): Promise<{ count: number }>;
  getThread(params: { conversationId: string }): Promise<UnifiedMessage[]>;
  refreshThread(params: { conversationId: string }): Promise<{ count: number }>;
  sendMessage(params: { conversationId: string; content: string }): Promise<UnifiedMessage>;
  getStorageStats(): Promise<SocialStorageStats>;
  clearCache(): Promise<{ freedBytes: number }>;
}

export type SocialAdapterFactory = (platform: SocialPlatform) => IPlatformAdapter;

export const SUPPORTED_PLATFORMS: ReadonlySet<SocialPlatform> = new Set([
  'x',
  'facebook',
  'threads',
  'reddit',
  'tiktok',
  'youtube',
]);

export const PLATFORM_LOGIN_URLS: Record<SocialPlatform, string> = {
  x: 'https://x.com/i/flow/login',
  facebook: 'https://www.facebook.com/login',
  threads: 'https://www.threads.net/login',
  reddit: 'https://www.reddit.com/login',
  tiktok: 'https://www.tiktok.com/login',
  youtube: 'https://accounts.google.com/signin',
};

/** Trusted top-level login hosts only. Subresources are handled by the provider site itself. */
const SOCIAL_LOGIN_DOMAINS: Record<SocialPlatform, readonly string[]> = {
  x: ['x.com', 'twitter.com'],
  facebook: ['facebook.com', 'meta.com', 'instagram.com'],
  threads: ['threads.net', 'threads.com', 'facebook.com', 'instagram.com'],
  reddit: ['reddit.com'],
  tiktok: ['tiktok.com'],
  youtube: ['youtube.com', 'google.com', 'googleusercontent.com'],
};

/** Never permit popups or top-level navigation to local schemes or third-party phishing hosts. */
export function isApprovedSocialLoginNavigation(platform: SocialPlatform, candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    return SOCIAL_LOGIN_DOMAINS[platform].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

const normalizeUsername = (username: string | undefined): string => username?.trim().replace(/^@+/, '') ?? '';
const SOCIAL_ACCOUNT_LIMIT = 32;
const SOCIAL_BULK_SYNC_ACCOUNT_LIMIT = 8;
const SOCIAL_CONVERSATION_RESPONSE_LIMIT = 200;
const SOCIAL_THREAD_RESPONSE_LIMIT = 200;

/** Validate IPC input at runtime: TypeScript generics do not validate renderer messages. */
function socialFields(payload: unknown, keys: readonly string[], optional = false): Record<string, unknown> {
  if (optional && payload === undefined) return {};
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('SOCIAL_INVALID_IPC_PAYLOAD');
  }
  const data = payload as Record<string, unknown>;
  if (Object.keys(data).some((key) => !keys.includes(key))) throw new Error('SOCIAL_INVALID_IPC_PAYLOAD');
  return data;
}

function socialId(data: Record<string, unknown>, key: string, optional = false): string | undefined {
  const value = data[key];
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || value.length < 1 || value.length > 160 || value.trim() !== value) {
    throw new Error('SOCIAL_INVALID_IPC_PAYLOAD');
  }
  return value;
}

function socialPage(data: Record<string, unknown>, key: 'limit' | 'offset', max: number): void {
  const value = data[key];
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (key === 'limit' ? 1 : 0) || value > max) {
    throw new Error('SOCIAL_INVALID_IPC_PAYLOAD');
  }
}

function socialOptionalAccount(data: unknown): void {
  const payload = socialFields(data, ['accountId'], true);
  socialId(payload, 'accountId', true);
}

export function createSocialBridgeService(
  db: SocialDbInstance,
  vault: SocialSessionVault,
  createAdapter: SocialAdapterFactory = (platform) => new BasePlatformAdapter(platform),
  openLoginWindowHandler?: (account: SocialAccount) => Promise<void>,
  clearAccountSession?: (partitionKey: string) => Promise<void>
): ISocialBridgeService {
  const adapters = new Map<SocialPlatform, IPlatformAdapter>();
  const sendingThreads = new Set<string>();

  /** Re-check ownership, active API identity and capability after each provider await. */
  const assertCurrentAccount = (snapshot: SocialAccount, capability: keyof SocialPermissions): void => {
    const current = db.getAccounts().find((item) => item.id === snapshot.id);
    if (
      !current ||
      current.platform !== snapshot.platform ||
      current.partitionKey !== snapshot.partitionKey ||
      current.status !== 'connected' ||
      !current.permissions[capability]
    )
      throw new Error('SOCIAL_ACCOUNT_CHANGED_DURING_SYNC');
  };

  const getAdapter = (platform: SocialPlatform): IPlatformAdapter => {
    let adapter = adapters.get(platform);
    if (!adapter) {
      adapter = createAdapter(platform);
      adapters.set(platform, adapter);
    }
    return adapter;
  };

  return {
    async listAccounts(): Promise<SocialAccount[]> {
      return db.getAccounts();
    },

    async addAccount(params: AddSocialAccountParams): Promise<SocialAccount> {
      socialFields(params, ['platform', 'username', 'displayName', 'permissions']);
      const displayName = params.displayName;
      if (displayName !== undefined && (typeof displayName !== 'string' || displayName.length > 160))
        throw new Error('SOCIAL_INVALID_IPC_PAYLOAD');
      if (params.permissions !== undefined) {
        const permissionData = socialFields(params.permissions, [
          'canSyncFeed',
          'canSyncReels',
          'canReadMessages',
          'canSendMessages',
        ]);
        if (Object.values(permissionData).some((value) => typeof value !== 'boolean'))
          throw new Error('SOCIAL_PERMISSIONS_INVALID');
      }
      const platform =
        typeof params.platform === 'string'
          ? (params.platform.toLowerCase() as SocialPlatform)
          : ('' as SocialPlatform);
      if (!SUPPORTED_PLATFORMS.has(platform)) throw new Error('SOCIAL_PLATFORM_UNSUPPORTED');

      const username =
        typeof params.username === 'string' || params.username === undefined ? normalizeUsername(params.username) : '';
      if (params.username !== undefined && typeof params.username !== 'string')
        throw new Error('SOCIAL_ACCOUNT_USERNAME_INVALID');
      // User-provided handles are not an authentication credential or authorization.
      if (username.length > 100) throw new Error('SOCIAL_ACCOUNT_USERNAME_INVALID');
      if (
        username &&
        db.getAccounts().some((a) => a.platform === platform && a.username.toLowerCase() === username.toLowerCase())
      ) {
        throw new Error('SOCIAL_ACCOUNT_ALREADY_EXISTS');
      }

      if (db.getAccounts().length >= SOCIAL_ACCOUNT_LIMIT) throw new Error('SOCIAL_ACCOUNT_LIMIT_REACHED');
      const accountId = `acc_${platform}_${crypto.randomUUID()}`;
      const now = Date.now();
      // Never infer API consent from a manually entered handle (including the legacy ADD path).
      const defaultConsent = false;
      const account: SocialAccount = {
        id: accountId,
        platform,
        accountId,
        username,
        displayName:
          params.displayName?.trim() ||
          (username
            ? `@${username}`
            : `${platform.toUpperCase()} Web ${db.getAccounts().filter((a) => a.platform === platform).length + 1}`),
        avatarUrl: '',
        partitionKey: vault.getPartitionKey(platform, accountId),
        // A login window is not evidence that OAuth/session access has been verified.
        status: 'expired',
        permissions: {
          canSyncFeed: params.permissions?.canSyncFeed ?? defaultConsent,
          canSyncReels: params.permissions?.canSyncReels ?? defaultConsent,
          canReadMessages: params.permissions?.canReadMessages ?? defaultConsent,
          canSendMessages: params.permissions?.canSendMessages ?? defaultConsent,
        },
        connectedAt: now,
        lastSyncedAt: 0,
      };

      db.saveAccount(account);
      return account;
    },

    async connectAccount(params) {
      socialFields(params, ['platform']);
      if (!openLoginWindowHandler) throw new Error('SOCIAL_LOGIN_UNAVAILABLE');
      // Consent for future API capabilities is separate from a first-party website session.
      const account = await this.addAccount({
        platform: params.platform,
        permissions: { canSyncFeed: false, canSyncReels: false, canReadMessages: false, canSendMessages: false },
      });
      try {
        await openLoginWindowHandler(account);
        return account;
      } catch (error) {
        // Do not leave an orphaned, apparently linked account after a failed window launch.
        db.removeAccount(account.id);
        vault.releasePartition(account.partitionKey);
        try {
          await clearAccountSession?.(account.partitionKey);
        } catch {
          // The original login failure remains the meaningful error.
        }
        throw error;
      }
    },

    async removeAccount(params) {
      socialId(socialFields(params, ['accountId']), 'accountId');
      const account = db.getAccounts().find((item) => item.id === params.accountId);
      if (account) {
        await clearAccountSession?.(account.partitionKey);
        vault.releasePartition(account.partitionKey);
      }
      db.removeAccount(params.accountId);
      return { success: true };
    },

    async updatePermissions(params) {
      socialId(socialFields(params, ['accountId', 'permissions']), 'accountId');
      const keys: (keyof SocialPermissions)[] = ['canSyncFeed', 'canSyncReels', 'canReadMessages', 'canSendMessages'];
      if (
        !params.permissions ||
        Object.keys(socialFields(params.permissions, keys)).length !== keys.length ||
        keys.some((key) => typeof params.permissions[key] !== 'boolean')
      ) {
        throw new Error('SOCIAL_PERMISSIONS_INVALID');
      }
      db.updateAccountPermissions(params.accountId, params.permissions);
      const account = db.getAccounts().find((item) => item.id === params.accountId);
      if (!account) throw new Error('SOCIAL_ACCOUNT_NOT_FOUND');
      return account;
    },

    async openLoginWindow(params) {
      socialId(socialFields(params, ['accountId']), 'accountId');
      const account = db.getAccounts().find((item) => item.id === params.accountId);
      if (!account) throw new Error('SOCIAL_ACCOUNT_NOT_FOUND');
      if (!openLoginWindowHandler) throw new Error('SOCIAL_LOGIN_UNAVAILABLE');
      await openLoginWindowHandler(account);
      return { success: true };
    },

    async getFeedQueue(params) {
      const fields = socialFields(params, ['accountId', 'platform', 'limit', 'offset']);
      socialId(fields, 'accountId', true);
      socialPage(fields, 'limit', 100);
      socialPage(fields, 'offset', 100000);
      if (fields.platform !== undefined && typeof fields.platform !== 'string')
        throw new Error('SOCIAL_FEED_PLATFORM_UNSUPPORTED');

      if (params?.platform && !['facebook', 'x', 'threads', 'reddit'].includes(params.platform))
        throw new Error('SOCIAL_FEED_PLATFORM_UNSUPPORTED');
      const allowed = db
        .getAccounts()
        .filter(
          (account) => account.permissions.canSyncFeed && (!params?.platform || account.platform === params.platform)
        );
      if (params.accountId && !allowed.some((account) => account.id === params.accountId)) return [];
      const ids = new Set(allowed.map((account) => account.id));
      return db.getUnseenPosts(params.accountId, params.limit, params.offset, [...ids]);
    },

    async refreshFeed(params) {
      socialOptionalAccount(params);

      const accounts = db
        .getAccounts()
        .filter(
          (account) =>
            (params?.accountId === undefined || account.id === params.accountId) &&
            account.permissions.canSyncFeed &&
            ['x', 'facebook', 'threads', 'reddit'].includes(account.platform)
        );
      if (accounts.length > SOCIAL_BULK_SYNC_ACCOUNT_LIMIT) throw new Error('SOCIAL_SYNC_ACCOUNT_LIMIT_REACHED');
      if (accounts.some((account) => account.status !== 'connected')) throw new Error('SOCIAL_SESSION_UNVERIFIED');
      let count = 0;
      for (const account of accounts) {
        // oxlint-disable-next-line no-await-in-loop -- provider requests are intentionally serialized to avoid bursts
        const posts = await getAdapter(account.platform).fetchFeed(account);
        assertCurrentAccount(account, 'canSyncFeed');
        if (
          !validProviderBatch(posts, validProviderPost, 100) ||
          posts.some((post) => post.accountId !== account.id || post.platform !== account.platform)
        ) {
          throw new Error('SOCIAL_INVALID_PROVIDER_FEED');
        }
        db.savePosts(posts);
        count += posts.length;
      }
      return { count };
    },

    async markPostViewed(params) {
      socialId(socialFields(params, ['postId']), 'postId');

      const owner = typeof params?.postId === 'string' ? db.getPostOwner(params.postId) : undefined;
      if (!owner) throw new Error('SOCIAL_POST_NOT_FOUND');
      if (!db.getAccounts().some((item) => item.id === owner && item.permissions.canSyncFeed))
        throw new Error('SOCIAL_FEED_NOT_PERMITTED');
      db.markPostViewed(params.postId);
      return { success: true };
    },

    async getReelsQueue(params) {
      const fields = socialFields(params, ['accountId', 'limit', 'offset']);
      socialId(fields, 'accountId', true);
      socialPage(fields, 'limit', 100);
      socialPage(fields, 'offset', 100000);

      const allowed = db.getAccounts().filter((account) => account.permissions.canSyncReels);
      if (params.accountId && !allowed.some((account) => account.id === params.accountId)) return [];
      const ids = new Set(allowed.map((account) => account.id));
      return db.getUnseenReels(params.accountId, params.limit, params.offset, [...ids]);
    },

    async refreshReels(params) {
      socialOptionalAccount(params);

      const accounts = db
        .getAccounts()
        .filter(
          (account) =>
            (!params?.accountId || account.id === params.accountId) &&
            account.permissions.canSyncReels &&
            ['facebook', 'tiktok', 'youtube'].includes(account.platform)
        );
      if (accounts.length > SOCIAL_BULK_SYNC_ACCOUNT_LIMIT) throw new Error('SOCIAL_SYNC_ACCOUNT_LIMIT_REACHED');
      if (accounts.some((account) => account.status !== 'connected')) throw new Error('SOCIAL_SESSION_UNVERIFIED');
      let count = 0;
      for (const account of accounts) {
        // oxlint-disable-next-line no-await-in-loop -- keep platform rate limits isolated
        const reels = await getAdapter(account.platform).fetchReels(account);
        assertCurrentAccount(account, 'canSyncReels');
        if (
          !validProviderBatch(reels, validProviderReel, 100) ||
          reels.some((reel) => reel.accountId !== account.id || reel.platform !== account.platform)
        ) {
          throw new Error('SOCIAL_INVALID_PROVIDER_REELS');
        }
        db.saveReels(reels);
        count += reels.length;
      }
      return { count };
    },

    async markReelViewed(params) {
      socialId(socialFields(params, ['reelId']), 'reelId');

      const owner = typeof params?.reelId === 'string' ? db.getReelOwner(params.reelId) : undefined;
      if (!owner) throw new Error('SOCIAL_REEL_NOT_FOUND');
      if (!db.getAccounts().some((item) => item.id === owner && item.permissions.canSyncReels))
        throw new Error('SOCIAL_REELS_NOT_PERMITTED');
      db.markReelViewed(params.reelId);
      return { success: true };
    },

    async getConversations(params) {
      socialOptionalAccount(params);

      const allowed = new Set(
        db
          .getAccounts()
          .filter((account) => account.permissions.canReadMessages)
          .map((account) => account.id)
      );
      return db
        .getConversations(params?.accountId)
        .filter((item) => allowed.has(item.accountId))
        .slice(0, SOCIAL_CONVERSATION_RESPONSE_LIMIT);
    },

    async refreshConversations(params) {
      socialOptionalAccount(params);

      const accounts = db
        .getAccounts()
        .filter(
          (account) =>
            (!params?.accountId || account.id === params.accountId) &&
            account.permissions.canReadMessages &&
            ['facebook', 'x', 'reddit'].includes(account.platform)
        );
      if (accounts.length > SOCIAL_BULK_SYNC_ACCOUNT_LIMIT) throw new Error('SOCIAL_SYNC_ACCOUNT_LIMIT_REACHED');
      if (accounts.some((account) => account.status !== 'connected')) throw new Error('SOCIAL_SESSION_UNVERIFIED');
      let count = 0;
      for (const account of accounts) {
        // oxlint-disable-next-line no-await-in-loop -- keep platform rate limits isolated
        const conversations = await getAdapter(account.platform).fetchConversations(account);
        assertCurrentAccount(account, 'canReadMessages');
        if (
          !validProviderBatch(conversations, validProviderConversation, 100) ||
          conversations.some(
            (conversation) => conversation.accountId !== account.id || conversation.platform !== account.platform
          )
        ) {
          throw new Error('SOCIAL_INVALID_PROVIDER_CONVERSATIONS');
        }
        db.saveConversations(conversations);
        count += conversations.length;
      }
      return { count };
    },

    async refreshThread(params) {
      socialId(socialFields(params, ['conversationId']), 'conversationId');

      const conversation = db.getConversations().find((item) => item.id === params.conversationId);
      if (!conversation) throw new Error('SOCIAL_CONVERSATION_NOT_FOUND');
      const account = db.getAccounts().find((item) => item.id === conversation.accountId);
      if (!account?.permissions.canReadMessages) throw new Error('SOCIAL_READ_MESSAGES_NOT_PERMITTED');
      if (account.status !== 'connected') throw new Error('SOCIAL_SESSION_UNVERIFIED');
      const messages = await getAdapter(account.platform).fetchMessages(account, conversation.threadId);
      assertCurrentAccount(account, 'canReadMessages');
      if (
        !db
          .getConversations()
          .some(
            (item) =>
              item.id === conversation.id && item.accountId === account.id && item.threadId === conversation.threadId
          )
      )
        throw new Error('SOCIAL_CONVERSATION_CHANGED_DURING_SYNC');
      if (
        !validProviderBatch(messages, validProviderMessage, 200) ||
        messages.some((message) => message.conversationId !== conversation.id)
      ) {
        throw new Error('SOCIAL_INVALID_PROVIDER_MESSAGES');
      }
      db.saveMessages(messages);
      return { count: messages.length };
    },

    async getThread(params) {
      socialId(socialFields(params, ['conversationId']), 'conversationId');

      const conversation = db.getConversations().find((item) => item.id === params.conversationId);
      const account = db.getAccounts().find((item) => item.id === conversation?.accountId);
      if (!account?.permissions.canReadMessages) throw new Error('SOCIAL_READ_MESSAGES_NOT_PERMITTED');
      return db.getMessages(params.conversationId).slice(-SOCIAL_THREAD_RESPONSE_LIMIT);
    },

    async sendMessage(params) {
      const fields = socialFields(params, ['conversationId', 'content']);
      socialId(fields, 'conversationId');
      if (typeof fields.content !== 'string' || !fields.content.trim() || fields.content.length > 4096)
        throw new Error('SOCIAL_MESSAGE_CONTENT_INVALID');

      const conversation = db.getConversations().find((item) => item.id === params.conversationId);
      if (!conversation) throw new Error('SOCIAL_CONVERSATION_NOT_FOUND');
      const account = db.getAccounts().find((item) => item.id === conversation.accountId);
      if (!account) throw new Error('SOCIAL_ACCOUNT_NOT_FOUND');
      if (!account.permissions.canSendMessages || !account.permissions.canReadMessages)
        throw new Error('SOCIAL_SEND_MESSAGES_NOT_PERMITTED');
      if (account.status !== 'connected') throw new Error('SOCIAL_SESSION_UNVERIFIED');
      if (typeof params?.content !== 'string' || !params.content.trim() || params.content.length > 4096)
        throw new Error('SOCIAL_MESSAGE_CONTENT_INVALID');

      if (sendingThreads.has(conversation.id)) throw new Error('SOCIAL_MESSAGE_SEND_IN_PROGRESS');
      sendingThreads.add(conversation.id);
      try {
        const message = await getAdapter(account.platform).sendMessage(account, params.conversationId, params.content);
        assertCurrentAccount(account, 'canReadMessages');
        assertCurrentAccount(account, 'canSendMessages');
        if (
          !db
            .getConversations()
            .some(
              (item) =>
                item.id === conversation.id && item.accountId === account.id && item.threadId === conversation.threadId
            )
        )
          throw new Error('SOCIAL_CONVERSATION_CHANGED_DURING_SYNC');
        if (
          !validProviderMessage(message) ||
          message.conversationId !== params.conversationId ||
          !message.isFromMe ||
          !['sent', 'delivered', 'read'].includes(message.status)
        ) {
          throw new Error('SOCIAL_INVALID_SEND_RECEIPT');
        }
        db.saveMessages([message]);
        return message;
      } finally {
        sendingThreads.delete(conversation.id);
      }
    },

    async getStorageStats() {
      return db.getStorageStats();
    },

    async clearCache() {
      const stats = db.getStorageStats();
      db.clearAllCache();
      return { freedBytes: stats.cacheSizeBytes };
    },
  };
}

const loginWindows = new Map<string, import('electron').BrowserWindow>();

/**
 * Reuses the provider's persistent Web partition, not an extracted bearer or request token.
 * Web login does not prove OAuth identity or grant any platform API capability.
 */
export async function launchElectronLoginWindow(account: SocialAccount): Promise<void> {
  const existing = loginWindows.get(account.partitionKey);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return;
  }

  const { BrowserWindow, session } = await import('electron');
  const url = PLATFORM_LOGIN_URLS[account.platform];
  const partition = session.fromPartition(account.partitionKey);
  const win = new BrowserWindow({
    width: 900,
    height: 720,
    title: `TomniHub Social Web - ${account.platform.toUpperCase()}`,
    webPreferences: {
      partition: account.partitionKey,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  // An isolated provider session must not gain access to arbitrary top-level origins.
  const preventUntrustedNavigation = (event: Electron.Event, target: string): void => {
    if (!isApprovedSocialLoginNavigation(account.platform, target)) event.preventDefault();
  };
  win.webContents.on('will-navigate', (event, navigation) => {
    preventUntrustedNavigation(event, navigation);
  });
  win.webContents.on('will-redirect', (event, navigation) => {
    preventUntrustedNavigation(event, navigation);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // No arbitrary camera, microphone, location or notification grants to unverified Web profiles.
  partition.setPermissionRequestHandler((_sender, _permission, callback) => callback(false));
  loginWindows.set(account.partitionKey, win);
  win.on('closed', () => {
    loginWindows.delete(account.partitionKey);
    // Force the persistent Chromium partition to flush its Web session to disk.
    partition.flushStorageData();
  });
  try {
    await win.loadURL(url);
  } catch (error) {
    if (!win.isDestroyed()) win.destroy();
    console.error('[SocialBridge] Failed to launch login BrowserWindow:', error);
    throw error;
  }
}

export type RegisterSocialBridgeOptions = {
  dbPath: string;
  getWindow?: () => import('electron').BrowserWindow | null | undefined;
  openLogin?: (account: SocialAccount) => Promise<void>;
};

let registered = false;

async function clearElectronAccountSession(partitionKey: string): Promise<void> {
  const activeWindow = loginWindows.get(partitionKey);
  if (activeWindow && !activeWindow.isDestroyed()) activeWindow.destroy();
  const { session } = await import('electron');
  const partition = session.fromPartition(partitionKey);
  await partition.clearStorageData();
  await partition.clearCache();
}

/** Registers the typed Social provider handlers during Electron Main bootstrap. */
export function registerSocialBridge(options: RegisterSocialBridgeOptions): void {
  if (registered) return;
  registered = true;

    const openLogin = options.openLogin ?? launchElectronLoginWindow;
  const db = initSocialDb(options.dbPath);
  const webViewer = new SocialWebViewController(options.getWindow ?? (() => null));
  const service = createSocialBridgeService(
    db,
    new SocialSessionVault(),
    undefined,
    openLogin,
        async (partitionKey) => {
      webViewer.removePartition(partitionKey);
      await clearElectronAccountSession(partitionKey);
    }
  );
  const evictionInterval = setInterval(() => runAutoEviction(db), 15 * 60 * 1000);
  evictionInterval.unref();

  bridge.buildProvider<SocialAccount[], void>(socialChannels.LIST_ACCOUNTS).provider(() => service.listAccounts());
  bridge
    .buildProvider<SocialAccount, AddSocialAccountParams>(socialChannels.ADD_ACCOUNT)
    .provider((params) => service.addAccount(params));
  bridge
    .buildProvider<SocialAccount, { platform: string }>(socialChannels.CONNECT_ACCOUNT)
    .provider((params) => service.connectAccount(params));
  bridge
    .buildProvider<{ success: boolean }, { accountId: string }>(socialChannels.REMOVE_ACCOUNT)
    .provider((params) => service.removeAccount(params));
  bridge
    .buildProvider<SocialAccount, { accountId: string; permissions: SocialPermissions }>(
      socialChannels.UPDATE_PERMISSIONS
    )
    .provider((params) => service.updatePermissions(params));
    bridge
    .buildProvider<{ success: boolean }, { accountId: string }>(socialChannels.OPEN_LOGIN_WINDOW)
    .provider((params) => service.openLoginWindow(params));
  bridge
    .buildProvider<void, { accountId: string; section: SocialWebSection; bounds: SocialWebBounds }>(socialChannels.SHOW_WEB)
    .provider(async (params) => {
      const payload = socialFields(params, ['accountId', 'section', 'bounds']);
      const accountId = socialId(payload, 'accountId');
      const account = db.getAccounts().find((item) => item.id === accountId);
      if (!account) throw new Error('SOCIAL_ACCOUNT_NOT_FOUND');
      if (account.platform !== 'facebook') throw new Error('SOCIAL_WEB_PLATFORM_UNAVAILABLE');
      await webViewer.show(account, params.section, params.bounds);
    });
    bridge
    .buildProvider<void, { accountId: string }>(socialChannels.HIDE_WEB)
    .provider(async (params) => {
      const accountId = socialId(socialFields(params, ['accountId']), 'accountId');
      if (accountId) webViewer.hideAccount(accountId);
    });
  bridge
    .buildProvider<void, { accountId: string }>(socialChannels.RELOAD_WEB)
    .provider(async (params) => {
      const accountId = socialId(socialFields(params, ['accountId']), 'accountId');
      if (accountId) webViewer.reloadAccount(accountId);
    });
  bridge
    .buildProvider<UnifiedPost[], { accountId?: string; platform?: SocialPlatform; limit?: number; offset?: number }>(
      socialChannels.GET_FEED_QUEUE
    )
    .provider((params) => service.getFeedQueue(params));
  bridge
    .buildProvider<{ count: number }, { accountId?: string }>(socialChannels.REFRESH_FEED)
    .provider((params) => service.refreshFeed(params));
  bridge
    .buildProvider<{ success: boolean }, { postId: string }>(socialChannels.MARK_POST_VIEWED)
    .provider((params) => service.markPostViewed(params));
  bridge
    .buildProvider<UnifiedReel[], { accountId?: string; limit?: number; offset?: number }>(
      socialChannels.GET_REELS_QUEUE
    )
    .provider((params) => service.getReelsQueue(params));
  bridge
    .buildProvider<{ count: number }, { accountId?: string }>(socialChannels.REFRESH_REELS)
    .provider((params) => service.refreshReels(params));
  bridge
    .buildProvider<{ success: boolean }, { reelId: string }>(socialChannels.MARK_REEL_VIEWED)
    .provider((params) => service.markReelViewed(params));
  bridge
    .buildProvider<UnifiedConversation[], { accountId?: string }>(socialChannels.GET_CONVERSATIONS)
    .provider((params) => service.getConversations(params));
  bridge
    .buildProvider<{ count: number }, { accountId?: string }>(socialChannels.REFRESH_CONVERSATIONS)
    .provider((params) => service.refreshConversations(params));
  bridge
    .buildProvider<UnifiedMessage[], { conversationId: string }>(socialChannels.GET_THREAD)
    .provider((params) => service.getThread(params));
  bridge
    .buildProvider<{ count: number }, { conversationId: string }>(socialChannels.REFRESH_THREAD)
    .provider((params) => service.refreshThread(params));
  bridge
    .buildProvider<UnifiedMessage, { conversationId: string; content: string }>(socialChannels.SEND_MESSAGE)
    .provider((params) => service.sendMessage(params));
  bridge
    .buildProvider<SocialStorageStats, void>(socialChannels.GET_STORAGE_STATS)
    .provider(() => service.getStorageStats());
  bridge.buildProvider<{ freedBytes: number }, void>(socialChannels.CLEAR_CACHE).provider(() => service.clearCache());
}
