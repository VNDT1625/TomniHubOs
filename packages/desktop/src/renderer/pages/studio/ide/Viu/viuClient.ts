/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { bridge } from '@office-ai/platform';
import type { ViuProjectState, ViuTransactionResult } from '@/common/viu';
import type { ViuLocalAssetRef } from '@process/ide/viu/assets';
import type { ViuAssetGrantRequest, ViuV2TransactionRequest, ViuV2WorkspaceRequest } from '@process/ide/viu/viuBridge';
import type { ViuSessionValidation } from '@process/ide/viu/v2SessionService';
import type {
  ViuCaptureRequest,
  ViuCreateRequest,
  ViuImageRequest,
  ViuPersistRequest,
  ViuPersistResult,
  ViuProject,
  ViuResult,
} from '@process/ide/viu/types';

const VIU_CHANNELS = {
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

const channels = {
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

export const viuClient = {
  create: (request: ViuCreateRequest): Promise<ViuResult<ViuProject>> => channels.create.invoke(request),
  capture: (request: ViuCaptureRequest): Promise<ViuResult<ViuProject>> => channels.capture.invoke(request),
  analyzeImage: (request: ViuImageRequest): Promise<ViuResult<ViuProject>> => channels.analyzeImage.invoke(request),
  persist: (request: ViuPersistRequest): Promise<ViuResult<ViuPersistResult & { agentPrompt: string }>> =>
    channels.persist.invoke(request),
  inspectV2: (workspaceKey: string): Promise<ViuResult<ViuProjectState>> => channels.v2Inspect.invoke({ workspaceKey }),
  previewV2: (request: ViuV2TransactionRequest): Promise<ViuResult<ViuTransactionResult>> =>
    channels.v2Preview.invoke(request),
  commitV2: (request: ViuV2TransactionRequest): Promise<ViuResult<ViuTransactionResult>> =>
    channels.v2Commit.invoke(request),
  validateV2: (workspaceKey: string): Promise<ViuResult<ViuSessionValidation>> =>
    channels.v2Validate.invoke({ workspaceKey }),
  grantAsset: (request: ViuAssetGrantRequest): Promise<ViuResult<ViuLocalAssetRef>> =>
    channels.assetGrant.invoke(request),
  listAssets: (workspaceKey: string): Promise<ViuResult<ViuLocalAssetRef[]>> =>
    channels.assetList.invoke({ workspaceKey }),
};

export type { ViuDocument, ViuImproveMode, ViuNode, ViuProject, ViuSourceKind } from '@process/ide/viu/types';
export type { ViuLocalAssetRef } from '@process/ide/viu/assets';
