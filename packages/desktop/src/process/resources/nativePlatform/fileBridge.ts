import { bridge } from '@office-ai/platform';
import { NativeOfficeWatchService, NativeWatchService, type ZipEntry } from './fileOperations';

export const nativeFileOperationChannels = {
  createZip: bridge.buildProvider<boolean, { path: string; request_id?: string; files: ZipEntry[] }>('native-fs.zip'),
  cancelZip: bridge.buildProvider<boolean, { request_id: string }>('native-fs.zip-cancel'),
  watchStart: bridge.buildProvider<void, { file_path: string }>('native-fs.watch-start'),
  watchStop: bridge.buildProvider<void, { file_path: string }>('native-fs.watch-stop'),
  watchStopAll: bridge.buildProvider<void, void>('native-fs.watch-stop-all'),
  fileChanged: bridge.buildEmitter<{ file_path: string; event_type: string }>('fileWatch.fileChanged'),
  officeWatchStart: bridge.buildProvider<void, { workspace: string }>('native-fs.office-watch-start'),
  officeWatchStop: bridge.buildProvider<void, { workspace: string }>('native-fs.office-watch-stop'),
  officeFileAdded: bridge.buildEmitter<{ file_path: string; workspace: string }>('workspaceOfficeWatch.fileAdded'),
};

/**
 * The legacy ZIP endpoint accepts renderer-controlled output and source paths
 * but has no actor/path capability, consent, or durable governance receipt
 * contract. Keep its typed channel for compatibility, but fail closed before
 * invoking the writer until that governed Main seam exists.
 */
const NATIVE_ZIP_GOVERNANCE_REQUIRED =
  'Native ZIP creation is disabled until the governed Main file-operation seam is available.';

export const registerNativeFileOperationBridge = (
  watch = new NativeWatchService(),
  officeWatch = new NativeOfficeWatchService()
): void => {
  nativeFileOperationChannels.createZip.provider(() => Promise.reject(new Error(NATIVE_ZIP_GOVERNANCE_REQUIRED)));
  nativeFileOperationChannels.cancelZip.provider(() => Promise.resolve(false));
  nativeFileOperationChannels.watchStart.provider(({ file_path }) => {
    watch.start(file_path, (event) => nativeFileOperationChannels.fileChanged.emit(event));
    return Promise.resolve();
  });
  nativeFileOperationChannels.watchStop.provider(({ file_path }) => {
    watch.stop(file_path);
    return Promise.resolve();
  });
  nativeFileOperationChannels.watchStopAll.provider(() => {
    watch.stopAll();
    return Promise.resolve();
  });
  nativeFileOperationChannels.officeWatchStart.provider(({ workspace }) =>
    officeWatch.start(workspace, (file_path, resolvedWorkspace) =>
      nativeFileOperationChannels.officeFileAdded.emit({ file_path, workspace: resolvedWorkspace })
    )
  );
  nativeFileOperationChannels.officeWatchStop.provider(({ workspace }) => {
    officeWatch.stop(workspace);
    return Promise.resolve();
  });
};
