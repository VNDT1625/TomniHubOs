/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { useModelProviderList } from '@/renderer/hooks/agent/useModelProviderList';
import { useCallback, useEffect, useMemo, useState } from 'react';

export type TomnyAgenticModelSelection = {
  current_model?: TProviderWithModel;
  providers: IProvider[];
  getAvailableModels: (provider: IProvider) => string[];
  handleSelectModel: (provider: IProvider, modelName: string) => Promise<void>;
  handleSelectReasoning: (reasoningEffort?: TProviderWithModel['reasoning_effort']) => Promise<void>;
  getDisplayModelName: (modelName?: string) => string;
};

export type UseTomnyAgenticModelSelectionOptions = {
  initialModel: TProviderWithModel | undefined;
  onSelectModel: (
    provider: IProvider,
    modelName: string,
    reasoningEffort?: TProviderWithModel['reasoning_effort']
  ) => Promise<boolean>;
};

export const useTomnyAgenticModelSelection = ({
  initialModel,
  onSelectModel,
}: UseTomnyAgenticModelSelectionOptions): TomnyAgenticModelSelection => {
  const [current_model, setCurrentModel] = useState<TProviderWithModel | undefined>(initialModel);

  useEffect(() => {
    setCurrentModel(initialModel);
  }, [initialModel?.id, initialModel?.use_model, initialModel?.reasoning_effort]);

  const { providers: allProviders, getAvailableModels, formatModelLabel } = useModelProviderList();

  // the legacy core does not support Google Auth — filter it out
  const providers = useMemo(
    () => allProviders.filter((p) => !p.platform?.toLowerCase().includes('gemini-with-google-auth')),
    [allProviders]
  );

  const handleSelectModel = useCallback(
    async (provider: IProvider, modelName: string) => {
      const reasoningEffort = provider.id === current_model?.id ? current_model.reasoning_effort : undefined;
      const selected = {
        ...(provider as unknown as TProviderWithModel),
        use_model: modelName,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      } as TProviderWithModel;
      const ok = await onSelectModel(provider, modelName, reasoningEffort);
      if (ok) setCurrentModel(selected);
    },
    [current_model?.id, current_model?.reasoning_effort, onSelectModel]
  );

  const handleSelectReasoning = useCallback(
    async (reasoningEffort?: TProviderWithModel['reasoning_effort']) => {
      if (!current_model?.use_model) return;
      const provider = providers.find((item) => item.id === current_model.id);
      if (!provider) return;
      const ok = await onSelectModel(provider, current_model.use_model, reasoningEffort);
      if (!ok) return;
      setCurrentModel({
        ...current_model,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : { reasoning_effort: undefined }),
      });
    },
    [current_model, onSelectModel, providers]
  );

  const getDisplayModelName = useCallback(
    (modelName?: string) => {
      if (!modelName) return '';
      const label = formatModelLabel(current_model, modelName);
      const maxLength = 20;
      return label.length > maxLength ? `${label.slice(0, maxLength)}...` : label;
    },
    [current_model, formatModelLabel]
  );

  return {
    current_model,
    providers,
    getAvailableModels,
    handleSelectModel,

    handleSelectReasoning,
    getDisplayModelName,
  };
};
