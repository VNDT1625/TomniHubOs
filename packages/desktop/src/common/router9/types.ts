/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 9Router distribution layer — shared types.
 *
 * 9Router exposes a single local OpenAI-compatible endpoint (default
 * `http://127.0.0.1:20128/v1`) that aggregates 40+ providers behind
 * auto-fallback + format translation. This module models how Tomny
 * *distributes* that endpoint to external CLI / IDE tools, each of which
 * expects credentials in a different shape ("auto convert to the format the
 * app needs"). Nothing here performs network I/O — it only computes plans.
 */

/**
 * The wire format a target tool speaks to its model backend. 9Router itself
 * translates between formats, so the only thing Tomny must get right is how a
 * target is *configured* (env var name, base-url suffix, config file shape).
 */
export type RouterProtocol = 'openai' | 'anthropic' | 'gemini';

/** Stable identity for the gateway provider managed internally by Tomny. */
export const TOMNI_GATEWAY_PROVIDER_ID = 'tomni-model-gateway';

/** Dedicated gateway client used by Tomny itself (never shared with external CLIs). */
export const TOMNI_GATEWAY_APP_CLIENT_NAME = 'Tomny · App';

/**
 * How a target consumes its configuration. Drives what kind of plan Tomny can
 * produce automatically vs. what must be shown as manual instructions.
 */
export type ConnectorMechanism =
  | 'env' // export environment variables (Codex, generic shells)
  | 'configFile' // write/merge a JSON (or JSON-like) config file on disk
  | 'manual'; // GUI-only: render copy-paste fields for the user

export const ROUTER9_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Request-level reasoning intensity understood and translated by the managed gateway. */
export type Router9ReasoningEffort = (typeof ROUTER9_REASONING_EFFORTS)[number];

/** Connection coordinates for a running 9Router instance. */
export type Router9Endpoint = {
  /** Full OpenAI-compatible base, e.g. `http://127.0.0.1:20128/v1`. */
  baseUrl: string;
  /** API key copied from the 9Router dashboard. */
  apiKey: string;
  /** Model id (or combo name) to default the target to, e.g. `kr/claude-sonnet-4.5`. */
  model?: string;

  /** Optional request-level reasoning intensity; omitted means the target/model default. */
  reasoningEffort?: Router9ReasoningEffort;
};

/**
 * A single environment variable a target needs. Kept separate from file plans
 * so callers can apply env without touching disk.
 */
export type EnvVar = {
  key: string;
  value: string;
};

/**
 * A file the connector wants to write. `mergeStrategy` tells the applier how to
 * combine with any existing file (never blindly overwrite user config).
 */
export type ConfigFilePlan = {
  /** Path with `~` for home — resolved by the applier, not here. */
  path: string;
  /** Serialized content to write (already pretty-printed JSON when applicable). */
  content: string;
  /** Logical format, for the applier's merge step. */
  format: 'json' | 'toml' | 'text';
  /**
   * How to reconcile with an existing file:
   * - `replace`: overwrite whole file
   * - `deepMerge`: merge objects (JSON only), target keys win
   * - `createIfMissing`: only write when absent
   */
  mergeStrategy: 'replace' | 'deepMerge' | 'createIfMissing';
};

/** A definition of one connectable CLI / IDE target. */
export type ConnectorTarget = {
  /** Stable id, e.g. `kiro`, `antigravity`, `claude-code`. */
  id: string;
  /** Human label, e.g. `Kiro`. Not translated — proper noun. */
  label: string;
  /** Wire format the target expects from its endpoint. */
  protocol: RouterProtocol;
  /** Primary configuration mechanism. */
  mechanism: ConnectorMechanism;
  /** i18n key for a short description of how the connection works. */
  descriptionKey: string;
  /**
   * Agent key used by Tomny's main chat preference store. Omitted for tools
   * that are external-only and do not have a matching chat surface.
   */
  agentPreferenceKey?: string;
  /**
   * Whether the target needs the `/v1` suffix on the base URL. Anthropic-style
   * tools often want the bare origin; OpenAI-style tools want `/v1`.
   */
  baseUrlStyle: 'withV1' | 'origin';
};

/**
 * The computed, ready-to-apply result for a target. A plan never mutates
 * anything; an applier (in the Main process) is responsible for side effects.
 */
export type ConnectorPlan = {
  target: ConnectorTarget;
  /** Resolved base URL adjusted for the target's `baseUrlStyle`. */
  baseUrl: string;
  /** Env vars to set (empty unless mechanism is `env`). */
  env: EnvVar[];
  /** Config files to write (empty unless mechanism is `configFile`). */
  files: ConfigFilePlan[];
  /**
   * Copy-paste fields always provided so the UI can show them regardless of
   * mechanism (the user may prefer to configure by hand).
   */
  fields: EnvVar[];
};
