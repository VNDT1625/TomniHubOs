/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Message } from '@arco-design/web-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type {
  ChatPipelineDefinition,
  ChatPipelineStageRef,
  ChatStageMetadata,
  PipelineRunTrace,
  PipelineSimulationResult,
} from '@/common/types/pipeline';
import {
  builtinStageTextKey,
  defaultStageRefs,
  duplicateStage,
  moveStage,
  newStageRef,
  patchStageConfig,
  pipelineWarnings,
  removeStage,
  setStageEnabled,
  withStages,
  type PipelineWarning,
} from './pipelineUtils';

const SIMULATION_DEBOUNCE_MS = 250;
const PROBE_QUERY = 'Dry-run preflight probe query: ping health check';

export type UsePipelineEditorOptions = Readonly<{
  visible: boolean;
  conversationId?: string;
  onPipelineUpdated?: (activeCount: number) => void;
}>;

export type PipelineEditor = Readonly<{
  loading: boolean;
  saving: boolean;
  simulating: boolean;
  available: readonly ChatStageMetadata[];
  metaById: ReadonlyMap<string, ChatStageMetadata>;
  definition: ChatPipelineDefinition | null;
  selectedId: string | undefined;
  simulation: PipelineSimulationResult | null;
  lastRun: PipelineRunTrace | null;
  warnings: readonly PipelineWarning[];
  /** The name to show for a stage: a translated name for built-in stages, the package's own otherwise. */
  stageName: (meta: ChatStageMetadata | undefined, registryId: string) => string;
  stageDescription: (meta: ChatStageMetadata | undefined) => string;
  select: (id: string) => void;
  toggle: (id: string, enabled: boolean) => void;
  move: (index: number, delta: -1 | 1) => void;
  remove: (index: number) => void;
  duplicate: (index: number) => void;
  add: (meta: ChatStageMetadata) => void;
  setConfig: (id: string, patch: Record<string, unknown>) => void;
  reset: () => void;
  save: () => Promise<boolean>;
}>;

export const usePipelineEditor = ({
  visible,
  conversationId,
  onPipelineUpdated,
}: UsePipelineEditorOptions): PipelineEditor => {
  const { t } = useTranslation();
  // Callbacks are read through a ref so a re-render (or a language change) never reloads the pipeline
  // and throws away edits that have not been saved yet.
  const latest = useRef({ t, onPipelineUpdated });
  latest.current = { t, onPipelineUpdated };
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [available, setAvailable] = useState<ChatStageMetadata[]>([]);
  const [definition, setDefinition] = useState<ChatPipelineDefinition | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [simulation, setSimulation] = useState<PipelineSimulationResult | null>(null);
  const [lastRun, setLastRun] = useState<PipelineRunTrace | null>(null);

  const metaById = useMemo(() => new Map(available.map((meta) => [meta.id, meta] as const)), [available]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stages, loaded, run] = await Promise.all([
        ipcBridge.conversation.getPipelineAvailableStages.invoke(),
        ipcBridge.conversation.getPipelineDefinition.invoke({ conversation_id: conversationId }),
        ipcBridge.conversation.getPipelineLastRun.invoke({ conversation_id: conversationId }),
      ]);
      setAvailable(stages);
      setDefinition(loaded);
      setLastRun(run);
      setSelectedId((current) =>
        loaded.stages.some((stage) => stage.id === current) ? current : loaded.stages[0]?.id
      );
      latest.current.onPipelineUpdated?.(loaded.stages.filter((stage) => stage.enabled).length);
    } catch (error) {
      console.error('[ChatPipelineModal] Load error:', error);
      Message.error(latest.current.t('conversation.pipeline.messages.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  // A dry run of the edited chain shows what it would do before anything is saved.
  useEffect(() => {
    if (!definition || !visible) return;
    let cancelled = false;
    setSimulating(true);
    const timer = setTimeout(async () => {
      try {
        const result = await ipcBridge.conversation.simulatePipeline.invoke({
          definition,
          probe_query: PROBE_QUERY,
        });
        if (!cancelled) setSimulation(result);
      } catch (error) {
        if (!cancelled) {
          setSimulation({
            success: false,
            totalDurationMs: 0,
            initialContextBytes: 0,
            finalContextBytes: 0,
            addedContextBytes: 0,
            finalQuery: '',
            stageMetrics: [],
            errorMessage: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (!cancelled) setSimulating(false);
      }
    }, SIMULATION_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [definition, visible]);

  const update = useCallback(
    (build: (stages: readonly ChatPipelineStageRef[]) => ChatPipelineStageRef[]) =>
      setDefinition((current) => (current ? withStages(current, build(current.stages)) : current)),
    []
  );

  const stageName = useCallback(
    (meta: ChatStageMetadata | undefined, registryId: string): string => {
      const key = builtinStageTextKey(registryId);
      if (key) return t(`conversation.pipeline.stageName.${key}`);
      return meta?.displayName ?? registryId;
    },
    [t]
  );

  const stageDescription = useCallback(
    (meta: ChatStageMetadata | undefined): string => {
      const key = meta ? builtinStageTextKey(meta.id) : undefined;
      if (key) return t(`conversation.pipeline.stageDesc.${key}`);
      return meta?.description ?? '';
    },
    [t]
  );

  const warnings = useMemo(
    () => (definition ? pipelineWarnings(definition.stages, metaById) : []),
    [definition, metaById]
  );

  const add = useCallback(
    (meta: ChatStageMetadata) => {
      const ref = newStageRef(meta);
      update((stages) => [...stages, ref]);
      setSelectedId(ref.id);
      Message.success(t('conversation.pipeline.messages.added', { name: stageName(meta, meta.id) }));
    },
    [stageName, t, update]
  );

  const duplicate = useCallback(
    (index: number) => {
      if (!definition) return;
      const next = duplicateStage(definition.stages, index);
      setDefinition(withStages(definition, next));
      setSelectedId(next[index + 1]?.id);
    },
    [definition]
  );

  const remove = useCallback(
    (index: number) => {
      if (!definition) return;
      const next = removeStage(definition.stages, index);
      setDefinition(withStages(definition, next));
      setSelectedId(next[Math.min(index, next.length - 1)]?.id);
    },
    [definition]
  );

  const reset = useCallback(() => {
    if (!definition) return;
    const next = defaultStageRefs(available);
    setDefinition(withStages(definition, next));
    setSelectedId(next[0]?.id);
    Message.info(t('conversation.pipeline.messages.resetDone'));
  }, [available, definition, t]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!definition) return false;
    setSaving(true);
    try {
      await ipcBridge.conversation.updatePipelineDefinition.invoke({ conversation_id: conversationId, definition });
      onPipelineUpdated?.(definition.stages.filter((stage) => stage.enabled).length);
      Message.success(t('conversation.pipeline.messages.saved'));
      return true;
    } catch (error) {
      console.error('[ChatPipelineModal] Save error:', error);
      Message.error(t('conversation.pipeline.messages.saveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [conversationId, definition, onPipelineUpdated, t]);

  return {
    loading,
    saving,
    simulating,
    available,
    metaById,
    definition,
    selectedId,
    simulation,
    lastRun,
    warnings,
    stageName,
    stageDescription,
    select: setSelectedId,
    toggle: (id, enabled) => update((stages) => setStageEnabled(stages, id, enabled)),
    move: (index, delta) => {
      update((stages) => moveStage(stages, index, delta));
    },
    remove,
    duplicate,
    add,
    setConfig: (id, patch) => update((stages) => patchStageConfig(stages, id, patch)),
    reset,
    save,
  };
};
