/**
 * Loopback-only RPC surface used by the browser Studio IDE.
 *
 * The Electron renderer normally talks to Node-backed IDE providers through
 * the desktop bridge. A standalone WebUI has no Electron Main process, so the
 * IDE MCP sidecar exposes the same filesystem spine over one deliberately
 * small, origin-gated JSON endpoint. Every path is confined to the sidecar's
 * repository root.
 */

import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { loadProjectRules } from '@package-apps/ide/process/workspace/rulesLoader';
import { buildGraphFromFiles, collectRepoFiles } from '@package-apps/ide/process/knowledge/graph/repoGraph';
import { createNodeIdeMcpService } from '@package-apps/ide/process/mcp/omniNodeWiring';

type RpcParams = Record<string, unknown>;

export type IdeWebRpcRequest = {
  method: string;
  params?: RpcParams;
};

const nonEmpty = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} is required.`);
  return value.trim();
};

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const optionalBoolean = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

export const createIdeWebRpc = (repoRoot: string) => {
  const root = path.resolve(repoRoot);
  const ide = createNodeIdeMcpService();

  const safePath = (value: unknown, name: string): string => {
    const requested = nonEmpty(value, name);
    const resolved = path.resolve(path.isAbsolute(requested) ? requested : path.join(root, requested));
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error(`${name} must stay inside the active workspace.`);
    }
    return resolved;
  };

  const refuseRootMutation = (target: string): void => {
    if (target === root) throw new Error('The active workspace root cannot be renamed or deleted.');
  };

  return async (request: IdeWebRpcRequest): Promise<unknown> => {
    const params = request.params ?? {};
    switch (request.method) {
      case 'workspace.info':
        return { rootPath: root };
      case 'ide.listDir': {
        const dir = safePath(params.dir, 'dir');
        const data = await ide.listDir(dir, {
          glob: typeof params.glob === 'string' ? params.glob : undefined,
          recursive: optionalBoolean(params.recursive),
          maxResults: optionalNumber(params.maxResults),
        });
        return { ok: true, data };
      }
      case 'ide.readFile': {
        const filePath = safePath(params.path, 'path');
        const data = await ide.readFile(filePath, {
          from: optionalNumber(params.from),
          to: optionalNumber(params.to),
          maxLines: optionalNumber(params.maxLines),
          maxBytes: optionalNumber(params.maxBytes),
          all: optionalBoolean(params.all),
          lineNumbers: optionalBoolean(params.lineNumbers),
        });
        return { ok: true, data };
      }
      case 'ide.readFileBase64': {
        const filePath = safePath(params.path, 'path');
        return { ok: true, data: (await fsp.readFile(filePath)).toString('base64') };
      }
      case 'ide.writeFile': {
        const filePath = safePath(params.path, 'path');
        const data = typeof params.data === 'string' ? params.data : '';
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        await fsp.writeFile(filePath, data, 'utf8');
        return { ok: true, data: true };
      }
      case 'ide.writeFileBase64': {
        const filePath = safePath(params.path, 'path');
        const dataBase64 = nonEmpty(params.dataBase64, 'dataBase64');
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        await fsp.writeFile(filePath, Buffer.from(dataBase64, 'base64'));
        return { ok: true, data: true };
      }
      case 'ide.createDir': {
        const dirPath = safePath(params.path, 'path');
        await fsp.mkdir(dirPath, { recursive: true });
        return { ok: true, data: true };
      }
      case 'ide.renameFile': {
        const oldPath = safePath(params.oldPath, 'oldPath');
        const newPath = safePath(params.newPath, 'newPath');
        refuseRootMutation(oldPath);
        await fsp.mkdir(path.dirname(newPath), { recursive: true });
        await fsp.rename(oldPath, newPath);
        return { ok: true, data: true };
      }
      case 'ide.deleteFile': {
        const filePath = safePath(params.path, 'path');
        refuseRootMutation(filePath);
        await fsp.rm(filePath, { recursive: true, force: false });
        return { ok: true, data: true };
      }
      case 'ide.rulesLoad': {
        const requestedRoot = safePath(params.rootPath ?? root, 'rootPath');
        return { ok: true, data: await loadProjectRules(requestedRoot) };
      }
      case 'ide.scanRepo': {
        const requestedRoot = safePath(params.rootPath ?? root, 'rootPath');
        const files = await collectRepoFiles(
          requestedRoot,
          {
            listDir: async (dir) =>
              (await fsp.readdir(dir, { withFileTypes: true })).map((entry) => ({
                name: entry.name,
                fullPath: path.join(dir, entry.name),
                isDir: entry.isDirectory(),
              })),
            readFile: (filePath) => fsp.readFile(filePath, 'utf8'),
            toRel: (fullPath) => path.relative(requestedRoot, fullPath).replace(/\\/g, '/'),
          },
          { maxFiles: optionalNumber(params.maxFiles) }
        );
        return {
          ok: true,
          data: buildGraphFromFiles(requestedRoot, files),
        };
      }
      case 'ide.search': {
        const requestedRoot = safePath(params.rootPath ?? root, 'rootPath');
        const query = nonEmpty(params.query, 'query');
        const hits = await ide.search(requestedRoot, query, {
          glob: typeof params.glob === 'string' ? params.glob : undefined,
          regex: optionalBoolean(params.regex),
          wholeWord: optionalBoolean(params.wholeWord),
          caseSensitive: optionalBoolean(params.caseSensitive),
          maxResults: optionalNumber(params.maxResults),
        });
        const caseSensitive = optionalBoolean(params.caseSensitive) === true;
        return {
          ok: true,
          data: hits.map((hit) => ({
            path: path.join(requestedRoot, hit.file),
            line: hit.line,
            column: Math.max(
              1,
              (caseSensitive ? hit.text : hit.text.toLowerCase()).indexOf(caseSensitive ? query : query.toLowerCase()) +
                1
            ),
            text: hit.text,
          })),
        };
      }
      case 'ide.findDefinition': {
        const requestedRoot = safePath(params.rootPath ?? root, 'rootPath');
        const hits = await ide.findDefinition(
          requestedRoot,
          nonEmpty(params.name, 'name'),
          optionalNumber(params.maxResults)
        );
        return {
          ok: true,
          data: hits.map((hit) => ({
            path: path.join(requestedRoot, hit.file),
            line: hit.line,
            column: hit.column,
            text: hit.text,
          })),
        };
      }
      case 'ide.findReferences': {
        const requestedRoot = safePath(params.rootPath ?? root, 'rootPath');
        const hits = await ide.findReferences(
          requestedRoot,
          nonEmpty(params.name, 'name'),
          optionalNumber(params.maxResults)
        );
        return {
          ok: true,
          data: hits.map((hit) => ({
            path: path.join(requestedRoot, hit.file),
            line: hit.line,
            column: hit.column,
            text: hit.text,
          })),
        };
      }
      default:
        throw new Error(`Unsupported browser IDE method: ${request.method}`);
    }
  };
};
