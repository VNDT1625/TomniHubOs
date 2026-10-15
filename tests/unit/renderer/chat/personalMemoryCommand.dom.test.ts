/**
 * @license
 * Copyright 2026 Tomny
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

const message = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('@arco-design/web-react', () => ({ Message: message }));
vi.mock('i18next', () => ({
  default: { t: (key: string, options?: { count?: number }) => (options ? `${key}:${options.count}` : key) },
}));
vi.mock('@/common', () => ({ ipcBridge: { personal: {} } }));

import { handlePersonalMemoryCommand } from '@/renderer/services/personalMemoryCommand';
import type { PersonalContext } from '@process/agentRuntime/contextTypes';

const emptyProfile = { id: 'default', facts: [], preferences: [], habits: [] } as unknown as PersonalContext;

describe('memory commands typed in the message box', () => {
  it('lets ordinary messages through', () => {
    expect(handlePersonalMemoryCommand('remember me')).toBe(false);
  });

  it('saves and confirms /remember without sending it to the model', async () => {
    const save = vi.fn(async () => undefined);
    const api = { get: async () => emptyProfile, save, forgetLearning: vi.fn() };
    expect(handlePersonalMemoryCommand('/remember I use pnpm', api)).toBe(true);
    await vi.waitFor(() => expect(message.success).toHaveBeenCalledWith('messages.memoryCommand.remembered'));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('reports a failure instead of pretending it worked', async () => {
    const api = { get: async () => Promise.reject(new Error('offline')), save: vi.fn(), forgetLearning: vi.fn() };
    expect(handlePersonalMemoryCommand('/forget pnpm', api)).toBe(true);
    await vi.waitFor(() => expect(message.error).toHaveBeenCalledWith('messages.memoryCommand.failed'));
  });
});
