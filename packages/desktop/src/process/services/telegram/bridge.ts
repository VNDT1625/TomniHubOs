import { telegramChannel } from '@/common/adapter/ipcBridge';
import type { TelegramChannelService } from './service';

let registered = false;

export const registerTelegramChannelBridge = (service: TelegramChannelService): void => {
  if (registered) return;
  registered = true;
  telegramChannel.getPluginStatus.provider(async () => [await service.status()]);
  telegramChannel.enablePlugin.provider(async ({ plugin_id, config }) => {
    if (plugin_id !== 'telegram') throw new Error('Native Telegram bridge only accepts telegram.');
    const credentials = config.credentials;
    const token =
      credentials && typeof credentials === 'object' && typeof (credentials as { token?: unknown }).token === 'string'
        ? (credentials as { token: string }).token
        : '';
    await service.enable(token);
  });
  telegramChannel.disablePlugin.provider(async ({ plugin_id }) => {
    if (plugin_id !== 'telegram') throw new Error('Native Telegram bridge only accepts telegram.');
    await service.disable();
  });
  telegramChannel.testPlugin.provider(({ plugin_id, token }) =>
    plugin_id === 'telegram'
      ? service.test(token)
      : Promise.resolve({ success: false, error: 'Native Telegram bridge only accepts telegram.' })
  );
  telegramChannel.getPendingPairings.provider(() => service.pendingPairings());
  telegramChannel.approvePairing.provider(({ code }) => service.approve(code));
  telegramChannel.rejectPairing.provider(({ code }) => service.reject(code));
  telegramChannel.getAuthorizedUsers.provider(() => service.authorizedUsers());
  telegramChannel.revokeUser.provider(({ user_id }) => service.revoke(user_id));
  telegramChannel.getActiveSessions.provider(() => service.activeSessions());
  telegramChannel.syncChannelSettings.provider(({ platform }) => {
    if (platform !== 'telegram') throw new Error('Native Telegram bridge only accepts telegram.');
    return service.syncSettings();
  });
};
