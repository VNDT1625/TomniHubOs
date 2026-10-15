/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { configService } from '@/common/config/configService';
import { ROUTER9_REASONING_EFFORTS, TOMNI_GATEWAY_PROVIDER_ID, type Router9ReasoningEffort } from '@/common/router9';
import { useGoogleAuthModels } from '@/renderer/hooks/agent/useGoogleAuthModels';
import { useProvidersQuery } from '@/renderer/hooks/agent/useModelProviderList';
import { hasAvailableModels } from '../utils/modelUtils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const buildModelKey = (providerId?: string, modelName?: string) => {
  if (!providerId || !modelName) return null;
  return `${providerId}:${modelName}`;
};

const isModelKeyAvailable = (key: string | null, providers?: IProvider[]) => {
  if (key === 'auto:auto') return true;
  if (!key || !providers || providers.length === 0) return false;
  return providers.some((provider) =>
    Boolean(provider.id && provider.models?.some((modelName) => buildModelKey(provider.id, modelName) === key))
  );
};

const isReasoningEffort = (value: unknown): value is Router9ReasoningEffort =>
  typeof value === 'string' && ROUTER9_REASONING_EFFORTS.includes(value as Router9ReasoningEffort);

type ProviderAgentKey = 'tomnyagentic';
const MODEL_STORAGE_KEY: Record<ProviderAgentKey, 'tomnyagentic.defaultModel'> = {
  tomnyagentic: 'tomnyagentic.defaultModel',
};

type StoredModelSelection = { id: string; use_model: string; reasoning_effort?: Router9ReasoningEffort };

export type GuidModelSelectionResult = {
  modelList: IProvider[];
  isGoogleAuth: boolean;
  formatGeminiModelLabel: (provider: { platform?: string } | undefined, modelName?: string) => string;
  current_model: TProviderWithModel | undefined;
  setCurrentModel: (model_info: TProviderWithModel) => Promise<void>;
  setReasoningEffort: (reasoningEffort?: Router9ReasoningEffort) => Promise<void>;
};

/** Manages the Hub default model and the gateway-only reasoning effort override. */
export const useGuidModelSelection = (agentKey: ProviderAgentKey = 'tomnyagentic'): GuidModelSelectionResult => {
  const { isGoogleAuth } = useGoogleAuthModels();
  const { data: modelConfig } = useProvidersQuery();
  const modelList = useMemo(() => {
    const allProviders: IProvider[] = (modelConfig || []).filter((provider) => !!provider.models.length);
    return allProviders.filter(hasAvailableModels);
  }, [modelConfig]);
  const formatGeminiModelLabel = useCallback((_provider: { platform?: string } | undefined, modelName?: string) => modelName ?? '', []);
  const [current_model, setCurrentModelState] = useState<TProviderWithModel>();
  const selectedModelKeyRef = useRef<string | null>(null);
  const prevStorageKeyRef = useRef<string | null>(null);
  const storageKey = MODEL_STORAGE_KEY[agentKey];

  const setCurrentModel = useCallback(async (modelInfo: TProviderWithModel) => {
    const reasoningEffort =
      modelInfo.id === TOMNI_GATEWAY_PROVIDER_ID && isReasoningEffort(modelInfo.reasoning_effort)
        ? modelInfo.reasoning_effort
        : undefined;
    const nextModel: TProviderWithModel = {
      ...modelInfo,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    };
    selectedModelKeyRef.current = buildModelKey(nextModel.id, nextModel.use_model);
    const stored: StoredModelSelection = {
      id: nextModel.id,
      use_model: nextModel.use_model,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    };
    await configService.set(storageKey, stored).catch((error) => console.error('Failed to save default model:', error));
    setCurrentModelState(nextModel);
  }, [storageKey]);

  const setReasoningEffort = useCallback(async (reasoningEffort?: Router9ReasoningEffort) => {
    if (current_model?.id !== TOMNI_GATEWAY_PROVIDER_ID) return;
    await setCurrentModel({ ...current_model, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) });
  }, [current_model, setCurrentModel]);

  useEffect(() => {
    const restore = async () => {
      if (!modelList.length) return;
      const agentChanged = prevStorageKeyRef.current !== null && prevStorageKeyRef.current !== storageKey;
      prevStorageKeyRef.current = storageKey;
      if (agentChanged) selectedModelKeyRef.current = null;
      const currentKey = selectedModelKeyRef.current || buildModelKey(current_model?.id, current_model?.use_model);
      if (!agentChanged && isModelKeyAvailable(currentKey, modelList)) {
        if (!selectedModelKeyRef.current && currentKey) selectedModelKeyRef.current = currentKey;
        return;
      }

      const saved = configService.get(storageKey);
      if (saved && typeof saved === 'object' && 'id' in saved) {
        const selection = saved as StoredModelSelection;
        if (selection.id === 'auto' || selection.use_model === 'auto') {
          setCurrentModelState({ id: 'auto', name: 'Auto (Laya Decision)', use_model: 'auto', platform: 'auto' } as TProviderWithModel);
          return;
        }
        const provider = modelList.find((candidate) => candidate.id === selection.id);
        if (provider?.models.includes(selection.use_model)) {
          await setCurrentModel({
            ...provider,
            use_model: selection.use_model,
            ...(selection.id === TOMNI_GATEWAY_PROVIDER_ID && isReasoningEffort(selection.reasoning_effort)
              ? { reasoning_effort: selection.reasoning_effort }
              : {}),
          });
          return;
        }
      }

      if (typeof saved === 'string') {
        const provider = modelList.find((candidate) => candidate.models.includes(saved));
        if (provider) {
          await setCurrentModel({ ...provider, use_model: saved });
          return;
        }
      }

      const fallback = modelList[0];
      const model = fallback?.models[0];
      if (fallback && model) await setCurrentModel({ ...fallback, use_model: model });
    };
    void restore().catch((error) => console.error('Failed to set default model:', error));
  }, [modelList, storageKey, setCurrentModel]);

  return { modelList, isGoogleAuth, formatGeminiModelLabel, current_model, setCurrentModel, setReasoningEffort };
};
