/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Narrow renderer client owned by the IDE Package App. It may only be loaded
 * from an installed IDE Surface; the base renderer must not import it.
 */

import { bridge } from '@office-ai/platform';
import type {
  InlineCompleteRequest,
  IdeCompletionResult,
} from '@package-apps/ide/process/coding/lang/ideCompletionBridge';
import type { IdeLintResult, LintFileRequest } from '@package-apps/ide/process/coding/lint/ideLintBridge';
import type {
  IdeMemoryResult,
  RepoSecretRenderMarkersRequest,
} from '@package-apps/ide/process/data/memory/ideMemoryBridge';
import type { RepoSecretMarkerRender } from '@package-apps/ide/process/data/memory/repoSecretStore';
import type {
  KnowledgeContextRequest,
  KnowledgeGetRequest,
  KnowledgeRefreshFileRequest,
} from '@package-apps/ide/process/knowledge/graph/knowledgeGraphBridge';
import type {
  SpecLifecycleStatus,
  SpecResult,
  SpecStatusRequest,
  SpecTaskClaimRequest,
  SpecTaskListRequest,
  SpecTaskRunbook,
} from '@package-apps/ide/process/workspace/specLifecycleBridge';
import type {
  ContextPack,
  KnowledgeGraph,
  KnowledgeNode,
  UnderstandResult,
} from '@package-apps/ide/process/knowledge/graph/understandTypes';

const CORE_IDE_CHANNELS = {
  kgGet: 'ide.kg-get',
  kgContext: 'ide.kg-context',
  kgRefreshFile: 'ide.kg-refresh-file',
  specStatus: 'ide.spec-status',
  specTaskList: 'ide.spec-task-list',
  specTaskClaim: 'ide.spec-task-claim',
  lintFile: 'ide.lint-file',
  inlineComplete: 'ide.inline-complete',
  repoSecretRenderMarkers: 'ide.repo-secret-render-markers',
} as const;

const FILE_OP_TIMEOUT_MS = 15_000;
const SCAN_TIMEOUT_MS = 30_000;
const INLINE_COMPLETE_TIMEOUT_MS = 8_000;

const channels = {
  kgGet: bridge.buildProvider<UnderstandResult<KnowledgeGraph | null>, KnowledgeGetRequest>(CORE_IDE_CHANNELS.kgGet),
  kgContext: bridge.buildProvider<UnderstandResult<ContextPack | null>, KnowledgeContextRequest>(
    CORE_IDE_CHANNELS.kgContext
  ),
  kgRefreshFile: bridge.buildProvider<UnderstandResult<KnowledgeNode | null>, KnowledgeRefreshFileRequest>(
    CORE_IDE_CHANNELS.kgRefreshFile
  ),
  specStatus: bridge.buildProvider<SpecResult<SpecLifecycleStatus>, SpecStatusRequest>(CORE_IDE_CHANNELS.specStatus),
  specTaskList: bridge.buildProvider<SpecResult<SpecTaskRunbook>, SpecTaskListRequest>(CORE_IDE_CHANNELS.specTaskList),
  specTaskClaim: bridge.buildProvider<SpecResult<SpecTaskRunbook>, SpecTaskClaimRequest>(
    CORE_IDE_CHANNELS.specTaskClaim
  ),
  lintFile: bridge.buildProvider<IdeLintResult, LintFileRequest>(CORE_IDE_CHANNELS.lintFile),
  inlineComplete: bridge.buildProvider<IdeCompletionResult, InlineCompleteRequest>(CORE_IDE_CHANNELS.inlineComplete),
  repoSecretRenderMarkers: bridge.buildProvider<
    IdeMemoryResult<RepoSecretMarkerRender>,
    RepoSecretRenderMarkersRequest
  >(CORE_IDE_CHANNELS.repoSecretRenderMarkers),
};

/** Error thrown when an IDE Package IPC call exceeds its response budget. */
export class CoreIdeBridgeTimeoutError extends Error {
  constructor(channel: string, timeoutMs: number) {
    super(`[CoreIdeClient] No reply on "${channel}" after ${Math.round(timeoutMs / 1000)}s.`);
    this.name = 'CoreIdeBridgeTimeoutError';
  }
}

const invokeWithTimeout = <T>(channel: string, call: () => Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new CoreIdeBridgeTimeoutError(channel, timeoutMs));
    }, timeoutMs);
    call().then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });

/** IDE Package API; operations remain bounded by the corresponding Main bridge. */
export const coreIdeClient = {
  kgGet: (rootPath: string): Promise<UnderstandResult<KnowledgeGraph | null>> =>
    invokeWithTimeout(CORE_IDE_CHANNELS.kgGet, () => channels.kgGet.invoke({ rootPath }), FILE_OP_TIMEOUT_MS),
  kgContext: (
    rootPath: string,
    request: string,
    rules?: string[],
    includeDiff?: boolean
  ): Promise<UnderstandResult<ContextPack | null>> =>
    invokeWithTimeout(
      CORE_IDE_CHANNELS.kgContext,
      () => channels.kgContext.invoke({ rootPath, request, rules, includeDiff }),
      FILE_OP_TIMEOUT_MS
    ),
  kgRefreshFile: (
    rootPath: string,
    relPath: string,
    content: string
  ): Promise<UnderstandResult<KnowledgeNode | null>> =>
    invokeWithTimeout(
      CORE_IDE_CHANNELS.kgRefreshFile,
      () => channels.kgRefreshFile.invoke({ rootPath, relPath, content }),
      FILE_OP_TIMEOUT_MS
    ),
  specStatus: (rootPath: string): Promise<SpecResult<SpecLifecycleStatus>> =>
    invokeWithTimeout(CORE_IDE_CHANNELS.specStatus, () => channels.specStatus.invoke({ rootPath }), FILE_OP_TIMEOUT_MS),
  specTaskList: (rootPath: string, slug?: string): Promise<SpecResult<SpecTaskRunbook>> =>
    invokeWithTimeout(
      CORE_IDE_CHANNELS.specTaskList,
      () => channels.specTaskList.invoke({ rootPath, slug }),
      FILE_OP_TIMEOUT_MS
    ),
  specTaskClaim: (
    rootPath: string,
    slug?: string,
    taskId?: string,
    agentId?: string
  ): Promise<SpecResult<SpecTaskRunbook>> =>
    invokeWithTimeout(
      CORE_IDE_CHANNELS.specTaskClaim,
      () => channels.specTaskClaim.invoke({ rootPath, slug, taskId, agentId }),
      FILE_OP_TIMEOUT_MS
    ),
  lintFile: (filePath: string, rootPath: string): Promise<IdeLintResult> =>
    invokeWithTimeout(
      CORE_IDE_CHANNELS.lintFile,
      () => channels.lintFile.invoke({ filePath, rootPath }),
      SCAN_TIMEOUT_MS
    ),
  inlineComplete: (request: InlineCompleteRequest): Promise<IdeCompletionResult> =>
    invokeWithTimeout(
      CORE_IDE_CHANNELS.inlineComplete,
      () => channels.inlineComplete.invoke(request),
      INLINE_COMPLETE_TIMEOUT_MS
    ),
  repoSecretRenderMarkers: (repository: string, text: string): Promise<IdeMemoryResult<RepoSecretMarkerRender>> =>
    invokeWithTimeout(
      CORE_IDE_CHANNELS.repoSecretRenderMarkers,
      () => channels.repoSecretRenderMarkers.invoke({ repository, text }),
      FILE_OP_TIMEOUT_MS
    ),
};

export type { KnowledgeGraph, SpecTaskRunbook };
