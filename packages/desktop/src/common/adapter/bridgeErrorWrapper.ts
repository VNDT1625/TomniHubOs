/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { bridge } from '@office-ai/platform';

let patched = false;

/**
 * Wraps @office-ai/platform bridge.buildProvider so that:
 * 1. Provider handler exceptions (e.g. ACCOUNT_EXECUTION_REJECTED) do not get dropped
 *    by the platform bridge's missing .catch() on r(n.data).then(), which causes
 *    renderer invoke() calls to hang indefinitely until timeout.
 * 2. Invoke calls safely detect error payloads and re-throw them as real Errors,
 *    allowing calling code (like PersonalSettings) to handle expected rejections immediately.
 */
export const patchPlatformBridge = (): void => {
  if (patched) return;
  patched = true;

  const mutableBridge = bridge as unknown as Record<string, unknown>;

  if (typeof bridge?.subscribe === 'function') {
    const rawSubscribe = bridge.subscribe.bind(bridge);
    mutableBridge.subscribe = (key: string, handler: (data: unknown) => unknown) => {
      return rawSubscribe(key, async (data: unknown) => {
        try {
          return await handler(data);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { __isBridgeError: true, message };
        }
      });
    };
  }

  if (typeof bridge?.invoke === 'function') {
    const rawInvoke = bridge.invoke.bind(bridge);
    mutableBridge.invoke = async <Data>(key: string, data?: unknown): Promise<Data> => {
      const result = await rawInvoke(key, data);
      if (result && typeof result === 'object' && '__isBridgeError' in result) {
        throw new Error((result as unknown as { message: string }).message);
      }
      return result as Data;
    };
  }

  if (typeof bridge?.buildProvider === 'function') {
    const rawBuildProvider = bridge.buildProvider.bind(bridge) as <Data, Params = undefined>(
      key: string
    ) => {
      provider: (handler: (params: Params) => Promise<Data> | Data) => void;
      invoke: (params: Params) => Promise<Data>;
    };
    mutableBridge.buildProvider = <Data, Params = undefined>(key: string) => {
      const channel = rawBuildProvider<Data, Params>(key);
      return {
        provider: (handler: (params: Params) => Promise<Data> | Data) => {
          channel.provider(async (params: Params) => {
            try {
              return await handler(params);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return { __isBridgeError: true, message } as unknown as Data;
            }
          });
        },
        invoke: async (params: Params): Promise<Data> => {
          const result = await channel.invoke(params);
          if (result && typeof result === 'object' && '__isBridgeError' in result) {
            throw new Error((result as unknown as { message: string }).message);
          }
          return result;
        },
      };
    };
  }
};

patchPlatformBridge();
