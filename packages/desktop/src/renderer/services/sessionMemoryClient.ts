/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Renderer client for the Session Super-Memory & Repo Secret IPC bridge.
 * Pure renderer bridge invoker with no Node.js or package dependencies.
 */

import { bridge } from '@office-ai/platform';
import type {
  SuperMemorySnapshot,
  SuperMemoryKind,
  RememberResult,
} from '@process/userUnderstanding/sessionMemoryStore';

export type IdeMemoryResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type IdeMemoryRecordableKind = Exclude<SuperMemoryKind, 'summary'>;

export type RepoSecretContext = {
  alias: string;
  description: string;
  comboId?: string;
  comboLabel?: string;
  comboKey?: string;
  status: 'set' | 'needs_value';
  updatedAt: number;
};

export type RepoSecretComboKey = {
  key: string;
  alias: string;
  status: 'set' | 'needs_value';
  updatedAt: number;
};

export type RepoSecretCombo = {
  comboId: string;
  comboLabel: string;
  description: string;
  keys: RepoSecretComboKey[];
  updatedAt: number;
};

export type RepoSecretScopeSummary = {
  repository: string;
  secretCount: number;
  comboCount: number;
  updatedAt: number;
};

export type RepoSecretComboInput = {
  comboId: string;
  comboLabel: string;
  description: string;
  keys: Array<{
    key: string;
    alias?: string;
    value?: string;
    description?: string;
  }>;
  variables?: Array<{
    key: string;
    alias?: string;
    value?: string;
    description?: string;
  }>;
};

export const sessionMemoryClient = {
  memorySnapshot: (sessionId: string) =>
    bridge
      .buildProvider<IdeMemoryResult<SuperMemorySnapshot>, { sessionId: string }>('ide.memory-snapshot')
      .invoke({ sessionId }),

  memoryClear: (sessionId: string) =>
    bridge.buildProvider<IdeMemoryResult<boolean>, { sessionId: string }>('ide.memory-clear').invoke({ sessionId }),

  memoryRemember: (sessionId: string, text: string, opts?: { kind?: IdeMemoryRecordableKind; pinned?: boolean }) =>
    bridge
      .buildProvider<
        IdeMemoryResult<RememberResult>,
        { sessionId: string; text: string; kind?: IdeMemoryRecordableKind; pinned?: boolean }
      >('ide.memory-remember')
      .invoke({
        sessionId,
        text,
        kind: opts?.kind,
        pinned: opts?.pinned,
      }),

  repoSecretList: (repository: string) =>
    bridge
      .buildProvider<IdeMemoryResult<RepoSecretContext[]>, { repository: string }>('ide.repo-secret-list')
      .invoke({ repository }),

  repoSecretScopes: () =>
    bridge
      .buildProvider<IdeMemoryResult<RepoSecretScopeSummary[]>, Record<string, never>>('ide.repo-secret-scopes')
      .invoke({}),

  repoSecretSave: (repository: string, alias: string, description: string, value: string) =>
    bridge
      .buildProvider<
        IdeMemoryResult<boolean>,
        { repository: string; alias: string; description: string; value: string }
      >('ide.repo-secret-save')
      .invoke({ repository, alias, description, value }),

  repoSecretRemove: (repository: string, alias: string) =>
    bridge
      .buildProvider<IdeMemoryResult<boolean>, { repository: string; alias: string }>('ide.repo-secret-remove')
      .invoke({ repository, alias }),

  repoSecretComboList: (repository: string) =>
    bridge
      .buildProvider<IdeMemoryResult<RepoSecretCombo[]>, { repository: string }>('ide.repo-secret-combo-list')
      .invoke({ repository }),

  repoSecretComboSave: (repository: string, combo: RepoSecretComboInput) =>
    bridge
      .buildProvider<IdeMemoryResult<RepoSecretCombo>, { repository: string; combo: RepoSecretComboInput }>(
        'ide.repo-secret-combo-save'
      )
      .invoke({ repository, combo }),

  repoSecretComboRemove: (repository: string, comboId: string) =>
    bridge
      .buildProvider<IdeMemoryResult<boolean>, { repository: string; comboId: string }>('ide.repo-secret-combo-remove')
      .invoke({ repository, comboId }),

  repoSecretReveal: (repository: string, alias: string) =>
    bridge
      .buildProvider<IdeMemoryResult<string>, { repository: string; alias: string }>('ide.repo-secret-reveal')
      .invoke({ repository, alias }),
};
