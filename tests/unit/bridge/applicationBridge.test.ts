/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, shell: {} }));
vi.mock('@/common', () => ({ ipcBridge: {} }));
vi.mock('@process/utils/initStorage', () => ({ ProcessConfig: {} }));
vi.mock('@process/utils/zoom', () => ({ getZoomFactor: vi.fn(), setZoomFactor: vi.fn() }));
vi.mock('@process/utils/configureChromium', () => ({ getCdpStatus: vi.fn(), updateCdpConfig: vi.fn() }));
vi.mock('@process/utils/gpuRecovery', () => ({ getGpuStatus: vi.fn(), setGpuUserOverride: vi.fn() }));
vi.mock('@process/services/security/systemEgressAuthority', () => ({ systemEgressAuthority: {} }));
vi.mock('@process/startup/appTermination', () => ({ requestAppRestart: vi.fn() }));
vi.mock('@process/bridge/applicationBridgeCore', () => ({ initApplicationBridgeCore: vi.fn() }));
vi.mock('@process/bridge/defaultBrowser', () => ({ getDefaultBrowserStatus: vi.fn(), setAsDefaultBrowser: vi.fn() }));

import { normalizeExternalHandoffUrl } from '@process/bridge/applicationBridge';

describe('normalizeExternalHandoffUrl', () => {
  it('permits credential-free HTTPS and literal loopback HTTP handoffs', () => {
    expect(normalizeExternalHandoffUrl('https://example.com/docs?topic=trust')).toBe(
      'https://example.com/docs?topic=trust'
    );
    expect(normalizeExternalHandoffUrl('http://127.0.0.1:13400/status')).toBe('http://127.0.0.1:13400/status');
    expect(normalizeExternalHandoffUrl('http://[::1]:13400/status')).toBe('http://[::1]:13400/status');
  });

  it('normalizes the legacy ChatGPT handoff to HTTPS before opening it', () => {
    expect(normalizeExternalHandoffUrl('chatgpt://share/example')).toBe('https://chatgpt.com/share/example');
  });

  it.each([
    'http://example.com/',
    'http://localhost:13400/',
    'https://user:secret@example.com/',
    'https://example.com/#fragment',
    'file:///C:/sensitive.txt',
    'vscode://file/C:/workspace',
    'javascript:alert(1)',
    ' https://example.com/',
  ])('rejects non-handoff URL %s', (value) => {
    expect(() => normalizeExternalHandoffUrl(value)).toThrow('External URL is not permitted.');
  });
});
