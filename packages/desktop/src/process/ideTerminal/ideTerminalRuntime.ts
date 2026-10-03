/** Always-on terminal capability for the default IDE surface. */

import { disposeTerminalBridge, registerTerminalBridge } from './terminalBridge';
import { disposeTerminalServices, getTerminalServices } from './terminalWiring';

let started = false;

export const startIdeTerminalRuntime = async (): Promise<void> => {
  if (started) return;
  const services = getTerminalServices();
  registerTerminalBridge({ services });
  try {
    await services.scheduler.start();
    started = true;
  } catch (error) {
    disposeTerminalBridge();
    disposeTerminalServices();
    throw error;
  }
};

export const stopIdeTerminalRuntime = (): void => {
  if (!started) return;
  started = false;
  disposeTerminalBridge();
  disposeTerminalServices();
};
