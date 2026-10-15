import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { ExplorerServiceError } from './pathGuard';

const runFile = promisify(execFile);
const SYSTEM_ROOT = process.env.SystemRoot ?? 'C:\\Windows';
const POWERSHELL_PATH = path.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

const LOCAL_DRIVE_SCRIPT = [
  '$ErrorActionPreference = "Stop";',
  '$root = [Environment]::GetEnvironmentVariable("TOMNI_EXPLORER_LOCAL_ROOT");',
  'try { $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($root));',
  'if ($drive.DriveType -eq [IO.DriveType]::Network -or $drive.DriveType -eq [IO.DriveType]::Unknown',
  '-or $drive.DriveType -eq [IO.DriveType]::NoRootDirectory) { exit 1 }; exit 0 } catch { exit 1 }',
].join(' ');

/** Refuse mapped network drives before Main can issue a local-only directory grant. */
export const assertLocalExplorerRoot = async (root: string): Promise<void> => {
  if (process.platform !== 'win32') throw new ExplorerServiceError('UNAVAILABLE');
  if (root.startsWith('\\\\') || root.startsWith('//')) throw new ExplorerServiceError('DENIED');
  try {
    await runFile(POWERSHELL_PATH, ['-NoProfile', '-NonInteractive', '-Command', LOCAL_DRIVE_SCRIPT], {
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 4096,
      env: { SystemRoot: SYSTEM_ROOT, TOMNI_EXPLORER_LOCAL_ROOT: root },
    });
  } catch {
    throw new ExplorerServiceError('DENIED');
  }
};

const MOVE_SCRIPT = [
  '$ErrorActionPreference = "Stop";',
  '$source = [Environment]::GetEnvironmentVariable("TOMNI_EXPLORER_MOVE_SOURCE");',
  '$target = [Environment]::GetEnvironmentVariable("TOMNI_EXPLORER_MOVE_TARGET");',
  'try {',
  'if ([IO.Directory]::Exists($source)) { [IO.Directory]::Move($source, $target) }',
  'else { [IO.File]::Move($source, $target) }; exit 0',
  '} catch {',
  'if ([IO.File]::Exists($target) -or [IO.Directory]::Exists($target)) { exit 17 }; exit 1',
  '}',
].join(' ');

/** .NET Move uses no-replace Windows moves and preserves metadata. Paths are data, never shell code. */
export const moveExplorerItem = async (source: string, target: string): Promise<void> => {
  if (process.platform !== 'win32') throw new ExplorerServiceError('UNAVAILABLE');
  try {
    await runFile(POWERSHELL_PATH, ['-NoProfile', '-NonInteractive', '-Command', MOVE_SCRIPT], {
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 4096,
      env: { SystemRoot: SYSTEM_ROOT, TOMNI_EXPLORER_MOVE_SOURCE: source, TOMNI_EXPLORER_MOVE_TARGET: target },
    });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    throw new ExplorerServiceError(code === 17 ? 'CONFLICT' : 'IO_ERROR');
  }
};
