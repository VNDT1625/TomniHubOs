/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { UserHooksStage } from './stages/userHooksStage';
import type { ChatPipelineDefinition, ChatStageMetadata, IChatStage } from './types';

type RegisteredStageEntry = {
  stage: IChatStage;
  isBuiltin: boolean;
  packageId?: string;
};

export class ChatStageRegistry {
  private readonly stages = new Map<string, RegisteredStageEntry>();
  /** Old stage ids that still resolve, so saved pipelines keep working after a stage is renamed. */
  private readonly aliases = new Map<string, string>();
  /** Packages whose guard stages Main accepts as a stand-in for the built-in security stage. */
  private readonly authorizedGuardPackages = new Set<string>();

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
    // A Store package cannot impersonate or replace a security-critical built-in,
    // or steal another package's registered identity.
    if (stage.id.startsWith('builtin:') || this.stages.has(stage.id)) {
      throw new Error('CHAT_PACKAGE_STAGE_ID_RESERVED');
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

  public registerAlias(alias: string, target: string): void {
    this.aliases.set(alias, target);
  }

  /** Called by Main after it has verified a package (signature, review); a manifest cannot do this itself. */
  public authorizeGuardPackage(packageId: string): void {
    this.authorizedGuardPackages.add(packageId);
  }

  public getStage(id: string): IChatStage | undefined {
    return (this.stages.get(id) ?? this.stages.get(this.aliases.get(id) ?? ''))?.stage;
  }

  /** Package code cannot grant itself the builtin-only retry privilege. */
  public isBuiltinStage(id: string): boolean {
    return (this.stages.get(id) ?? this.stages.get(this.aliases.get(id) ?? ''))?.isBuiltin === true;
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
      role: stage.role ?? 'standard',
      ...(stage.decisionTasks ? { decisionTasks: stage.decisionTasks } : {}),
      ...(stage.role === 'guard'
        ? { authorizedGuard: isBuiltin || (packageId !== undefined && this.authorizedGuardPackages.has(packageId)) }
        : {}),
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
    // UserPromptSubmit hooks (design 11.3). Registered first, so it leads the default pipeline.
    globalRegistry.registerBuiltin(new UserHooksStage());
  }
  return globalRegistry;
};

export const resetChatStageRegistry = (): void => {
  globalRegistry = undefined;
};
