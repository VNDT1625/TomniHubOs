/**
 * @license
 * Copyright 2025 AionUi (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in Testing MCP server (Yêu cầu 2b, criterion 2.1 — Agent plane). Lets an
 * agent run a multi-platform test session, fetch a session's report, and list
 * sessions, all through the same {@link ITestOrchestrator} the UI uses (single
 * source of truth). Tool names use snake_case to satisfy function-calling rules,
 * matching the other built-in servers.
 *
 * Tools: `test_run`, `test_report`, `test_list`.
 *
 * Built as a factory returning a configured {@link McpServer}; Task 15.1 injects
 * the real orchestrator and connects a transport. Main-process module — no DOM.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { protectedMcpTextContent } from '@process/agentRuntime/agentMesh/security';
import { buildReport } from '@process/testing/reportBuilder';
import type { ITestOrchestrator } from '@process/testing/testOrchestrator';
import type { TestPlatform, TestScenario, TestStep } from '@process/testing/testingTypes';

/** Stable id of the built-in Testing MCP server (consumed by Task 15.1). */
export const BUILTIN_TESTING_ID = 'builtin-testing';

/** Canonical name of the built-in Testing MCP server (consumed by Task 15.1). */
export const BUILTIN_TESTING_NAME = 'aionui-testing';

/** Injected collaborators for {@link createTestingServer}. */
export type TestingServerDeps = {
  /** The orchestrator that runs sessions + holds their reports. */
  orchestrator: ITestOrchestrator;
};

type TestingServerAccessScope = {
  sessionIds: Set<string>;
};

const STRONG_SESSION_CAPABILITY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requireScopedSession = (deps: TestingServerDeps, scope: TestingServerAccessScope, sessionId: string): string => {
  const normalized = sessionId.trim();
  if (scope.sessionIds.has(normalized)) return normalized;
  if (!STRONG_SESSION_CAPABILITY.test(normalized) || !deps.orchestrator.getSession(normalized)) {
    throw new Error('Unknown or unauthorized test session capability.');
  }
  scope.sessionIds.add(normalized);
  return normalized;
};

const textResult = (
  text: string,
  isError = false
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } => ({
  content: protectedMcpTextContent(text),
  ...(isError ? { isError: true } : {}),
});

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Zod schema for a single scenario step. */
const stepSchema = z.object({
  id: z.string().trim().min(1).max(128),
  description: z.string().trim().min(1).max(2_000),
});

/**
 * Create the Testing {@link McpServer} bound to the injected orchestrator.
 *
 * @param deps The test orchestrator. See {@link TestingServerDeps}.
 * @returns A configured MCP server; the caller (Task 15.1) connects a transport.
 */
