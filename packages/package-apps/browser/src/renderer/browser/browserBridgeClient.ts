/**
 * Browser package compatibility export. The fixed host client is a Core ABI SDK;
 * Browser UI remains package-owned.
 */

import {
  browserHostClient,
  type AgentEvent,
  type BrowserTabInfo,
  type DefaultBrowserStatus,
  type RunAgentBridgeResult,
  type TabUpdate,
} from '@/common/packages/browserHostClient';

export const browserClient = browserHostClient;

export type { AgentEvent, BrowserTabInfo, DefaultBrowserStatus, RunAgentBridgeResult, TabUpdate };
