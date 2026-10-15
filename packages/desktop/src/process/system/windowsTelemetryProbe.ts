/**
 * Best-effort, bounded, read-only Windows performance instrumentation.
 *
 * Runs only while a human is streaming the System Monitor. No user input or
 * process names are interpolated into PowerShell; process inventory is never
 * part of the agent snapshot persisted by SystemInfoService.
 */
import { execFile } from 'node:child_process';
import type { HostTelemetry, OsProcessMetric } from './systemInfoTypes';

const MAX_PROCESSES = 1024;
const MAX_OUTPUT_BYTES = 768 * 1024;
const EXEC_TIMEOUT_MS = 7000;

/** CIM classes use stable property names regardless of Windows UI locale. */
export const WINDOWS_SAMPLE_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
$Error.Clear()
$jobs = $null
try {
  $jobs = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -ErrorAction Stop |
    Where-Object { $_.IDProcess -gt 0 } |
    ForEach-Object {
      [PSCustomObject]@{
        pid = [int]$_.IDProcess
        name = [string]$_.Name
        cpuPercent = [double]$_.PercentProcessorTime
        memoryMB = [math]::Round(([double]$_.WorkingSet) / 1MB, 1)
      }
    })
} catch {}
$disk = $null
try {
  $d = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -ErrorAction Stop |
    Where-Object { $_.Name -eq '_Total' } | Select-Object -First 1
  if ($null -ne $d) {
    $disk = [PSCustomObject]@{
      readBytesPerSec = [double]$d.DiskReadBytesPersec
      writeBytesPerSec = [double]$d.DiskWriteBytesPersec
    }
  }
} catch {}
$network = $null
try {
  $n = @(Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface -ErrorAction Stop)
  if ($n.Count -gt 0) {
    $network = [PSCustomObject]@{
      receiveBytesPerSec = [double](($n | Measure-Object -Property BytesReceivedPersec -Sum).Sum)
      sendBytesPerSec = [double](($n | Measure-Object -Property BytesSentPersec -Sum).Sum)
    }
  }
} catch {}
$gpu = $null
try {
  $g = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop)
  if ($g.Count -gt 0) {
    # GPU Engine counters are per-process/per-engine; the observed maximum is
    # an engine-usage proxy, NOT Windows Task Manager's aggregate GPU metric.
    $gpu = [double](($g | Measure-Object -Property UtilizationPercentage -Maximum).Maximum)
  }
} catch {}
[PSCustomObject]@{
    processes = $jobs
  disk = $disk
  network = $network
  gpuEnginePeakPercent = $gpu
} | ConvertTo-Json -Compress -Depth 4
`;

export type WindowsSampleRaw = {
  processes?: unknown;
  disk?: unknown;
  network?: unknown;
  gpuEnginePeakPercent?: unknown;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const safeNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

const numberField = (value: Record<string, unknown> | null, key: string): number | null =>
  safeNumber(value?.[key]);

/** Validate all child-process output before it crosses into renderer IPC. */
export const parseWindowsTelemetry = (payload: unknown, sampledAt: number): HostTelemetry | null => {
  const body = asRecord(payload);
  if (!body) return null;

  const processes = Array.isArray(body.processes)
    ? body.processes
    : body.processes == null ? null : [body.processes];
  // An empty list from a healthy command is valid; absent data means CIM failed.
  const parsedProcesses: OsProcessMetric[] | null = processes === null ? null :
    processes
      .slice(0, MAX_PROCESSES)
      .flatMap((row): OsProcessMetric[] => {
        const item = asRecord(row);
        const pid = numberField(item, 'pid');
        const name = item?.name;
        if (pid === null || !Number.isSafeInteger(pid) || pid < 1 || typeof name !== 'string') return [];
        return [{
          pid,
          name: name.slice(0, 180),
          cpuPercent: numberField(item, 'cpuPercent'),
          memoryMB: numberField(item, 'memoryMB'),
        }];
      });

  const disk = asRecord(body.disk);
  const read = numberField(disk, 'readBytesPerSec');
  const write = numberField(disk, 'writeBytesPerSec');
  const network = asRecord(body.network);
  const receive = numberField(network, 'receiveBytesPerSec');
  const send = numberField(network, 'sendBytesPerSec');
  const peak = safeNumber(body.gpuEnginePeakPercent);

  return {
    source: 'windows-cim',
    sampledAt,
    processes: parsedProcesses,
    processLimitReached: Array.isArray(processes) && processes.length > MAX_PROCESSES,
    disk: read !== null && write !== null ? { readBytesPerSec: read, writeBytesPerSec: write } : null,
    network: receive !== null && send !== null ? { receiveBytesPerSec: receive, sendBytesPerSec: send } : null,
    gpuEnginePeakPercent: peak === null ? null : Math.min(100, peak),
  };
};

export type TelemetryExecutor = (script: string) => Promise<string>;

const defaultExecutor: TelemetryExecutor = (script) => new Promise((resolve, reject) => {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  execFile(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { encoding: 'utf8', windowsHide: true, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
    (error, stdout) => error ? reject(error) : resolve(stdout)
  );
});

/**
 * Windows-only. Unsupported or denied counters return null (not fabricated 0).
 * Reject oversized or invalid JSON rather than allowing unbounded IPC payloads.
 */
export const probeWindowsTelemetry = async (
  executor: TelemetryExecutor = defaultExecutor,
  platform: NodeJS.Platform = process.platform
): Promise<HostTelemetry | null> => {
  if (platform !== 'win32') return null;
  try {
    const output = await executor(WINDOWS_SAMPLE_SCRIPT);
    if (!output || Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) return null;
    return parseWindowsTelemetry(JSON.parse(output) as unknown, Date.now());
  } catch {
    return null;
  }
};
