import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type {
  IChannelPairingRequest,
  IChannelPluginStatus,
  IChannelSession,
  IChannelUser,
} from '@/common/types/channel/channel';
import type { TProviderWithModel } from '@/common/config/storage';
import type { NativeConversationService } from '@process/services/database/nativeConversation';
import type { SecretVault } from '@process/agentRuntime/secretVault';

type TelegramUser = { id: number; username?: string; first_name?: string; last_name?: string };
type TelegramMessage = { chat: { id: number }; from?: TelegramUser; text?: string };
type TelegramUpdate = { update_id: number; message?: TelegramMessage };
type TelegramBot = { id: number; username?: string };
type TelegramResult<T> = { ok: boolean; result?: T; description?: string };

type State = {
  version: 1;
  enabled: boolean;
  secretHandle?: string;
  botUsername?: string;
  offset: number;
  pairings: IChannelPairingRequest[];
  users: IChannelUser[];
  sessions: IChannelSession[];
};

export type TelegramChannelEvents = {
  pairingRequested: (value: IChannelPairingRequest) => void;
  userAuthorized: (value: IChannelUser) => void;
  statusChanged: (value: IChannelPluginStatus) => void;
};

export type TelegramChannelDeps = {
  statePath: string;
  vault: SecretVault;
  conversations: NativeConversationService;
  events: TelegramChannelEvents;
  fetchImpl?: typeof fetch;
  readSettings: () => Promise<{
    model?: TProviderWithModel;
    agent?: { agent_type: string; backend?: string; id?: string; custom_agent_id?: string; name?: string };
  }>;
  /** Main-only online-account gate. */
  requireAuthenticatedAccount?: () => void;
  /**
   * Main-owned governed egress admission. Undefined is deny: a saved Telegram
   * configuration must never resume polling merely because an account signed in.
   */
  isExternalAuthorityGranted?: () => boolean;
  /** Main-owned revocation signal; it aborts an in-flight long poll. */
  subscribeExternalAuthorityRevocation?: (listener: () => void) => () => void;
};

const emptyState = (): State => ({
  version: 1,
  enabled: false,
  offset: 0,
  pairings: [],
  users: [],
  sessions: [],
});

const displayName = (user: TelegramUser): string =>
  [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id);

const messageText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === 'string'
          ? item
          : item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string'
            ? (item as { text: string }).text
            : ''
      )
      .join('');
  }
  return '';
};

export class TelegramChannelService {
  private state: State = emptyState();
  private ready: Promise<void>;
  private pollAbort?: AbortController;
  private pollPromise?: Promise<void>;
  private readonly fetchImpl: typeof fetch;

  public constructor(private readonly deps: TelegramChannelDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.ready = this.load();
    deps.subscribeExternalAuthorityRevocation?.(() => {
      void this.suspendPolling();
    });
  }

  public async status(): Promise<IChannelPluginStatus> {
    await this.ready;
    return {
      id: 'telegram',
      type: 'telegram',
      name: 'Telegram',
      enabled: this.state.enabled,
      connected: Boolean(this.state.enabled && this.state.botUsername),
      status: this.state.enabled ? 'running' : 'disabled',
      activeUsers: this.state.users.length,
      botUsername: this.state.botUsername,
      hasToken: Boolean(this.state.secretHandle),
    };
  }

