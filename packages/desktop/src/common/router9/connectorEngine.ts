/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ConfigFilePlan, ConnectorPlan, ConnectorTarget, EnvVar, Router9Endpoint } from './types';
import { getConnectorTarget } from './targets';

/**
 * Pure plan engine for the 9Router distribution layer.
 *
 * Given a target tool and a running 9Router endpoint, compute exactly what
 * Tomny would set (env vars / config files / copy-paste fields) so the tool
 * routes through 9Router — "auto convert to the format the app needs". This is
 * the seam the user asked for: every tool wants a different shape, and 9Router
 * does the actual format translation downstream.
 *
 * No network, no filesystem, no Node APIs here — safe for both processes and
 * trivially unit-testable.
 */

/** Strip a trailing slash so we can compose URLs predictably. */
const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

/** A bare origin (no `/v1`) — used by Anthropic-style and Codex-style tools. */
export const toOrigin = (baseUrl: string): string => {
  const trimmed = trimTrailingSlash(baseUrl);
  return trimmed.replace(/\/v1$/, '');
};

/** An OpenAI-style base ending in `/v1`. Idempotent. */
export const toV1 = (baseUrl: string): string => {
  const origin = toOrigin(baseUrl);
  return `${origin}/v1`;
};

/** Encode a gateway-native thinking override in the virtual model id. */
export const withRouter9ReasoningEffort = (model: string, effort?: Router9Endpoint['reasoningEffort']): string => {
  const cleanModel = model.replace(/\([^()]+\)\s*$/u, '').trim();
  return effort ? `${cleanModel}(${effort})` : cleanModel;
};

/** Resolve the base URL for a target according to its declared style. */
export const resolveBaseUrl = (target: ConnectorTarget, baseUrl: string): string => {
  return target.baseUrlStyle === 'origin' ? toOrigin(baseUrl) : toV1(baseUrl);
};

/** Pretty JSON with stable 2-space indentation. */
const json = (value: unknown): string => JSON.stringify(value, null, 2);

/** TOML accepts JSON's quoted-string syntax, including escaping. */
const tomlString = (value: string): string => JSON.stringify(value);

/**
 * Build env vars for env-mechanism targets.
 */
const buildEnv = (target: ConnectorTarget, endpoint: Router9Endpoint, baseUrl: string): EnvVar[] => {
  if (target.mechanism !== 'env') return [];
  const env: EnvVar[] = [
    { key: 'OPENAI_BASE_URL', value: baseUrl },
    { key: 'OPENAI_API_KEY', value: endpoint.apiKey },
  ];
  if (endpoint.model) {
    env.push({ key: 'OPENAI_MODEL', value: endpoint.model });
  }
  return env;
};

/**
 * Build config files for configFile-mechanism targets. Each tool has its own
 * schema; we deep-merge so we never clobber unrelated user settings.
 */
