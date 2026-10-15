/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main side of "Open terminal with <CLI>" (docs/platform/repotopackage-design.md sections 10.10 and 14, S14). The
 * renderer sends a package id and a connection id and nothing else; Main answers with a title and the one-line
 * command the terminal types in. The line is never run from here, and the answer carries no path or value. A request
 * with any other field, or a CLI that is not turned on, is refused with a stable code.
 *
 * Same transport as the `web-embed` open-app channel (the platform bridge), so there is no preload surface to add.
 */

import { bridge } from '@office-ai/platform';
import {
  PACKAGE_CLI_TERMINAL_LAUNCH_CHANNEL,
  type TerminalLaunchRequest,
  type TerminalLaunchResult,
} from '@/common/integrations/cli/packageCli';
import type { PackageCliService } from '@process/integrations/connections/cli/packageCliService';

export const packageCliChannels = {
  terminalLaunch: bridge.buildProvider<TerminalLaunchResult, TerminalLaunchRequest>(
    PACKAGE_CLI_TERMINAL_LAUNCH_CHANNEL
  ),
};

/** Registers the provider; the returned function makes it answer `UNAVAILABLE` (the platform cannot unbind it). */
export const registerPackageCliBridge = (service: Pick<PackageCliService, 'terminalLaunch'>): (() => void) => {
  let active = true;
  packageCliChannels.terminalLaunch.provider(
    async (request): Promise<TerminalLaunchResult> =>
      active ? service.terminalLaunch(request) : { ok: false, error: 'UNAVAILABLE' }
  );
  return () => {
    active = false;
  };
};
