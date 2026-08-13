/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getOfficeCapabilities,
  insertText,
  registerConnector,
  registerOfficeCapabilityState,
  runOfficeScript,
  unregisterConnector,
  type OnlyOfficeConnector,
} from '@/renderer/pages/editor/adapters/onlyOfficeConnector';

const filePath = '/tmp/stalled.docx';

const makeConnector = (overrides: Partial<OnlyOfficeConnector> = {}): OnlyOfficeConnector => ({
  callCommand: vi.fn((_commandFn, callback) => callback?.('ok')),
  executeMethod: vi.fn((_name, _args, callback) => callback?.('ok')),
  disconnect: vi.fn(),
  ...overrides,
});

describe('onlyOfficeConnector timeout handling', () => {
  afterEach(() => {
    unregisterConnector(filePath);
    vi.useRealTimers();
  });

  it('reports a concrete fail-closed state without waiting for a connector', () => {
    registerOfficeCapabilityState(filePath, 'slide', {
      supported: false,
      reason: 'This Document Server build does not expose createConnector().',
    });

    const capabilities = getOfficeCapabilities(filePath);

    expect(capabilities).toMatchObject({
      kind: 'slide',
      editorReady: true,
      automationApi: { supported: false },
      objectAnimation: { supported: false },
      slideShowControl: { supported: false },
      recording: { supported: false },
    });
    expect(capabilities.automationApi.reason).toContain('createConnector');
  });

  it('reports Automation API support only after a live connector is registered', () => {
    registerConnector(filePath, makeConnector(), 'slide');

    const capabilities = getOfficeCapabilities(filePath);

    expect(capabilities.automationApi.supported).toBe(true);
    expect(capabilities.objectAnimation).toMatchObject({
      supported: true,
      reason: expect.stringMatching(/runtime-checks the ONLYOFFICE timeline APIs/i),
    });
  });

  it('rejects when a callCommand operation never invokes its callback', async () => {
    vi.useFakeTimers();
    registerConnector(
      filePath,
      makeConnector({
        callCommand: vi.fn(() => undefined),
      }),
      'word'
    );

    const pending = runOfficeScript(filePath, "return 'ok';");
    const assertion = expect(pending).rejects.toThrow(/Office editor command timed out after 12s/i);

    await vi.advanceTimersByTimeAsync(12000);
    await assertion;
  });

  it('rejects when an executeMethod operation never invokes its callback', async () => {
    vi.useFakeTimers();
    registerConnector(
      filePath,
      makeConnector({
        executeMethod: vi.fn(() => undefined),
      }),
      'word'
    );

    const pending = insertText(filePath, 'hello');
    const assertion = expect(pending).rejects.toThrow(/Office editor method "PasteText" timed out after 12s/i);

    await vi.advanceTimersByTimeAsync(12000);
    await assertion;
  });
});
