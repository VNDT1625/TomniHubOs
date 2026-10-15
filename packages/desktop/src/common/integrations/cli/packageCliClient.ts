/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Renderer-safe client for "Open terminal with <CLI>" (docs/platform/repotopackage-design.md section 10.10).
 *
 * It sends the package id and the connection id, receives a title and a one-line command from Main, opens a new
 * terminal session and types the line in WITHOUT a line break, so the person reads it and presses Enter themselves.
 * Nothing here can run the command: a line that is not one printable line is refused before it is typed.
 *
 * The terminal channel names mirror `TERMINAL_CHANNELS` of the Main terminal bridge (a unit test keeps them equal);
 * the Main module is Node-only and must not be imported into the renderer.
 */

import { bridge } from '@office-ai/platform';
import {
  isTypeableCommandLine,
  PACKAGE_CLI_TERMINAL_LAUNCH_CHANNEL,
  type TerminalLaunchErrorCode,
  type TerminalLaunchRequest,
  type TerminalLaunchResult,
} from './packageCli';

export const TERMINAL_CREATE_CHANNEL = 'terminal.create';
export const TERMINAL_WRITE_CHANNEL = 'terminal.write';

/** A request to a Main provider that is not registered must fail, not wait for ever. */
export const PACKAGE_CLI_TERMINAL_TIMEOUT_MS = 10_000;

type TerminalEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };
type TerminalSessionRef = { id: string };

export type OpenInTerminalResult =
  | Readonly<{ ok: true; sessionId: string }>
  | Readonly<{ ok: false; error: TerminalLaunchErrorCode | 'TERMINAL_FAILED' }>;

type Invoke<Req, Res> = { invoke: (request: Req) => Promise<Res> };

export type PackageCliClientPorts = Readonly<{
  launch: Invoke<TerminalLaunchRequest, TerminalLaunchResult>;
  create: Invoke<{ options: { title?: string; cwd?: string } }, TerminalEnvelope<TerminalSessionRef>>;
  write: Invoke<{ id: string; data: string }, TerminalEnvelope<void>>;
}>;

const defaultPorts = (): PackageCliClientPorts => ({
  launch: bridge.buildProvider<TerminalLaunchResult, TerminalLaunchRequest>(PACKAGE_CLI_TERMINAL_LAUNCH_CHANNEL),
  create: bridge.buildProvider<TerminalEnvelope<TerminalSessionRef>, { options: { title?: string; cwd?: string } }>(
    TERMINAL_CREATE_CHANNEL
  ),
  write: bridge.buildProvider<TerminalEnvelope<void>, { id: string; data: string }>(TERMINAL_WRITE_CHANNEL),
});

const withTimeout = <T>(task: Promise<T>, fallback: T, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });

/** Never rejects: every failure is a stable code. */
export const createPackageCliClient = (ports: PackageCliClientPorts = defaultPorts()) => ({
  openInTerminal: async (
    request: TerminalLaunchRequest,
    options: Readonly<{ cwd?: string; timeoutMs?: number }> = {}
  ): Promise<OpenInTerminalResult> => {
    const timeoutMs = options.timeoutMs ?? PACKAGE_CLI_TERMINAL_TIMEOUT_MS;
    const launch = await withTimeout<TerminalLaunchResult>(
      ports.launch.invoke({ packageId: request.packageId, connectionId: request.connectionId }),
      { ok: false, error: 'UNAVAILABLE' },
      timeoutMs
    );
    if (launch.ok === false) return { ok: false, error: launch.error };
    // Defence in depth: Main already guarantees one printable line; a line break here would press Enter.
    if (!isTypeableCommandLine(launch.commandLine)) return { ok: false, error: 'UNAVAILABLE' };
    const created = await withTimeout<TerminalEnvelope<TerminalSessionRef>>(
      ports.create.invoke({
        options: { title: launch.title, ...(options.cwd === undefined ? {} : { cwd: options.cwd }) },
      }),
      { ok: false, error: 'timeout' },
      timeoutMs
    );
    if (created.ok === false) return { ok: false, error: 'TERMINAL_FAILED' };
    const typed = await withTimeout<TerminalEnvelope<void>>(
      ports.write.invoke({ id: created.data.id, data: launch.commandLine }),
      { ok: false, error: 'timeout' },
      timeoutMs
    );
    return typed.ok === false ? { ok: false, error: 'TERMINAL_FAILED' } : { ok: true, sessionId: created.data.id };
  },
});

export const packageCliClient = createPackageCliClient();
