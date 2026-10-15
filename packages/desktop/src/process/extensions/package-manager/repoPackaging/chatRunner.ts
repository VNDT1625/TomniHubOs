/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runs `/repotopackage` for the chat: parses the command, packages with real progress, and reports
 * the outcome. The host supplies every path and the key store, so this module has no Electron
 * dependency and can be tested directly.
 */

import type { PackageMcpServerContribution } from '../../../../common/packages';
import { parseRepoToPackageCommand } from './command';
import { buildTomnyPackageFromRepo } from './packager';
import { progressPercent, renderFailure, renderProgress, renderSuccess } from './report';
import { parseSource } from './sourceResolver';
import { RepoPackagingError, type RepoPackagingProgress } from './types';

export type RepoToPackageChatEnvironment = Readonly<{
  /** The conversation's workspace. Local sources must stay inside it. */
  workspaceRoot?: string;
  /** Where finished packages are written; it must outlive any temporary clone. */
  outputDirectory: string;
  keyStore: Readonly<{
    directory: string;
    protect?: (plain: Buffer) => Buffer;
    unprotect?: (cipher: Buffer) => Buffer;
  }>;
  allowedGitHosts?: readonly string[];
}>;

export type RepoToPackageChatUpdate = Readonly<{
  text: string;
  progress: number;
  completed: boolean;
  ok?: boolean;
  /** MCP servers the new package declares, so the host can offer them in the MCP settings. */
  mcpServers?: readonly PackageMcpServerContribution[];
  /** Skill folders inside the new package, so the host can import them into its skill catalog. */
  skills?: Readonly<{ artifactPath: string; roots: readonly string[] }>;
  /** The signed `.tomny` file that was just written (a successful run only), so the host can register and install it. */
  artifactPath?: string;
}>;

export const runRepoToPackageChat = async (
  rawTarget: string,
  environment: RepoToPackageChatEnvironment,
  publish: (update: RepoToPackageChatUpdate) => void,
  signal?: AbortSignal
): Promise<RepoToPackageChatUpdate> => {
  const finish = (
    text: string,
    ok: boolean,
    mcpServers?: readonly PackageMcpServerContribution[],
    skills?: RepoToPackageChatUpdate['skills'],
    artifactPath?: string
  ): RepoToPackageChatUpdate => {
    const update: RepoToPackageChatUpdate = {
      text,
      progress: 100,
      completed: true,
      ok,
      ...(mcpServers?.length ? { mcpServers } : {}),
      ...(skills ? { skills } : {}),
      ...(artifactPath ? { artifactPath } : {}),
    };
    publish(update);
    return update;
  };

  let source = rawTarget.trim();
  try {
    const command = parseRepoToPackageCommand(rawTarget);
    source = command.source;
    const parsed = parseSource(command.source, environment.allowedGitHosts);
    if (parsed.kind === 'local' && environment.workspaceRoot === undefined) {
      throw new RepoPackagingError(
        'SOURCE_INVALID',
        'Cuộc trò chuyện chưa có workspace nên chưa đọc được thư mục cục bộ. Hãy chọn workspace hoặc dùng địa chỉ https://github.com/<chủ>/<repo>.'
      );
    }

    const events: RepoPackagingProgress[] = [];
    const display = command.source === '' ? '.' : command.source;
    publish({ text: renderProgress(display, events), progress: 0, completed: false });
    const result = await buildTomnyPackageFromRepo({
      source: command.source,
      workspaceRoot: environment.workspaceRoot,
      outputDirectory: environment.outputDirectory,
      ref: command.ref,
      subdirectory: command.subdirectory,
      packageId: command.packageId,
      name: command.name,
      version: command.version,
      publisherId: command.publisherId,
      allowedGitHosts: environment.allowedGitHosts,
      signing: {
        keyDirectory: environment.keyStore.directory,
        protect: environment.keyStore.protect,
        unprotect: environment.keyStore.unprotect,
      },
      signal,
      onProgress: (event) => {
        events.push(event);
        publish({ text: renderProgress(display, events), progress: progressPercent(events), completed: false });
      },
    });
    const skillPaths = (result.adapter?.connections ?? []).flatMap((connection) =>
      connection.kind === 'skill' ? [connection.path] : []
    );
    return finish(
      renderSuccess(result),
      true,
      result.manifest.contributions?.mcpServers,
      skillPaths.length > 0 ? { artifactPath: result.artifactPath, roots: skillPaths } : undefined,
      result.artifactPath
    );
  } catch (error) {
    return finish(renderFailure(source, error), false);
  }
};
