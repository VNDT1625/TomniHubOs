import { dialog, type BrowserWindow } from 'electron';
import { configureTerminalSecretPort } from '@process/agentRuntime/agentMesh/mcp/secret-context/sinks';
import { getTerminalServices } from '@process/ideTerminal/terminalWiring';
import i18n, { i18nReady } from '@process/services/i18n';
import { createTerminalSecretPort } from './terminalSecretPort';

/**
 * Lets `tomny_secret_use` type saved secrets into a terminal, after the person approves that terminal in a native
 * dialog. The terminal service is resolved lazily so no terminal is created just because this is registered.
 */
export const registerDesktopTerminalSecretPort = (options: { getWindow: () => BrowserWindow | null }): (() => void) => {
  configureTerminalSecretPort(
    createTerminalSecretPort({
      list: () => getTerminalServices().manager.list(),
      write: (terminalId, data) => getTerminalServices().manager.write(terminalId, data),
      ask: async (terminalId) => {
        await i18nReady;
        const window = options.getWindow();
        if (!window || window.isDestroyed()) return false;
        const result = await dialog.showMessageBox(window, {
          type: 'warning',
          title: i18n.t('guid.hubHome.secrets.title'),
          message: i18n.t('guid.hubHome.secrets.confirmTerminal', { terminal: terminalId }),
          buttons: [i18n.t('guid.hubHome.explorer.cancel'), i18n.t('guid.hubHome.explorer.approve')],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        return result.response === 1;
      },
    })
  );
  return () => configureTerminalSecretPort(undefined);
};
