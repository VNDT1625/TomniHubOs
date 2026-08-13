/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

export const TOMNY_SIDECAR_PROTOCOL = 'tomny.runtime.v1';
export const TOMNY_SIDECAR_PROTOCOL_VERSION = 1;

export type SidecarRequestId = string;

export type SidecarMethod =
  | 'core.initialize'
  | 'core.cancel'
  | 'health.check'
  | 'hash.sha256'
  | 'journal.append'
  | 'journal.query'
  | 'process.spawn'
  | 'process.status'
  | 'process.terminate'
  | (string & {});

export type SidecarRequest = {
  protocol: typeof TOMNY_SIDECAR_PROTOCOL;
  id: SidecarRequestId;
  method: SidecarMethod;
  params?: unknown;
};

export type SidecarResponse = {
  protocol: typeof TOMNY_SIDECAR_PROTOCOL;
  id: SidecarRequestId;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; details?: unknown };
};

export type SidecarInitializeResult = {
  protocol: typeof TOMNY_SIDECAR_PROTOCOL;
  protocolVersion: number;
  runtimeVersion: string;
  capabilities: string[];
};

export type SidecarRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type SidecarFallbackResult<T> = { source: 'rust'; value: T } | { source: 'typescript'; value: T; cause: Error };

export type SidecarRestartPolicy = 'never' | 'on-demand';
