/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in MCP server for System Insight (Agent plane).
 *
 * Runs as a standalone stdio process spawned by the MCP client, mirroring
 * `resourceServer.ts`. It exposes **read-only** tools: `system_status` (static
 * profile + live CPU/RAM/per-process metrics in one call) and `system_monitor`
 * (what the System Monitor rail tab shows: per-core CPU, disk/network/GPU
 * counters, trend, data age and alerts) — instead of ad-hoc shell commands.
 *
 * Because this server boots in a separate `node` process (not the Electron Main
 * process), it cannot reach the live System Insight service or Electron APIs.
 * Instead it reads the `system-snapshot.json` the sampler periodically writes —
 * the cross-process source of truth — from the directory passed via
 * {@link SYSTEM_SNAPSHOT_DIR_ENV_KEY}.
 *
 * Process boundary: standalone Node.js — no Electron, no DOM APIs.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import {
  BUILTIN_SYSTEM_MONITOR_TOOL_NAME,
  BUILTIN_SYSTEM_NAME,
  BUILTIN_SYSTEM_TOOL_NAME,
  SYSTEM_SNAPSHOT_DIR_ENV_KEY,
} from '../resources/builtinMcp/constants';
import {
  buildMonitorReport,
  describeMonitorReport,
  MONITOR_PROCESS_MAX,
  MONITOR_WINDOW_MAX,
} from './monitorReport/systemMonitorReport';
// Type-only import — erased at compile time, adds no runtime dependency.
import type { SystemSnapshot } from './systemInfoTypes';

/** Name of the persisted snapshot file the sampler writes. */
const SYSTEM_SNAPSHOT_FILE = 'system-snapshot.json';

/** Cap the per-process list in the agent summary to keep the payload compact. */
const TOP_PROCESS_LIMIT = 12;

/** Type guard: a parsed JSON value is shaped like a {@link SystemSnapshot}. */
function isSnapshotShape(value: unknown): value is SystemSnapshot {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<SystemSnapshot>;
  return (
    typeof candidate.static === 'object' &&
    candidate.static !== null &&
    typeof candidate.live === 'object' &&
    candidate.live !== null
  );
}

