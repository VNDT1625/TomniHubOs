/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ViuProjectState, ViuTransactionResult } from '@/common/viu';
import type {
  ViuCaptureRequest,
  ViuCreateRequest,
  ViuImageRequest,
  ViuPersistRequest,
  ViuPersistResult,
  ViuProject,
  ViuResult,
} from '@/common/viu/legacyDisplay';
import type {
  DesignViuAssetGrantRequest,
  DesignViuLocalAssetRef,
  DesignViuSessionValidation,
  DesignViuTransactionRequest,
} from '@/common/packages';

const unavailable = <T>(): Promise<ViuResult<T>> => Promise.resolve({ ok: false, error: 'DESIGN_VIU_UNAVAILABLE' });
const denied = <T>(): Promise<ViuResult<T>> => Promise.resolve({ ok: false, error: 'DESIGN_VIU_OPERATION_DENIED' });
const toResult = <T>(
  value: Promise<Readonly<{ ok: true; data: T }> | Readonly<{ ok: false; code: string }>>
): Promise<ViuResult<T>> =>
  value.then((result): ViuResult<T> => {
    if (result.ok === true) return { ok: true, data: result.data };
    return { ok: false, error: result.code };
  });

export const viuClient = {
  create: (_request: ViuCreateRequest): Promise<ViuResult<ViuProject>> => denied(),
  capture: (_request: ViuCaptureRequest): Promise<ViuResult<ViuProject>> => denied(),
  analyzeImage: (_request: ViuImageRequest): Promise<ViuResult<ViuProject>> => denied(),
  persist: (_request: ViuPersistRequest): Promise<ViuResult<ViuPersistResult & { agentPrompt: string }>> => denied(),
  inspectV2: (workspaceKey: string): Promise<ViuResult<ViuProjectState>> =>
    window.electronAPI?.designViu ? toResult(window.electronAPI.designViu.inspect({ workspaceKey })) : unavailable(),
  previewV2: (request: DesignViuTransactionRequest): Promise<ViuResult<ViuTransactionResult>> =>
    window.electronAPI?.designViu ? toResult(window.electronAPI.designViu.preview(request)) : unavailable(),
  commitV2: (request: DesignViuTransactionRequest): Promise<ViuResult<ViuTransactionResult>> =>
    window.electronAPI?.designViu ? toResult(window.electronAPI.designViu.commit(request)) : unavailable(),
  validateV2: (workspaceKey: string): Promise<ViuResult<DesignViuSessionValidation>> =>
    window.electronAPI?.designViu ? toResult(window.electronAPI.designViu.validate({ workspaceKey })) : unavailable(),
  grantAsset: (_request: DesignViuAssetGrantRequest): Promise<ViuResult<DesignViuLocalAssetRef>> => denied(),
  listAssets: (workspaceKey: string): Promise<ViuResult<DesignViuLocalAssetRef[]>> =>
    window.electronAPI?.designViu ? toResult(window.electronAPI.designViu.listAssets({ workspaceKey })) : unavailable(),
};

export type { ViuDocument, ViuImproveMode, ViuNode, ViuProject, ViuSourceKind } from '@/common/viu/legacyDisplay';
export type { DesignViuLocalAssetRef as ViuLocalAssetRef } from '@/common/packages';
