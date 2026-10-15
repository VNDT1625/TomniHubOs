/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parsePackageManifest } from '@/common/packages';
import { verifyArtifactSignature } from '@/process/extensions/package-manager/artifactSecurity';
import { buildPackageProject } from '../../scripts/package-apps/packageProject';
import { createPackageCapabilityBroker } from '@/process/resources/packageCapability/broker';
import { createLocalModelInvocationBroker } from '@/process/resources/packageCapability/localModelInvocationBroker';
import {
  createPackageRuntimeRegistry,
  registerTrustedPackageModelInvokeIpcBridge,
} from '@/process/extensions/package-manager/packageBridge';
import { PACKAGE_MODEL_INVOKE_NATIVE_CHANNELS } from '@/common/types/platform/electron';

// @ts-expect-error JS module without declaration
import * as modelProviderJs from '../../packages/package-apps/ai-challenge/payload/modelProvider.js';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('AI Challenge Local Model Journey Integration Test', () => {
  const packageDir = path.resolve('packages/package-apps/ai-challenge');

  it('completes full signed package build, Main loopback invocation, and deterministic fallback journey', async () => {
    // 1. Build and verify the signed package artifact
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'ai-challenge-journey-'));
    roots.push(outputDir);

    const keys = generateKeyPairSync('ed25519');
    const keyPath = path.join(outputDir, 'private.pem');
    await writeFile(keyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));

    const buildResult = await buildPackageProject({
      projectDirectory: packageDir,
      outputDirectory: outputDir,
      privateKeyPath: keyPath,
      keyId: 'test-key',
    });

    const archive = await JSZip.loadAsync(await readFile(buildResult.artifactPath));
    const manifest = parsePackageManifest(
      JSON.parse(await archive.file('tomny-package.json')!.async('string'))
    );

    // Verify first-party signing & permissions
    verifyArtifactSignature(manifest, {
      'test-key': keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });
    expect(manifest.id).toBe('com.tomni.ai-challenge');
    expect(manifest.publisherId).toBe('com.tomni');
    expect(manifest.permissions).toContain('model.invoke');
    expect(manifest.permissions).toContain('sidebar.sessions');

    // 2. Setup Main Process Model Broker & IPC Bridge
    const registry = createPackageRuntimeRegistry();
    const runtimeId = 'rt-journey-1';
    const ownerId = 'win-journey-1';
    registry.open(ownerId, {
      packageId: 'com.tomni.ai-challenge',
      packageVersion: '1.0.0',
      publisherId: 'com.tomni',
      moduleId: 'arena',
      runtimeId,
      surface: 'apps/ai-challenge',
      title: 'AI Challenge Arena',
    });

    const fetchCalls: { url: string; method?: string; body?: unknown }[] = [];
    let completionResponse = JSON.stringify({
      id: 'chatcmpl-test',
      choices: [
        {
          message: {
            role: 'assistant',
            content:
              '{"movement":"dash_forward","combat":"heavy_smash","elementSkill":"elemental_burst","reason":"Burst combo on opening"}',
          },
        },
      ],
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(input);
      fetchCalls.push({ url: urlStr, method: init?.method, body: init?.body });

      if (urlStr.endsWith('/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'qwen2.5:7b' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (urlStr.endsWith('/chat/completions')) {
        return new Response(completionResponse, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not found', { status: 404 });
    });

    const modelBroker = createLocalModelInvocationBroker({
      isPackageActive: (pkgId) => pkgId === 'com.tomni.ai-challenge',
      endpoint: 'http://127.0.0.1:11434/v1',
      fetchImpl: fetchMock,
    });

    const service = {
      status: vi.fn(async (_id: string) => ({
        state: 'installed' as const,
        enabled: true,
        installedTrust: 'signed-first-party' as const,
        installedManifest: manifest,
      })),
    };

    const ipcHandlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>();
    const mockHost = {
      handle: (channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => {
        ipcHandlers.set(channel, handler);
      },
      removeHandler: (channel: string) => {
        ipcHandlers.delete(channel);
      },
    };

    const trustedSender = { id: 101, url: 'http://localhost:5173/#apps/ai-challenge' };

    const cleanupBridge = registerTrustedPackageModelInvokeIpcBridge({
      host: mockHost,
      service,
      registry,
      modelBroker,
      verifySender: (event) => (event as { sender?: { id?: number } })?.sender?.id === 101,
      identifySender: (event) => ((event as { sender?: { id?: number } })?.sender?.id === 101 ? ownerId : undefined),
    });

    const invokeHandler = ipcHandlers.get(PACKAGE_MODEL_INVOKE_NATIVE_CHANNELS.invoke);
    expect(invokeHandler).toBeDefined();

    // 3. Journey Happy Path: Model Invocations from Renderer to Main
    const invokePayload = {
      version: 1,
      packageId: 'com.tomni.ai-challenge',
      runtimeId,
      requestId: 'req-turn-1',
      contract: 'ai-challenge.turn.v1',
      prompt: 'Observation: enemy distance 4m. Choose action in JSON.',
      temperature: 0.2,
      maxTokens: 128,
    };

    const invokeResult = (await invokeHandler!(
      { sender: trustedSender },
      invokePayload
    )) as { ok: boolean; data?: { text: string; model: string } };

    expect(invokeResult.ok).toBe(true);
    expect(invokeResult.data?.model).toBe('qwen2.5:7b');

    // Verify Main loopback requests occurred
    expect(fetchCalls.length).toBeGreaterThanOrEqual(2);
    expect(fetchCalls[0].url).toBe('http://127.0.0.1:11434/v1/models');
    expect(fetchCalls[1].url).toBe('http://127.0.0.1:11434/v1/chat/completions');

    // Verify Sandbox client parses and produces legal game action
    const parsedAction = modelProviderJs.parseModelOutput(invokeResult.data!.text);
    expect(parsedAction).toEqual({
      action: {
        movement: 'dash_forward',
        combat: 'heavy_smash',
        elementSkill: 'elemental_burst',
      },
      reason: 'Burst combo on opening',
    });

    // 4. Journey Fallback: Model returns invalid action -> Sandbox falls back to deterministic script bot
    completionResponse = JSON.stringify({
      id: 'chatcmpl-invalid',
      choices: [
        {
          message: {
            role: 'assistant',
            content: '{"movement":"illegal_teleport","combat":"laser_cannon"}',
          },
        },
      ],
    });

    const invalidInvokeResult = (await invokeHandler!(
      { sender: trustedSender },
      { ...invokePayload, requestId: 'req-turn-2' }
    )) as { ok: boolean; data?: { text: string } };

    expect(invalidInvokeResult.ok).toBe(true);
    const invalidParsed = modelProviderJs.parseModelOutput(invalidInvokeResult.data!.text);
    expect(invalidParsed).toBeNull(); // Rejected by legal actions validator

    // Deterministic fallback bot produces legal candidate under 5ms
    const observation = {
      distance: 3,
      myMech: { hp: 100, energy: 60 },
      opponentMech: { hp: 100, status: 'idle' },
      coachDirective: 'Bật khiên phòng thủ!',
    };
    const fallbackAction = modelProviderJs.computeScriptBotAction(observation);
    expect(fallbackAction).toEqual({
      movement: 'hold',
      combat: 'block',
      elementSkill: null,
    });

    // 5. Lifecycle Invalidation & Cleanup
    registry.close(ownerId, { packageId: 'com.tomni.ai-challenge', runtimeId });

    // Invocations after runtime closed are rejected
    const postCloseResult = (await invokeHandler!(
      { sender: trustedSender },
      { ...invokePayload, requestId: 'req-turn-3' }
    )) as { ok: boolean; code: string };

    expect(postCloseResult.ok).toBe(false);
    expect(postCloseResult.code).toBe('PACKAGE_CAPABILITY_SYSCALL_DENIED');

    cleanupBridge();
    expect(ipcHandlers.size).toBe(0);
  });
});