/** Read and validate the persisted snapshot; `null` when unavailable/malformed. */
function readSnapshot(): SystemSnapshot | null {
  const dir = process.env[SYSTEM_SNAPSHOT_DIR_ENV_KEY];
  if (!dir) return null;
  try {
    const raw = fs.readFileSync(path.join(dir, SYSTEM_SNAPSHOT_FILE), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return isSnapshotShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** A compact, agent-friendly projection of the full snapshot. */
function summarize(snapshot: SystemSnapshot) {
  const { static: profile, live } = snapshot;
  return {
    os: `${profile.os.type} ${profile.os.release} (${profile.os.arch})`,
    hostname: profile.os.hostname,
    cpu: { model: profile.cpu.model, cores: profile.cpu.logicalCores, speedMHz: profile.cpu.speedMHz },
    gpus: profile.gpus.map((gpu) => `${gpu.vendor} ${gpu.model}`.trim()),
    totalMemoryMB: profile.totalMemoryMB,
    disks: profile.disks.map((disk) => ({ mount: disk.mount, freeMB: disk.freeMB, totalMB: disk.totalMB })),
    versions: profile.versions,
    live: {
      sampledAt: live.sampledAt,
      cpuPercent: live.cpu.overallPercent,
      memoryUsedMB: live.memory.usedMB,
      memoryTotalMB: live.memory.totalMB,
      memoryUsedPercent: live.memory.usedPercent,
      loadAvg: live.loadAvg,
      uptimeSec: live.uptimeSec,
      onBattery: live.power.onBattery,
      topProcesses: live.processes.slice(0, TOP_PROCESS_LIMIT).map((process) => ({
        pid: process.pid,
        name: process.name,
        type: process.type,
        cpuPercent: process.cpuPercent,
        memoryMB: process.memoryMB,
      })),
    },
  };
}

/** Human-readable headline for the text payload. */
function describe(summary: ReturnType<typeof summarize>): string {
  const { cpu, live } = summary;
  const pressure =
    live.cpuPercent >= 85 || live.memoryUsedPercent >= 90
      ? 'under heavy load'
      : live.cpuPercent >= 50 || live.memoryUsedPercent >= 70
        ? 'moderately busy'
        : 'idle / light';
  return `Host ${summary.hostname}: ${cpu.model} (${cpu.cores} cores). CPU ${live.cpuPercent}%, RAM ${live.memoryUsedMB}/${live.memoryTotalMB}MB (${live.memoryUsedPercent}%). The machine is currently ${pressure}.`;
}

async function main() {
  const server = new McpServer({ name: BUILTIN_SYSTEM_NAME, version: '1.0.0' });

  server.tool(
    BUILTIN_SYSTEM_TOOL_NAME,
    `READ-ONLY tool that reports the host computer's status from Tomny's System Insight feature.

Use this INSTEAD of running shell commands (top, ps, wmic, systeminfo, free, df, ...) to inspect the machine. It returns a single JSON snapshot plus a short text assessment:
- os / hostname / cpu (model, cores, speed) / gpus / totalMemoryMB / disks / versions — the static host profile
- live.cpuPercent, live.memoryUsedMB / memoryUsedPercent, live.loadAvg, live.uptimeSec, live.onBattery — current measurements
- live.topProcesses — the heaviest processes right now (pid, name, type, cpuPercent, memoryMB)

The data comes from a snapshot the app refreshes every few seconds, so it reflects the recent state without you spawning any process. This tool takes NO input and CANNOT change anything.`,
    async () => {
      const snapshot = readSnapshot();
      if (!snapshot) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'System status is unavailable. The System Insight sampler has not persisted a snapshot yet, or the snapshot directory was not provided to this server.',
            },
          ],
        };
      }
      const summary = summarize(snapshot);
      return {
        content: [
          { type: 'text' as const, text: describe(summary) },
          { type: 'text' as const, text: JSON.stringify(summary, null, 2) },
        ],
      };
    }
  );

  server.tool(
    BUILTIN_SYSTEM_MONITOR_TOOL_NAME,
    `READ-ONLY realtime monitor: returns what the user sees in Tomny's System Monitor tab, as one JSON report.

Use it to observe the machine over time (call it repeatedly, e.g. every few seconds, to watch a build or a load spike) instead of shell commands (top, Get-Counter, typeperf, ...). Fields:
- ageMs / stale / viewerActive — freshness of the data; if stale=true do NOT treat it as live
- cpu.overallPercent, cpu.perCorePercent[], cpu.hottestCorePercent
- memory (used/free/total MB, usedPercent), loadAvg, uptimeSec, onBattery, disks (free/total MB)
- hostTelemetry — Windows disk read/write and network receive/send bytes per second, gpuEnginePeakPercent (peak GPU engine, not total GPU %), osProcessCount. Only sampled while the System Monitor tab is open; otherwise available=false with a reason (null means unavailable, never zero)
- trend — min/avg/max/delta/direction of CPU and RAM over the last N samples (optionally the raw samples)
- tomniProcesses — heaviest Tomny/Electron processes (OS-wide process names are never exposed)
- alerts — plain-language warnings (high CPU/RAM, saturated core, low disk, stale data)

Takes optional filters only and CANNOT change anything.`,
    {
      windowSamples: z
        .number()
        .int()
        .min(1)
        .max(MONITOR_WINDOW_MAX)
        .optional()
        .describe(
          'History samples to summarise for the trend (default 30; one sample is about 2s while the monitor tab is open, 8s otherwise).'
        ),
      includePerCore: z.boolean().optional().describe('Include per-core CPU percentages (default true).'),
      includeSamples: z.boolean().optional().describe('Include the raw cpu/mem samples of the window (default false).'),
      topProcesses: z
        .number()
        .int()
        .min(0)
        .max(MONITOR_PROCESS_MAX)
        .optional()
        .describe('How many Tomny processes to list (default 8).'),
    },
    async (input) => {
      const snapshot = readSnapshot();
      if (!snapshot) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'System monitor data is unavailable. The System Insight sampler has not persisted a snapshot yet, or the snapshot directory was not provided to this server.',
            },
          ],
        };
      }
      const report = buildMonitorReport(snapshot, { now: Date.now(), ...input });
      return {
        content: [
          { type: 'text' as const, text: describeMonitorReport(report) },
          { type: 'text' as const, text: JSON.stringify(report, null, 2) },
        ],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('[SystemMCP] Fatal error:', error);
  process.exit(1);
});
