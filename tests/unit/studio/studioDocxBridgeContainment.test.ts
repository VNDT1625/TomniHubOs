import { beforeEach, describe, expect, it, vi } from 'vitest';

type ProviderHandler = (input: unknown) => unknown;

const registered = new Map<string, ProviderHandler>();

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: (channel: string) => ({
      provider: (handler: ProviderHandler) => registered.set(channel, handler),
      invoke: vi.fn(),
    }),
  },
}));

import {
  registerStudioDocxBridge,
  STUDIO_DOCX_WRITE_GOVERNANCE_REQUIRED,
} from '@package-apps/document-studio/process/studioDocxBridge';

const invoke = async (channel: string, input: unknown): Promise<unknown> => {
  const handler = registered.get(channel);
  if (!handler) throw new Error(`No provider registered for ${channel}`);
  return handler(input);
};

beforeEach(() => {
  registered.clear();
  registerStudioDocxBridge();
});

describe('Studio DOCX bridge containment', () => {
  it('keeps the write channel registered but rejects before path or document content is processed', async () => {
    await expect(invoke('studio.docx-write', { path: 'C:/unsafe.docx', text: 'unsafe' })).resolves.toEqual({
      ok: false,
      error: STUDIO_DOCX_WRITE_GOVERNANCE_REQUIRED,
    });
  });
});
