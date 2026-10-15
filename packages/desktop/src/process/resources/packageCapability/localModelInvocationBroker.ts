/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type {
  PackageCapabilityErrorCode,
  PackageCapabilityReceipt,
} from '@/common/packages';
import type {
  PackageModelInvokeNativeCancelRequest,
  PackageModelInvokeNativeRequest,
  PackageModelInvokeNativeResult,
} from '@/common/types/platform/electron';
import { validateLoopbackOpenAiEndpoint } from '@process/experimentalCore/adapters/loopbackOpenAiAdapter';

const DEFAULT_LOOPBACK_ENDPOINT = 'http://127.0.0.1:11434/v1';
const ALLOWED_PACKAGE_ID = 'com.tomni.ai-challenge';
const ALLOWED_CONTRACT = 'ai-challenge.turn.v1';
const INVOCATION_DEADLINE_MS = 1_500;
const MAX_PROMPT_CHARS = 16_384;
const MAX_SYSTEM_PROMPT_CHARS = 4_096;
const MAX_RESPONSE_TEXT_CHARS = 2_048;
const MAX_ATTEMPTS_PER_MINUTE = 40;
const MODEL_CACHE_TTL_MS = 15_000;

export type LocalModelInvocationBrokerDeps = Readonly<{
  isPackageActive: (packageId: string) => boolean;
  verifyLease?: (leaseId: string, packageId: string, runtimeId: string, capability: 'model.invoke') => boolean;
  endpoint?: string;
  defaultModel?: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
  createId?: () => string;
}>;

export type LocalModelInvocationBroker = Readonly<{
  invoke: (request: PackageModelInvokeNativeRequest) => Promise<PackageModelInvokeNativeResult>;
  cancel: (request: PackageModelInvokeNativeCancelRequest) => boolean;
  abortRuntime: (packageId: string, runtimeId: string) => void;
  dispose: () => void;
}>;

type InFlightInvocation = {
  requestId: string;
  controller: AbortController;
  startedAt: number;
};

