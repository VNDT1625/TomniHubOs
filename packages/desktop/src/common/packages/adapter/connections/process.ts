/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import {
  buildProcessService,
  buildServiceProgram,
  COMMAND_TOKEN,
  commonFields,
  connectionId,
  description,
  EXECUTABLE_NAME,
  httpsUrl,
  launchArguments,
  packageName,
  packagePath,
  processCommand,
  title,
  type Shaped,
  webEmbedUrl,
} from '../primitives';
import { isLoopbackWebUrl } from '../loopback';

/**
 * Connections that start a program or show an app: tools, CLIs, embedded web apps, background services, launchers
 * and bridges. Each stays off until the host has a runtime for it and the user has approved it.
 */

export const buildToolConnection = (shaped: Shaped) =>
  shaped({
    kind: z.literal('tool'),
    id: connectionId,
    title,
    description: description.optional(),
    command: z.string().max(64).regex(COMMAND_TOKEN),
    args: launchArguments.optional(),
    ...commonFields,
  });

export const buildCliConnection = (shaped: Shaped) =>
  shaped({
    kind: z.literal('cli'),
    id: connectionId,
    title,
    command: z.string().max(64).regex(COMMAND_TOKEN),
    args: launchArguments.optional(),
    display: z.literal('terminal'),
    /** Where the program comes from; the host installs from this registry only after the user approves. */
    source: z.enum(['npm', 'pypi', 'cargo', 'go', 'binary', 'source']).optional(),
    package: packageName.optional(),
    cwd: packagePath.optional(),
    setup: z.array(processCommand).max(6).optional(),
    ...commonFields,
  });

export const buildWebEmbedConnection = (shaped: Shaped) =>
  shaped({
    kind: z.literal('web-embed'),
    id: connectionId,
    title,
    /** A website shown as an app. There is no partition field: the Main process always chooses it. */
    url: webEmbedUrl.optional(),
    /** Origins the page may navigate to; anything else opens in the normal browser. */
    origins: z.array(httpsUrl(200)).max(20).optional(),
    /** An app that serves its own page on loopback. */
    process: shaped({
      services: z.array(buildProcessService(shaped)).min(1).max(8),
      /** The service whose page is shown, and the path to open. */
      embed: shaped({
        service: connectionId,
        path: z
          .string()
          .regex(/^\/[A-Za-z0-9._~/-]*$/)
          .max(200)
          .optional(),
      }),
    })
      .refine((value) => value.services.some((service) => service.id === value.embed.service), {
        message: 'embed.service must be one of the services',
      })
      .optional(),
    ...commonFields,
  })
    .refine((value) => (value.url === undefined) !== (value.process === undefined), {
      message: 'web-embed needs exactly one of url or process',
    })
    .refine((value) => value.origins === undefined || value.url === undefined || !isLoopbackWebUrl(value.url), {
      message: 'origins are not used with a loopback address',
    });

/**
 * `service`: programs that run in the background from source/, without a page to embed. Two variants by `headless`:
 * - not headless (default): each program declares a loopback `ready.port` and counts as started once it accepts
 *   connections;
 * - `headless: true` (for example a chat bot): a program with no window and no port, no `ready`. It counts as started
 *   while its process stays alive.
 */
export const buildServiceConnection = (shaped: Shaped) =>
  shaped({
    kind: z.literal('service'),
    id: connectionId,
    title,
    description: description.optional(),
    headless: z.literal(true).optional(),
    process: shaped({ services: z.array(buildServiceProgram(shaped)).min(1).max(8) }),
    ...commonFields,
  }).superRefine((value, context) => {
    value.process.services.forEach((service, index) => {
      const hasPort = service.ready !== undefined;
      if (value.headless === true && hasPort) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['process', 'services', index, 'ready'],
          message: 'a headless service has no ready port',
        });
      }
      if (value.headless !== true && !hasPort) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['process', 'services', index, 'ready'],
          message: 'a service needs ready.port unless it is headless',
        });
      }
    });
  });

export const buildLauncherConnection = (shaped: Shaped) =>
  shaped({
    kind: z.literal('launcher'),
    id: connectionId,
    title,
    /**
     * Where the app lives. `installed`: already on the user's machine or too big to ship; the package names the
     * file and the user binds the real path locally, so a package can never point at an arbitrary program.
     * `source`: the app is in source/ and is started from there (needs a runtime the host may not have).
     * `compose`: a compose file in source/ that the host may start after approval.
     */
    target: z.discriminatedUnion('kind', [
      shaped({
        kind: z.literal('installed'),
        executable: z.string().regex(EXECUTABLE_NAME),
        downloadUrl: httpsUrl(500).optional(),
        /** Where a download link comes from (a GitHub Releases asset); the app never downloads it by itself. */
        release: shaped({
          owner: z
            .string()
            .max(100)
            .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
          repo: z
            .string()
            .max(100)
            .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
          assetPattern: z
            .string()
            .min(1)
            .max(200)
            .regex(/^[A-Za-z0-9._*?+\-[\]() ]+$/),
        }).optional(),
      }),
      shaped({
        kind: z.literal('source'),
        command: z.string().max(64).regex(COMMAND_TOKEN),
        args: launchArguments.optional(),
      }),
      shaped({ kind: z.literal('compose'), file: packagePath }),
    ]),
    /** An MCP server of the app, when it has one, so the agent can drive it from chat. */
    mcp: shaped({ command: z.enum(['npx', 'uvx']), args: launchArguments.min(1) }).optional(),
    ...commonFields,
  });

export const buildBridgeConnection = (shaped: Shaped) =>
  shaped({
    kind: z.literal('bridge'),
    id: connectionId,
    title,
    /** Interface description (data, not code). */
    ui: packagePath,
    /** Glue that maps interface events to backend functions. */
    bridge: packagePath,
    backend: shaped({ command: z.string().max(64).regex(COMMAND_TOKEN), args: launchArguments.optional() }),
    ...commonFields,
  });
