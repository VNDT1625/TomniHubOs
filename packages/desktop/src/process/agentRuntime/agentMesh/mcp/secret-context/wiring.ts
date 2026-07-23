import type { SecretContextSink, SecretContextStoredCallback } from './router';
import { createSecretContextUseRouter, type SecretContextUseRouter } from './router';
import type { SecretVault } from '@process/agentRuntime/secretVault';
import { captureBrowserSecretValue } from './browserCapture';
import { createSecretDestinationSinks } from './sinks';

let sharedRouter: SecretContextUseRouter | undefined;
let sharedVault: SecretVault | undefined;
let sharedStoredCallback: SecretContextStoredCallback | undefined;

const registerDestinationSinks = (router: SecretContextUseRouter, vault: SecretVault): void => {
  for (const [name, sink] of Object.entries(createSecretDestinationSinks(vault))) {
    router.registerSink(name, sink, true);
  }
};

const browserFillSink: SecretContextSink = async (request) => {
  if (request.surface !== 'browser' || request.purpose !== 'browser-fill') throw new Error('Unsupported route.');
  const tabId = request.locator.tabId;
  const selector = request.locator.selector;
  if (!tabId || !selector || !request.target) throw new Error('Incomplete route.');

  const [{ getApplicationMainWindow }, { getBrowserControlDeps }] = await Promise.all([
    import('@process/bridge/applicationBridge'),
    import('@process/browser/browserControlWiring'),
  ]);
  const browser = getBrowserControlDeps(getApplicationMainWindow);
  const contents = browser.viewManager.getWebContents(tabId);
  if (!contents) throw new Error('Unavailable browser target.');

  let actualTarget = '';
  try {
    actualTarget = new URL(contents.getURL()).hostname.toLowerCase();
  } catch {
    throw new Error('Unavailable browser target.');
  }
  if (!actualTarget || actualTarget !== request.target.toLowerCase()) throw new Error('Browser target mismatch.');
  if (!browser.fillPersonalSecret) throw new Error('Secret sink unavailable.');

  await browser.fillPersonalSecret({
    tabId,
    selector,
    handle: request.handle,
    field: request.field,
    expectedTarget: request.target,
  });
};

const browserCapture = async (request: {
  tabId: string;
  selector: string;
  target: string;
  field: string;
}): Promise<string> => {
  const [{ getApplicationMainWindow }, { getBrowserControlDeps }, { getBrowserSecretRedactionRegistry }] =
    await Promise.all([
      import('@process/bridge/applicationBridge'),
      import('@process/browser/browserControlWiring'),
      import('@process/browser/pagePerception'),
    ]);
  const browser = getBrowserControlDeps(getApplicationMainWindow);
  const contents = browser.viewManager.getWebContents(request.tabId);
  if (!contents) throw new Error('Secret capture failed.');
  const value = await captureBrowserSecretValue(contents, request);
  const registry = getBrowserSecretRedactionRegistry();
  registry.registerSelector({
    tabId: request.tabId,
    hostname: request.target,
    selector: request.selector,
    name: request.field,
  });
  registry.enableSensitiveMode({ tabId: request.tabId, hostname: request.target });
  return value;
};

/** Bind the encrypted Core vault to trusted capture/generation operations. */
export const configureSecretContextVault = (vault: SecretVault): void => {
  sharedVault = vault;
  if (sharedRouter) {
    sharedRouter.configureVault(vault);
    registerDestinationSinks(sharedRouter, vault);
  }
};

/** Subscribe to newly persisted descriptor metadata; plaintext is never included. */
export const configureSecretContextStoredCallback = (callback: SecretContextStoredCallback): void => {
  sharedStoredCallback = callback;
  sharedRouter?.configureStoredCallback(callback);
};

/** Register trusted sinks once; additional host capabilities can extend this registry later. */
export const getSecretContextUseRouter = (): SecretContextUseRouter => {
  if (!sharedRouter) {
    sharedRouter = createSecretContextUseRouter({
      ...(sharedVault ? { vault: sharedVault } : {}),
      ...(sharedStoredCallback ? { onSecretStored: sharedStoredCallback } : {}),
      captureBrowserValue: browserCapture,
    });
    sharedRouter.registerSink('browser.fill', browserFillSink);
    if (sharedVault) registerDestinationSinks(sharedRouter, sharedVault);
  }
  return sharedRouter;
};

export const resetSecretContextUseRouterForTests = (): void => {
  sharedRouter = undefined;
  sharedVault = undefined;
  sharedStoredCallback = undefined;
};