export const createTestingServer = (deps: TestingServerDeps): McpServer => {
  const server = new McpServer({ name: BUILTIN_TESTING_NAME, version: '1.0.0' });
  const scope: TestingServerAccessScope = { sessionIds: new Set() };

  server.tool(
    'test_run',
    `Run a test scenario on a platform (web | android | windows). The run executes in an isolated
virtual display (never the user's real desktop), records video + screenshots, and produces a
markdown report. Concurrency is governed by the resource coordinator.

Input:
- name: scenario name (required)
- platform: 'web' | 'android' | 'windows' (required)
- steps: ordered steps [{ id, description }] (required)
- visible: show the run (true) or run hidden (false, default)

Returns the session id and final status.`,
    {
      name: z.string().trim().min(1).max(200).describe('Human-readable scenario name.'),
      platform: z.enum(['web', 'android', 'windows']).describe('Target platform.'),
      steps: z.array(stepSchema).min(1).max(100).describe('Ordered steps to perform.'),
      visible: z.boolean().optional().describe('Show the run instead of running hidden.'),
      viewport: z
        .object({
          width: z.number().int().min(320).max(7_680),
          height: z.number().int().min(240).max(4_320),
          label: z.string().trim().min(1).max(100).optional(),
        })
        .optional()
        .describe('Optional screen size for responsive checks.'),
    },
    async ({ name, platform, steps, visible, viewport }) => {
      try {
        const typedSteps: TestStep[] = steps.map((s) => ({ id: s.id, description: s.description }));
        const typedViewport = viewport
          ? { width: viewport.width, height: viewport.height, label: viewport.label }
          : undefined;
        const scenario: TestScenario = {
          id: `scn-${Date.now()}`,
          name,
          platform: platform as TestPlatform,
          steps: typedSteps,
          viewport: typedViewport,
        };
        const session = await deps.orchestrator.run(scenario, { visibility: visible ? 'visible' : 'hidden' });
        scope.sessionIds.add(session.id);
        return textResult(
          JSON.stringify(
            {
              sessionId: session.id,
              status: session.status,
              reportPath: session.reportPath,
              videoPath: session.videoPath,
            },
            null,
            2
          )
        );
      } catch (error) {
        return textResult(`Error running test: ${describeError(error)}`, true);
      }
    }
  );

  server.tool(
    'test_report',
    `Fetch a report-ready result for a previously-run test session: status, per-step pass/fail,
screenshot paths, generated Markdown, report path, and video path. Use the returned screenshot paths
when creating a DOCX, PPTX, or another user-facing report.

Input:
- sessionId: the id returned by test_run (required)`,
    {
      sessionId: z.string().trim().min(1).max(64).describe('The session id returned by test_run.'),
    },
    async ({ sessionId }) => {
      try {
        const authorizedSessionId = requireScopedSession(deps, scope, sessionId);
        const session = deps.orchestrator.getSession(authorizedSessionId);
        if (!session) return textResult('Unknown or unauthorized test session capability.', true);
        const summary = {
          sessionId: session.id,
          scenarioName: session.scenario.name,
          platform: session.scenario.platform,
          status: session.status,
          steps: session.results.map((result) => ({
            id: result.step.id,
            description: result.step.description,
            passed: result.passed,
            detail: result.detail,
            screenshots: result.screenshots,
          })),
          markdown: buildReport(session).markdown,
          reportPath: session.reportPath,
          videoPath: session.videoPath,
        };
        return textResult(JSON.stringify(summary, null, 2));
      } catch (error) {
        return textResult(`Error fetching report: ${describeError(error)}`, true);
      }
    }
  );

  server.tool(
    'test_report_add_image',
    `Add an existing local PNG, JPEG, or WebP image to a finished test report. The image is copied
into the session artifact directory, attached to the selected step, and the Markdown report is
regenerated immediately. Use this after browser_screenshot/quick_test_capture or when the user
provides another relevant image.

Input:
- sessionId: the id returned by test_run (required)
- stepId: the exact step id returned by test_report (required)
- imagePath: absolute local path of the image to attach (required)`,
    {
      sessionId: z.string().trim().min(1).max(64).describe('The session id returned by test_run.'),
      stepId: z.string().trim().min(1).max(128).describe('The target step id returned by test_report.'),
      imagePath: z.string().trim().min(1).max(4_096).describe('Absolute path to a PNG, JPEG, or WebP image.'),
    },
    async ({ sessionId, stepId, imagePath }) => {
      try {
        const authorizedSessionId = requireScopedSession(deps, scope, sessionId);
        if (!deps.orchestrator.addReportImage) {
          return textResult('Adding images to test reports is unavailable in this application runtime.', true);
        }
        const session = await deps.orchestrator.addReportImage(authorizedSessionId, stepId, imagePath);
        const step = session.results.find((result) => result.step.id === stepId);
        return textResult(
          JSON.stringify(
            {
              sessionId: session.id,
              stepId,
              screenshots: step?.screenshots ?? [],
              markdown: buildReport(session).markdown,
              reportPath: session.reportPath,
            },
            null,
            2
          )
        );
      } catch (error) {
        return textResult(`Error adding report image: ${describeError(error)}`, true);
      }
    }
  );

  server.tool(
    'test_list',
    `List only this MCP connection's test sessions, newest first. After reconnecting, pass exact
session capabilities returned by test_run to reclaim them without global enumeration.`,
    { sessionIds: z.array(z.string().trim().min(1).max(64)).max(16).optional() },
    async ({ sessionIds = [] }) => {
      try {
        for (const sessionId of sessionIds) requireScopedSession(deps, scope, sessionId);
        const sessions = deps.orchestrator
          .listSessions()
          .filter((session) => scope.sessionIds.has(session.id))
          .map((session) => ({
            sessionId: session.id,
            name: session.scenario.name,
            platform: session.scenario.platform,
            status: session.status,
          }));
        return textResult(JSON.stringify(sessions.reverse(), null, 2));
      } catch (error) {
        return textResult(`Error listing sessions: ${describeError(error)}`, true);
      }
    }
  );

  return server;
};