  public async test(token: string): Promise<{ success: boolean; bot_username?: string; error?: string }> {
    try {
      this.requireExternalAuthority();
      const bot = await this.call<TelegramBot>(token.trim(), 'getMe');
      return { success: true, bot_username: bot.username };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  public async enable(token: string): Promise<void> {
    this.requireExecutionAccess();
    this.requireExternalAuthority();
    await this.ready;
    const normalizedToken = token.trim() || (await this.token());
    const bot = await this.call<TelegramBot>(normalizedToken, 'getMe');
    if (token.trim()) {
      if (this.state.secretHandle) await this.deps.vault.remove(this.state.secretHandle);
      const secret = await this.deps.vault.put(
        {
          label: 'Telegram Bot Token',
          kind: 'token',
          fields: ['token'],
          binding: { surfaces: ['telegram'], purposes: ['telegram-bot'], targets: ['telegram'] },
        },
        { token: normalizedToken }
      );
      this.state.secretHandle = secret.handle;
    }
    this.state.botUsername = bot.username;
    this.state.enabled = true;
    await this.save();
    this.deps.events.statusChanged(await this.status());
    this.startPolling();
  }

  public async disable(): Promise<void> {
    await this.ready;
    this.state.enabled = false;
    await this.suspendPolling();
    await this.save();
    this.deps.events.statusChanged(await this.status());
  }

  public async pendingPairings(): Promise<IChannelPairingRequest[]> {
    await this.ready;
    const now = Date.now();
    this.state.pairings = this.state.pairings.filter((item) => item.expiresAt > now);
    return structuredClone(this.state.pairings);
  }

  public async authorizedUsers(): Promise<IChannelUser[]> {
    await this.ready;
    return structuredClone(this.state.users);
  }

  public async activeSessions(): Promise<IChannelSession[]> {
    await this.ready;
    return structuredClone(this.state.sessions);
  }

  public async approve(code: string): Promise<void> {
    this.requireExternalAuthority();
    await this.ready;
    const pairing = this.state.pairings.find((item) => item.code === code && item.expiresAt > Date.now());
    if (!pairing) throw new Error('Pairing code is invalid or expired.');
    const user: IChannelUser = {
      id: randomUUID(),
      platformUserId: pairing.platformUserId,
      platformType: 'telegram',
      display_name: pairing.display_name,
      authorizedAt: Date.now(),
    };
    this.state.users.push(user);
    this.state.pairings = this.state.pairings.filter((item) => item.code !== code);
    await this.save();
    this.deps.events.userAuthorized(user);
    await this.sendTelegram(Number(pairing.platformUserId), 'Pairing approved. You can now chat with Tomny.').catch(
      (): void => undefined
    );
  }

  public async reject(code: string): Promise<void> {
    await this.ready;
    this.state.pairings = this.state.pairings.filter((item) => item.code !== code);
    await this.save();
  }

  public async revoke(userId: string): Promise<void> {
    await this.ready;
    const user = this.state.users.find((item) => item.id === userId);
    this.state.users = this.state.users.filter((item) => item.id !== userId);
    if (user) this.state.sessions = this.state.sessions.filter((item) => item.user_id !== user.id);
    await this.save();
  }

  public async syncSettings(): Promise<void> {
    await this.ready;
    const settings = await this.deps.readSettings();
    await Promise.all(
      this.state.sessions.map(async (session) => {
        if (!session.conversation_id) return;
        const conversation = await this.deps.conversations.get(session.conversation_id);
        if (!conversation) return;
        await this.deps.conversations.update(
          conversation.id,
          {
            ...(settings.model ? { model: settings.model } : {}),
            extra: {
              ...conversation.extra,
              backend: settings.agent?.backend,
              custom_agent_id: settings.agent?.id ?? settings.agent?.custom_agent_id,
              agent_name: settings.agent?.name,
            },
          },
          false
        );
      })
    );
  }

  public async resume(): Promise<void> {
    this.requireExecutionAccess();
    await this.ready;
    if (this.state.enabled && this.isExternalAuthorityGranted()) this.startPolling();
  }

  /** Stops network polling without changing the user's enabled configuration. */
  public async suspendPolling(): Promise<void> {
    await this.ready;
    const polling = this.pollPromise;
    this.pollAbort?.abort();
    await polling?.catch((_error: unknown): void => undefined);
  }

  public async forwardCompleted(payload: unknown): Promise<void> {
    try {
      this.requireExecutionAccess();
      this.requireExternalAuthority();
    } catch {
      return;
    }
    if (!payload || typeof payload !== 'object') return;
    const conversationId = (payload as { conversation_id?: unknown }).conversation_id;
    if (typeof conversationId !== 'string') return;
    const session = this.state.sessions.find((item) => item.conversation_id === conversationId);
    if (!session?.chatId) return;
    const history = await this.deps.conversations.history(conversationId, 1, 1, 'desc');
    const text = messageText((history.items[0] as { content?: unknown } | undefined)?.content);
    if (text) await this.sendTelegram(Number(session.chatId), text.slice(0, 4096));
  }

  private async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.deps.statePath, 'utf8')) as State;
      if (parsed.version === 1) this.state = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.deps.statePath), { recursive: true });
    const temp = `${this.deps.statePath}.tmp`;
    await writeFile(temp, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temp, this.deps.statePath);
  }

  private async token(): Promise<string> {
    if (!this.state.secretHandle) throw new Error('Telegram bot token is not configured.');
    const value = await this.deps.vault.resolve({
      handle: this.state.secretHandle,
      surface: 'telegram',
      purpose: 'telegram-bot',
      target: 'telegram',
      fields: ['token'],
    });
    return value.token;
  }

  private requireExecutionAccess(): void {
    this.deps.requireAuthenticatedAccount?.();
  }

  private isExternalAuthorityGranted(): boolean {
    return this.deps.isExternalAuthorityGranted?.() === true;
  }

  private requireExternalAuthority(): void {
    if (!this.isExternalAuthorityGranted()) throw new Error('TELEGRAM_EXTERNAL_AUTHORITY_REQUIRED');
  }

  private async call<T>(
    token: string,
    method: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<T> {
    this.requireExternalAuthority();
    if (!token) throw new Error('Telegram bot token is required.');
    const response = await this.fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    const result = (await response.json()) as TelegramResult<T>;
    if (!response.ok || !result.ok || result.result === undefined) {
      throw new Error(result.description || `Telegram API failed (${response.status}).`);
    }
    return result.result;
  }

  private async sendTelegram(chatId: number, text: string): Promise<void> {
    this.requireExternalAuthority();
    await this.call(await this.token(), 'sendMessage', { chat_id: chatId, text });
  }

  private startPolling(): void {
    this.requireExternalAuthority();
    if (this.pollPromise) return;
    this.pollAbort = new AbortController();
    const signal = this.pollAbort.signal;
    this.pollPromise = this.poll(signal).finally(() => {
      this.pollPromise = undefined;
      this.pollAbort = undefined;
    });
  }

  private async poll(signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (!signal.aborted && this.state.enabled) {
      if (!this.isExternalAuthorityGranted()) return;
      try {
        this.requireExternalAuthority();
        const updates = await this.call<TelegramUpdate[]>(
          await this.token(),
          'getUpdates',
          { offset: this.state.offset, timeout: 25, allowed_updates: ['message'] },
          signal
        );
        failures = 0;
        for (const update of updates) {
          this.state.offset = Math.max(this.state.offset, update.update_id + 1);
          await this.handleUpdate(update);
        }
        if (updates.length) await this.save();
      } catch (error) {
        if (signal.aborted) return;
        failures += 1;
        await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5))));
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    const user = message?.from;
    const text = message?.text?.trim();
    if (!message || !user || !text) return;
    const platformUserId = String(user.id);
    const authorized = this.state.users.find((item) => item.platformUserId === platformUserId);
    if (!authorized) {
      let pairing = this.state.pairings.find(
        (item) => item.platformUserId === platformUserId && item.expiresAt > Date.now()
      );
      if (!pairing) {
        pairing = {
          code: String(randomInt(100_000, 1_000_000)),
          platformUserId,
          platformType: 'telegram',
          display_name: displayName(user),
          requestedAt: Date.now(),
          expiresAt: Date.now() + 10 * 60_000,
        };
        this.state.pairings.push(pairing);
        await this.save();
        this.deps.events.pairingRequested(pairing);
      }
      await this.sendTelegram(message.chat.id, `Pairing code: ${pairing.code}. Approve it in Tomny settings.`);
      return;
    }

    const command = text.split(/\s+/)[0]?.toLowerCase();

    if (command === '/start' || command === '/help') {
      const helpMsg = [
        '👋 Xin chào! Đây là Tomny Hub Bot điều khiển từ xa.',
        '',
        '📌 Danh sách lệnh khả dụng:',
        '• /menu - Xem menu điều khiển & trạng thái hoạt động',
        '• /agent - Xem thông tin AI Agent đang sử dụng',
        '• /status - Xem trạng thái kết nối và môi trường',
        '• /new hoặc /reset - Khởi tạo phiên trò chuyện mới',
        '• /help - Xem lại hướng dẫn này',
        '',
        '💬 Hoặc gửi tin nhắn văn bản bất kỳ để Agent thực hiện nhiệm vụ.',
      ].join('\n');
      await this.sendTelegram(message.chat.id, helpMsg);
      return;
    }

    if (command === '/menu') {
      const settings = await this.deps.readSettings();
      const agent = settings.agent;
      const agentName = agent?.name || 'Tomny Agentic';
      const modelName =
        settings.model?.use_model || '⚠️ Chưa chọn Model (Vui lòng chọn Default Model trong Tomny Settings)';
      const menuMsg = [
        '📋 Tomny Hub Menu',
        '────────────────────',
        '🤖 Agent: ' + agentName,
        '🧠 Model: ' + modelName,
        '',
        '⚡ Lệnh nhanh:',
        '• /agent - Chi tiết Agent',
        '• /status - Trạng thái hệ thống',
        '• /new - Làm mới phiên chat',
        '• /help - Trợ giúp',
        '',
        '👉 Bạn có thể nhắn tin trực tiếp để Agent làm việc.',
      ].join('\n');
      await this.sendTelegram(message.chat.id, menuMsg);
      return;
    }

    if (command === '/agent') {
      const settings = await this.deps.readSettings();
      const agent = settings.agent;
      const agentName = agent?.name || 'Tomny Agentic';
      const backend = agent?.backend || agent?.agent_type || 'tomnyagentic';
      const agentMsg = [
        '🤖 Thông tin Agent điều khiển',
        '────────────────────',
        '• Tên: ' + agentName,
        '• Backend: ' + backend,
        '• Nền tảng: Tomny Hub Ecosystem',
        '',
        '💡 Để chọn Agent hoặc thay đổi Model, vui lòng mở Tomny Hub Desktop -> Settings -> Channels -> Telegram.',
      ].join('\n');
      await this.sendTelegram(message.chat.id, agentMsg);
      return;
    }

    if (command === '/status') {
      const settings = await this.deps.readSettings();
      const recent = await this.deps.conversations.list(undefined, 20);
      const workspace = recent.items
        .map((item) => (typeof item.extra?.workspace === 'string' ? item.extra.workspace : ''))
        .find(Boolean);
      const statusMsg = [
        '⚡ Trạng thái Tomny Hub Remote',
        '────────────────────',
        '• Người dùng: ' + (authorized.display_name || platformUserId),
        '• Chat ID: ' + message.chat.id,
        '• Trạng thái Bot: Hoạt động (Connected)',
        '• Workspace: ' + (workspace ? path.basename(workspace) : 'Chưa có workspace nào mở'),
        '• Agent: ' + (settings.agent?.name || 'Tomny Agentic'),
        '• Model: ' + (settings.model?.use_model || '⚠️ Chưa chọn Model'),
      ].join('\n');
      await this.sendTelegram(message.chat.id, statusMsg);
      return;
    }

    if (command === '/new' || command === '/reset') {
      this.state.sessions = this.state.sessions.filter(
        (item) => !(item.user_id === authorized.id && item.chatId === String(message.chat.id))
      );
      await this.save();
      await this.sendTelegram(message.chat.id, '🔄 Đã làm mới phiên trò chuyện. Hãy gửi tin nhắn mới để bắt đầu!');
      return;
    }

    const currentSettings = await this.deps.readSettings();
    if (!currentSettings.model?.use_model) {
      await this.sendTelegram(
        message.chat.id,
        'Chua chon Default Model cho Telegram trong Tomny Hub Settings. Vui long chon Default Model.'
      );
      return;
    }

    let session = this.state.sessions.find(
      (item) => item.user_id === authorized.id && item.chatId === String(message.chat.id)
    );
    if (!session?.conversation_id) {
      const recent = await this.deps.conversations.list(undefined, 200);
      const workspace = recent.items
        .map((item) => (typeof item.extra?.workspace === 'string' ? item.extra.workspace : ''))
        .find(Boolean);
      if (!workspace) {
        await this.sendTelegram(message.chat.id, 'Open Tomny and select a workspace before starting a Telegram agent.');
        return;
      }
      const settings = await this.deps.readSettings();
      const model: TProviderWithModel = settings.model ?? {
        id: 'tomny',
        platform: 'tomny',
        name: 'Tomny default',
        base_url: '',
        api_key: '',
        use_model: '',
      };
      const agent = settings.agent;
      const type = agent?.backend === 'codex' ? 'codex' : agent?.agent_type === 'acp' ? 'acp' : 'tomnyagentic';
      const conversation = await this.deps.conversations.create({
        type,
        name: `Telegram · ${authorized.display_name || platformUserId}`,
        model,
        extra: {
          workspace,
          backend: agent?.backend,
          custom_agent_id: agent?.id ?? agent?.custom_agent_id,
          agent_name: agent?.name,
        },
      });
      await this.deps.conversations.update(conversation.id, {
        source: 'telegram',
        channel_chat_id: `user:${platformUserId}`,
      });
      session = {
        id: randomUUID(),
        user_id: authorized.id,
        agent_type: type,
        conversation_id: conversation.id,
        workspace,
        chatId: String(message.chat.id),
        created_at: Date.now(),
        lastActivity: Date.now(),
      };
      this.state.sessions.push(session);
      await this.save();
    }
    session.lastActivity = Date.now();
    await this.deps.conversations.send({ conversation_id: session.conversation_id, input: text });
  }
}