const buildFiles = (target: ConnectorTarget, endpoint: Router9Endpoint, baseUrl: string): ConfigFilePlan[] => {
  if (target.mechanism !== 'configFile') return [];

  if (target.id === 'claude-code') {
    // Claude Code's documented LLM-gateway configuration lives in
    // ~/.claude/settings.json. Values under `env` are injected into every
    // Claude Code session. ANTHROPIC_AUTH_TOKEN is intentionally used instead
    // of ANTHROPIC_API_KEY so the gateway key is sent as bearer auth.
    const env: Record<string, string> = {
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: endpoint.apiKey,
    };
    if (endpoint.model) env.ANTHROPIC_MODEL = endpoint.model;
    // Claude Agent ACP does not use settings.env.ANTHROPIC_MODEL while it
    // builds the model picker: it reads the top-level `model` and
    // `availableModels` settings instead. Keep all three values aligned so the
    // independently launched Claude CLI and Tomny's ACP chat surface select
    // the same 9Router model.
    const modelSettings = endpoint.model ? { model: endpoint.model, availableModels: [endpoint.model] } : {};
    return [
      {
        path: '~/.claude/settings.json',
        format: 'json',
        mergeStrategy: 'deepMerge',
        content: json({
          env,
          ...modelSettings,
          ...(endpoint.reasoningEffort ? { effortLevel: endpoint.reasoningEffort } : {}),
        }),
      },
    ];
  }

  if (target.id === 'codex') {
    // Codex 0.145+ supports custom providers in ~/.codex/config.toml. The
    // client key is scoped to Tomny's loopback-only gateway; keeping it in the
    // provider block enables a real one-click setup for independently-launched
    // Codex sessions. The applier creates a backup before merging.
    const selectedModel = endpoint.model ? `model = ${tomlString(endpoint.model)}\n` : '';
    const selectedEffort = endpoint.reasoningEffort
      ? `model_reasoning_effort = ${tomlString(endpoint.reasoningEffort)}\n`
      : '';
    return [
      {
        path: '~/.codex/config.toml',
        format: 'toml',
        mergeStrategy: 'deepMerge',
        content:
          `${selectedModel}${selectedEffort}model_provider = ${tomlString('tomni_gateway')}\n\n` +
          `[model_providers.tomni_gateway]\n` +
          `name = "Tomny Model Gateway"\n` +
          `base_url = ${tomlString(baseUrl)}\n` +
          `wire_api = "responses"\n` +
          `experimental_bearer_token = ${tomlString(endpoint.apiKey)}\n`,
      },
    ];
  }

  if (target.id === 'openclaw') {
    // OpenClaw declares providers in ~/.openclaw/openclaw.json. Use 127.0.0.1
    // (its docs warn against `localhost` due to IPv6 resolution).
    const modelId = endpoint.model ?? 'kr/claude-sonnet-4.5';
    return [
      {
        path: '~/.openclaw/openclaw.json',
        format: 'json',
        mergeStrategy: 'deepMerge',
        content: json({
          models: {
            providers: {
              '9router': {
                baseUrl,
                apiKey: endpoint.apiKey,
                api: 'openai-completions',
                models: [{ id: modelId, name: `9Router · ${modelId}` }],
              },
            },
          },
        }),
      },
    ];
  }

  return [];
};

/**
 * Copy-paste fields shown in the UI for every target, regardless of mechanism.
 * Lets the user configure by hand when auto-apply is not possible (manual
 * targets) or not desired.
 */
const buildFields = (target: ConnectorTarget, endpoint: Router9Endpoint, baseUrl: string): EnvVar[] => {
  const fields: EnvVar[] = [
    { key: 'baseUrl', value: baseUrl },
    { key: 'apiKey', value: endpoint.apiKey },
  ];
  if (endpoint.model) {
    fields.push({ key: 'model', value: endpoint.model });
  }

  if (endpoint.reasoningEffort) {
    fields.push({ key: 'reasoningEffort', value: endpoint.reasoningEffort });
  }
  return fields;
};

/**
 * Compute the connector plan for a target id + endpoint.
 *
 * @throws if the endpoint is incomplete (missing baseUrl/apiKey) or the target
 *   id is unknown — callers should validate before applying side effects.
 */
export const buildConnectorPlan = (targetId: string, endpoint: Router9Endpoint): ConnectorPlan => {
  const target = getConnectorTarget(targetId);
  if (!target) {
    throw new Error(`Unknown 9Router connector target: ${targetId}`);
  }
  if (!endpoint.baseUrl?.trim()) {
    throw new Error('9Router endpoint baseUrl is required');
  }
  if (!endpoint.apiKey?.trim()) {
    throw new Error('9Router endpoint apiKey is required');
  }

  const baseUrl = resolveBaseUrl(target, endpoint.baseUrl);
  return {
    target,
    baseUrl,
    env: buildEnv(target, endpoint, baseUrl),
    files: buildFiles(target, endpoint, baseUrl),
    fields: buildFields(target, endpoint, baseUrl),
  };
};
