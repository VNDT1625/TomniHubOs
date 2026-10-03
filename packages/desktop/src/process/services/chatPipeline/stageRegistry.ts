/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChatPipelineDefinition, ChatStageMetadata, IChatStage } from './types';

type RegisteredStageEntry = {
  stage: IChatStage;
  isBuiltin: boolean;
  packageId?: string;
};

export class ChatStageRegistry {
  private readonly stages = new Map<string, RegisteredStageEntry>();

  public registerBuiltin(stage: IChatStage): void {
    if (this.stages.has(stage.id)) {
      throw new Error(`Chat stage already registered: ${stage.id}`);
    }
    this.stages.set(stage.id, {
      stage,
      isBuiltin: true,
    });
  }

  public registerPackageStage(stage: IChatStage, packageId: string): void {
    if (!packageId.trim()) {
      throw new Error('Package ID is required to register a package chat stage.');
    }
    this.stages.set(stage.id, {
      stage,
      isBuiltin: false,
      packageId,
    });
  }

  public unregisterPackageStages(packageId: string): void {
    for (const [id, entry] of this.stages.entries()) {
      if (entry.packageId === packageId) {
        this.stages.delete(id);
      }
    }
  }

  public getStage(id: string): IChatStage | undefined {
    return this.stages.get(id)?.stage;
  }

  public listStages(): readonly IChatStage[] {
    return Array.from(this.stages.values()).map((entry) => entry.stage);
  }

  public listMetadata(): readonly ChatStageMetadata[] {
    return Array.from(this.stages.values()).map(({ stage, isBuiltin, packageId }) => ({
      id: stage.id,
      displayName: stage.displayName,
      description: stage.description,
      phase: stage.phase,
      icon: stage.icon,
      defaultEnabled: stage.defaultEnabled,
      defaultTimeoutMs: stage.defaultTimeoutMs,
      isBuiltin,
      packageId,
    }));
  }

  public createDefaultDefinition(): ChatPipelineDefinition {
    const activeRefs = Array.from(this.stages.values())
      .filter((entry) => entry.stage.defaultEnabled)
      .map((entry) => ({
        id: `stage-${entry.stage.id}`,
        stageRegistryId: entry.stage.id,
        phase: entry.stage.phase,
        enabled: true,
      }));

    return {
      schemaVersion: 1,
      id: 'default-pipeline',
      name: 'Default Governed Pipeline',
      stages: activeRefs,
      limits: {
        maxStages: 16,
        maxTotalTimeoutMs: 30_000,
        maxContextBytes: 1_000_000,
      },
      enabled: true,
    };
  }
}

let globalRegistry: ChatStageRegistry | undefined;

export const getChatStageRegistry = (): ChatStageRegistry => {
  if (!globalRegistry) {
    globalRegistry = new ChatStageRegistry();
  }
  return globalRegistry;
};

export const resetChatStageRegistry = (): void => {
  globalRegistry = undefined;
};
