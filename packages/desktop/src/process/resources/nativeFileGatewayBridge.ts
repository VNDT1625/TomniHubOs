import { bridge } from '@office-ai/platform';
import type { IDirOrFile, IFileMetadata, IWorkspaceFlatFile } from '@/common/adapter/ipcBridge';
import { NativeFileGateway } from './nativeFileGateway';

/**
 * Filesystem mutations need actor, path-capability, consent, resource-limit,
 * admission, and durable execution-receipt enforcement. Until that shared
 * executor exists, Main must reject them before the gateway can touch disk.
 */
export const NATIVE_FILE_MUTATION_DISABLED = 'Native filesystem mutations are disabled pending governed execution.';

export const fileGatewayChannels = {
  getFilesByDir: bridge.buildProvider<IDirOrFile[], { dir: string; root: string }>('native-fs.get-files-by-dir'),
  listWorkspaceFiles: bridge.buildProvider<IWorkspaceFlatFile[], { root: string }>('native-fs.list-workspace-files'),
  imageBase64: bridge.buildProvider<string | null, { path: string; workspace?: string }>('native-fs.image-base64'),
  fetchRemoteImage: bridge.buildProvider<string, { url: string }>('native-fs.fetch-remote-image'),
  read: bridge.buildProvider<string | null, { path: string; workspace?: string }>('native-fs.read'),
  readBuffer: bridge.buildProvider<string | null, { path: string; workspace?: string }>('native-fs.read-buffer'),
  temp: bridge.buildProvider<string, { file_name: string }>('native-fs.temp'),
  write: bridge.buildProvider<boolean, { path: string; data: string }>('native-fs.write'),
  metadata: bridge.buildProvider<IFileMetadata, { path: string; workspace?: string }>('native-fs.metadata'),
  copy: bridge.buildProvider<
    { copied_files: string[]; failed_files?: Array<{ path: string; error: string }> },
    { file_paths: string[]; workspace: string; source_root?: string }
  >('native-fs.copy'),
  remove: bridge.buildProvider<void, { path: string }>('native-fs.remove'),
  rename: bridge.buildProvider<{ new_path: string }, { path: string; new_name: string }>('native-fs.rename'),
};

export const registerFileGatewayBridge = (gateway = new NativeFileGateway()): void => {
  fileGatewayChannels.getFilesByDir.provider((input) => gateway.getFilesByDir(input));
  fileGatewayChannels.listWorkspaceFiles.provider(({ root }) => gateway.listWorkspaceFiles(root));
  fileGatewayChannels.imageBase64.provider(({ path }) => gateway.imageDataUrl(path));
  fileGatewayChannels.fetchRemoteImage.provider(({ url }) => gateway.fetchRemoteImage(url));
  fileGatewayChannels.read.provider(({ path }) => gateway.readText(path));
  fileGatewayChannels.readBuffer.provider(({ path }) => gateway.readBase64(path));
  fileGatewayChannels.temp.provider(() => rejectUngovernedMutation());
  fileGatewayChannels.write.provider(() => rejectUngovernedMutation());
  fileGatewayChannels.metadata.provider(({ path }) => gateway.metadata(path));
  fileGatewayChannels.copy.provider(() => rejectUngovernedMutation());
  fileGatewayChannels.remove.provider(() => rejectUngovernedMutation());
  fileGatewayChannels.rename.provider(() => rejectUngovernedMutation());
};

const rejectUngovernedMutation = (): never => {
  throw new Error(NATIVE_FILE_MUTATION_DISABLED);
};