export const createLocalModelInvocationBroker = (
  deps: LocalModelInvocationBrokerDeps
): LocalModelInvocationBroker => {
  const now = deps.now ?? Date.now;
  const createId = deps.createId ?? randomUUID;
  const fetchFn = deps.fetchImpl ?? globalThis.fetch;

  const inFlightByRuntime = new Map<string, InFlightInvocation>();
  const recentAttemptsByRuntime = new Map<string, number[]>();
  let cachedModels: { list: string[]; fetchedAt: number } | undefined;

  const getRuntimeKey = (packageId: string, runtimeId: string): string => `${packageId}:${runtimeId}`;

  const checkRateLimit = (runtimeKey: string): boolean => {
    const currentTime = now();
    const attempts = recentAttemptsByRuntime.get(runtimeKey) ?? [];
    const windowStart = currentTime - 60_000;
    const filtered = attempts.filter((timestamp) => timestamp > windowStart);
    if (filtered.length >= MAX_ATTEMPTS_PER_MINUTE) {
      recentAttemptsByRuntime.set(runtimeKey, filtered);
      return false;
    }
    filtered.push(currentTime);
    recentAttemptsByRuntime.set(runtimeKey, filtered);
    return true;
  };

  const createReceipt = (
    packageId: string,
    runtimeId: string,
    status: PackageCapabilityReceipt['status']
  ): PackageCapabilityReceipt => ({
    receiptId: createId(),
    packageId,
    runtimeId,
    capability: 'model.invoke',
    syscall: 'model.invoke',
    status,
    recordedAt: new Date(now()).toISOString(),
  });

  const discoverModel = async (
    endpoint: URL,
    signal: AbortSignal
  ): Promise<string | undefined> => {
    if (deps.defaultModel) return deps.defaultModel;
    if (process.env.TOMNY_LOCAL_OPENAI_MODEL) return process.env.TOMNY_LOCAL_OPENAI_MODEL;

    if (cachedModels && now() - cachedModels.fetchedAt < MODEL_CACHE_TTL_MS && cachedModels.list.length > 0) {
      return cachedModels.list[0];
    }

    const modelsUrl = `${endpoint.toString().replace(/\/+$/u, '')}/models`;
    try {
      const response = await fetchFn(modelsUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal,
      });
      if (!response.ok) return undefined;
      const data = (await response.json()) as { data?: Array<{ id?: unknown }> };
      const modelList = Array.isArray(data?.data)
        ? data.data
            .map((item) => (typeof item?.id === 'string' ? item.id.trim() : ''))
            .filter((id) => id.length > 0)
        : [];
      if (modelList.length > 0) {
        cachedModels = { list: modelList, fetchedAt: now() };
        return modelList[0];
      }
    } catch {
      return undefined;
    }
    return undefined;
  };

  return {
    invoke: async (request: PackageModelInvokeNativeRequest): Promise<PackageModelInvokeNativeResult> => {
      const startedAt = now();
      const requestId = typeof request?.requestId === 'string' ? request.requestId.trim() : '';
      if (!requestId || requestId.length > 128) {
        return { ok: false, requestId: request?.requestId ?? '', code: 'PACKAGE_CAPABILITY_REQUEST_INVALID' };
      }

      if (request.packageId !== ALLOWED_PACKAGE_ID) {
        return { ok: false, requestId, code: 'PACKAGE_CAPABILITY_NOT_DECLARED' };
      }
      if (request.contract !== ALLOWED_CONTRACT) {
        return { ok: false, requestId, code: 'PACKAGE_CAPABILITY_REQUEST_INVALID' };
      }

      const prompt = typeof request.prompt === 'string' ? request.prompt.trim() : '';
      if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
        return { ok: false, requestId, code: 'PACKAGE_CAPABILITY_REQUEST_INVALID' };
      }

      const systemPrompt = typeof request.systemPrompt === 'string' ? request.systemPrompt.trim() : undefined;
      if (systemPrompt && systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS) {
        return { ok: false, requestId, code: 'PACKAGE_CAPABILITY_REQUEST_INVALID' };
      }

      if (!deps.isPackageActive(request.packageId)) {
        return { ok: false, requestId, code: 'PACKAGE_CAPABILITY_PACKAGE_INACTIVE' };
      }

      if (request.leaseId && deps.verifyLease) {
        const isLeaseValid = deps.verifyLease(request.leaseId, request.packageId, request.runtimeId, 'model.invoke');
        if (!isLeaseValid) {
          return { ok: false, requestId, code: 'PACKAGE_CAPABILITY_LEASE_UNAVAILABLE' };
        }
      }

      const runtimeKey = getRuntimeKey(request.packageId, request.runtimeId);
      if (inFlightByRuntime.has(runtimeKey)) {
        return { ok: false, requestId, code: 'PACKAGE_CAPABILITY_MODEL_BUSY' };
      }

      if (!checkRateLimit(runtimeKey)) {
        return { ok: false, requestId, code: 'PACKAGE_CAPABILITY_MODEL_BUSY' };
      }

      let endpointUrl: URL;
      try {
        const rawEndpoint = deps.endpoint ?? process.env.TOMNY_LOCAL_OPENAI_URL ?? DEFAULT_LOOPBACK_ENDPOINT;
        endpointUrl = validateLoopbackOpenAiEndpoint(rawEndpoint);
      } catch {
        return { ok: false, requestId, code: 'PACKAGE_CAPABILITY_MODEL_UNAVAILABLE' };
      }

      const controller = new AbortController();
      const inFlight: InFlightInvocation = {
        requestId,
        controller,
        startedAt,
      };
      inFlightByRuntime.set(runtimeKey, inFlight);

      const timeoutId = setTimeout(() => {
        controller.abort(new Error('INVOCATION_TIMEOUT'));
      }, INVOCATION_DEADLINE_MS);

      try {
        const model = await discoverModel(endpointUrl, controller.signal);
        if (!model) {
          return { ok: false, requestId, code: 'PACKAGE_CAPABILITY_MODEL_UNAVAILABLE' };
        }

        const completionsUrl = `${endpointUrl.toString().replace(/\/+$/u, '')}/chat/completions`;
        const messages = [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: prompt },
        ];

        const response = await fetchFn(completionsUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: typeof request.temperature === 'number' ? Math.max(0, Math.min(2, request.temperature)) : 0.2,
            max_tokens: typeof request.maxTokens === 'number' ? Math.max(1, Math.min(512, request.maxTokens)) : 128,
            stream: false,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          return { ok: false, requestId, code: 'PACKAGE_CAPABILITY_MODEL_UNAVAILABLE' };
        }

        const rawJson = (await response.json()) as {
          choices?: Array<{ message?: { content?: unknown } }>;
        };

        const rawContent = rawJson?.choices?.[0]?.message?.content;
        if (typeof rawContent !== 'string' || !rawContent.trim()) {
          return { ok: false, requestId, code: 'PACKAGE_CAPABILITY_MODEL_INVALID' };
        }

        const sanitizedText = rawContent.trim().slice(0, MAX_RESPONSE_TEXT_CHARS);
        const elapsedMs = now() - startedAt;

        const receipt = createReceipt(request.packageId, request.runtimeId, 'completed');
        return {
          ok: true,
          requestId,
          data: {
            schemaVersion: 1,
            contract: ALLOWED_CONTRACT,
            text: sanitizedText,
            elapsedMs,
            model,
          },
          receipt,
        };
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          const reason = controller.signal.reason;
          if (reason instanceof Error && reason.message === 'INVOCATION_TIMEOUT') {
            return { ok: false, requestId, code: 'PACKAGE_CAPABILITY_MODEL_TIMEOUT' };
          }
          return { ok: false, requestId, code: 'PACKAGE_CAPABILITY_LEASE_REVOKED' };
        }
        return { ok: false, requestId, code: 'PACKAGE_CAPABILITY_MODEL_UNAVAILABLE' };
      } finally {
        clearTimeout(timeoutId);
        if (inFlightByRuntime.get(runtimeKey) === inFlight) {
          inFlightByRuntime.delete(runtimeKey);
        }
      }
    },

    cancel: (request: PackageModelInvokeNativeCancelRequest): boolean => {
      const runtimeKey = getRuntimeKey(request.packageId, request.runtimeId);
      const active = inFlightByRuntime.get(runtimeKey);
      if (active && active.requestId === request.requestId) {
        active.controller.abort(new Error('CANCELLED_BY_CLIENT'));
        inFlightByRuntime.delete(runtimeKey);
        return true;
      }
      return false;
    },

    abortRuntime: (packageId: string, runtimeId: string): void => {
      const runtimeKey = getRuntimeKey(packageId, runtimeId);
      const active = inFlightByRuntime.get(runtimeKey);
      if (active) {
        active.controller.abort(new Error('RUNTIME_ABORTED'));
        inFlightByRuntime.delete(runtimeKey);
      }
    },

    dispose: (): void => {
      for (const active of inFlightByRuntime.values()) {
        active.controller.abort(new Error('BROKER_DISPOSED'));
      }
      inFlightByRuntime.clear();
      recentAttemptsByRuntime.clear();
    },
  };
};
