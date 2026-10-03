/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fsp } from 'node:fs';
import { bridge } from '@office-ai/platform';
import type { BrowserWindow } from 'electron';
import type { ViuProjectState, ViuTransaction, ViuTransactionResult } from '@/common/viu';
import { getBrowserServices } from '@process/browser/browserBridge';
import {
  ViuLocalAssetService,
  type ViuLocalAssetInput,
  type ViuLocalAssetRef,
} from '@package-apps/design/process/viu/assets/index';
import { captureSiteProject } from '@package-apps/design/process/viu/capture';
import { persistViuContract } from '@package-apps/design/process/viu/contract';
import { createPromptProject } from '@package-apps/design/process/viu/design';
import { analyzeImageProject } from '@package-apps/design/process/viu/image';
import type {
  ViuCaptureRequest,
  ViuCreateRequest,
  ViuImageRequest,
  ViuPersistRequest,
  ViuPersistResult,
  ViuProject,
  ViuResult,
} from '@package-apps/design/process/viu/types';
import { viuV2SessionService, type ViuSessionValidation } from '@package-apps/design/process/viu/v2SessionService';

export type ViuV2WorkspaceRequest = { workspaceKey: string };
export type ViuV2TransactionRequest = ViuV2WorkspaceRequest & { transaction: ViuTransaction };
export type ViuAssetGrantRequest = ViuV2WorkspaceRequest & ViuLocalAssetInput;

export const VIU_CHANNELS = {
  create: 'ide.viu.create',
  capture: 'ide.viu.capture',
  analyzeImage: 'ide.viu.analyze-image',
  persist: 'ide.viu.persist',
  v2Inspect: 'ide.viu.v2.inspect',
  v2Preview: 'ide.viu.v2.preview',
  v2Commit: 'ide.viu.v2.commit',
  v2Validate: 'ide.viu.v2.validate',
  assetGrant: 'ide.viu.asset.grant',
  assetList: 'ide.viu.asset.list',
} as const;

export const viuChannels = {
  create: bridge.buildProvider<ViuResult<ViuProject>, ViuCreateRequest>(VIU_CHANNELS.create),
  capture: bridge.buildProvider<ViuResult<ViuProject>, ViuCaptureRequest>(VIU_CHANNELS.capture),
  analyzeImage: bridge.buildProvider<ViuResult<ViuProject>, ViuImageRequest>(VIU_CHANNELS.analyzeImage),
  persist: bridge.buildProvider<ViuResult<ViuPersistResult & { agentPrompt: string }>, ViuPersistRequest>(
    VIU_CHANNELS.persist
  ),
  v2Inspect: bridge.buildProvider<ViuResult<ViuProjectState>, ViuV2WorkspaceRequest>(VIU_CHANNELS.v2Inspect),
  v2Preview: bridge.buildProvider<ViuResult<ViuTransactionResult>, ViuV2TransactionRequest>(VIU_CHANNELS.v2Preview),
  v2Commit: bridge.buildProvider<ViuResult<ViuTransactionResult>, ViuV2TransactionRequest>(VIU_CHANNELS.v2Commit),
  v2Validate: bridge.buildProvider<ViuResult<ViuSessionValidation>, ViuV2WorkspaceRequest>(VIU_CHANNELS.v2Validate),
  assetGrant: bridge.buildProvider<ViuResult<ViuLocalAssetRef>, ViuAssetGrantRequest>(VIU_CHANNELS.assetGrant),
  assetList: bridge.buildProvider<ViuResult<ViuLocalAssetRef[]>, ViuV2WorkspaceRequest>(VIU_CHANNELS.assetList),
};

export type RegisterViuBridgeOptions = {
  getWindow: () => BrowserWindow | null | undefined;
};

const localAssetSessions = new Map<string, ViuLocalAssetService>();
const assetServiceFor = (workspaceKey: string): ViuLocalAssetService => {
  const key = workspaceKey.trim();
  if (!key || key.includes('\0')) throw new Error('A valid VIU workspace key is required.');
  const existing = localAssetSessions.get(key);
  if (existing) return existing;
  const created = new ViuLocalAssetService({
    realpath: (path) => fsp.realpath(path),
    stat: (path) => fsp.stat(path),
  });
  localAssetSessions.set(key, created);
  return created;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Register the native Viu engine used by both the Studio entry and IDE tab. */
export const registerViuBridge = ({ getWindow }: RegisterViuBridgeOptions): void => {
  let captureBusy = false;

  viuChannels.create.provider(async (request) => {
    try {
      return { ok: true, data: createPromptProject(request) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });

  viuChannels.analyzeImage.provider(async (request) => {
    try {
      return { ok: true, data: await analyzeImageProject(request) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });

  viuChannels.capture.provider(async (request) => {
    if (captureBusy) return { ok: false, error: 'Another Viu capture is already running.' };
    captureBusy = true;
    try {
      const services = getBrowserServices(getWindow);
      return { ok: true, data: await captureSiteProject(services.viewManager, request) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    } finally {
      captureBusy = false;
    }
  });

  viuChannels.persist.provider(async (request) => {
    try {
      return { ok: true, data: await persistViuContract(request) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });

  viuChannels.v2Inspect.provider(async ({ workspaceKey }) => {
    try {
      return { ok: true, data: viuV2SessionService.inspect(workspaceKey) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });

  viuChannels.v2Preview.provider(async ({ workspaceKey, transaction }) => {
    try {
      return { ok: true, data: viuV2SessionService.previewTransaction(workspaceKey, transaction) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });

  viuChannels.v2Commit.provider(async ({ workspaceKey, transaction }) => {
    try {
      return { ok: true, data: viuV2SessionService.commitTransaction(workspaceKey, transaction) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });

  viuChannels.v2Validate.provider(async ({ workspaceKey }) => {
    try {
      return { ok: true, data: viuV2SessionService.validate(workspaceKey) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });

  viuChannels.assetGrant.provider(async ({ workspaceKey, ...input }) => {
    try {
      return { ok: true, data: await assetServiceFor(workspaceKey).grant(input) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });

  viuChannels.assetList.provider(async ({ workspaceKey }) => {
    try {
      return { ok: true, data: assetServiceFor(workspaceKey).listAssetRefs() };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  });
};
