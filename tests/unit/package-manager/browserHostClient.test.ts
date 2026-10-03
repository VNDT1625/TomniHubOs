import { afterEach, describe, expect, it, vi } from 'vitest';

const invokers = vi.hoisted(() => new Map<string, ReturnType<typeof vi.fn>>());

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: (channel: string) => {
      const invoke = vi.fn(() => new Promise<never>(() => {}));
      invokers.set(channel, invoke);
      return { invoke };
    },
    buildEmitter: () => ({ on: vi.fn(() => () => {}) }),
  },
}));

import {
  BROWSER_HOST_TIMEOUT_MS,
  BrowserHostTimeoutError,
  browserHostClient,
} from '@/common/packages/browserHostClient';

afterEach(() => {
  vi.useRealTimers();
  invokers.clear();
});

describe('browserHostClient', () => {
  it('fails closed when Browser is not installed and its fixed host is absent', async () => {
    vi.useFakeTimers();

    const pending = browserHostClient.openTab();
    const rejected = expect(pending).rejects.toBeInstanceOf(BrowserHostTimeoutError);
    await vi.advanceTimersByTimeAsync(BROWSER_HOST_TIMEOUT_MS);

    await rejected;
    expect(invokers.get('browser.open-tab')).toHaveBeenCalledWith({});
  });
});
