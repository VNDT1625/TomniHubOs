import type { SecretContextStoredCallback } from './router';
import { createSecretContextUseRouter, type SecretContextUseRouter } from './router';
import type { SecretVault } from '@process/agentRuntime/secretVault';
import { createSecretDestinationSinks } from './sinks';

let sharedRouter: SecretContextUseRouter | undefined;
let sharedVault: SecretVault | undefined;
let sharedStoredCallback: SecretContextStoredCallback | undefined;

const registerDestinationSinks = (router: SecretContextUseRouter, vault: SecretVault): void => {
  for (const [name, sink] of Object.entries(createSecretDestinationSinks(vault))) {
    router.registerSink(name, sink, true);
  }
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
    });
    if (sharedVault) registerDestinationSinks(sharedRouter, sharedVault);
  }
  return sharedRouter;
};

export const resetSecretContextUseRouterForTests = (): void => {
  sharedRouter = undefined;
  sharedVault = undefined;
  sharedStoredCallback = undefined;
};
