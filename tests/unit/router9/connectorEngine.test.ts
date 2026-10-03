/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for the 9Router connector engine — the pure layer that turns a
 * target tool + endpoint into an apply-able plan ("auto convert to the format
 * the app needs"). No Electron / network / filesystem involved.
 */

import { describe, expect, it } from 'vitest';
import {
  buildConnectorPlan,
  CONNECTOR_TARGETS,
  getConnectorTarget,
  toOrigin,
  toV1,
  withRouter9ReasoningEffort,
} from '@/common/router9';
import type { Router9Endpoint } from '@/common/router9';

const endpoint: Router9Endpoint = {
  baseUrl: 'http://127.0.0.1:20129/v1',
  apiKey: 'sk_test_key',
  model: 'kr/claude-sonnet-4.5',
};

describe('url normalization', () => {
  it('replaces a previous gateway reasoning suffix without duplicating it', () => {
    expect(withRouter9ReasoningEffort('cx/gpt-5.6-luna(high)', 'low')).toBe('cx/gpt-5.6-luna(low)');
    expect(withRouter9ReasoningEffort('cx/gpt-5.6-luna', undefined)).toBe('cx/gpt-5.6-luna');
  });
  it('toOrigin strips /v1 and trailing slashes (idempotent)', () => {
    expect(toOrigin('http://127.0.0.1:20129/v1')).toBe('http://127.0.0.1:20129');
    expect(toOrigin('http://127.0.0.1:20129/v1/')).toBe('http://127.0.0.1:20129');
    expect(toOrigin('http://127.0.0.1:20129')).toBe('http://127.0.0.1:20129');
  });

  it('toV1 appends a single /v1 (idempotent)', () => {
    expect(toV1('http://127.0.0.1:20129')).toBe('http://127.0.0.1:20129/v1');
    expect(toV1('http://127.0.0.1:20129/v1')).toBe('http://127.0.0.1:20129/v1');
    expect(toV1('http://127.0.0.1:20129/')).toBe('http://127.0.0.1:20129/v1');
  });
});

describe('registry', () => {
  it('exposes the requested CLI/IDE targets', () => {
    const ids = CONNECTOR_TARGETS.map((t) => t.id);
    expect(ids).toEqual(
      expect.arrayContaining(['kiro', 'antigravity', 'claude-code', 'codex', 'cursor', 'cline', 'openclaw'])
    );
  });

  it('looks up a target by id', () => {
    expect(getConnectorTarget('kiro')?.label).toBe('Kiro');
    expect(getConnectorTarget('nope')).toBeUndefined();
  });

  it('maps connector targets to their matching Tomny chat preference keys', () => {
    expect(getConnectorTarget('claude-code')?.agentPreferenceKey).toBe('claude');
    expect(getConnectorTarget('codex')?.agentPreferenceKey).toBe('codex');
    expect(getConnectorTarget('kiro')?.agentPreferenceKey).toBe('kiro');
    expect(getConnectorTarget('antigravity')?.agentPreferenceKey).toBe('antigravity');
    expect(getConnectorTarget('cursor')?.agentPreferenceKey).toBe('cursor');
    expect(getConnectorTarget('openclaw')?.agentPreferenceKey).toBe('openclaw-gateway');
    expect(getConnectorTarget('cline')?.agentPreferenceKey).toBeUndefined();
  });
});

describe('buildConnectorPlan — validation', () => {
  it('throws on unknown target', () => {
    expect(() => buildConnectorPlan('ghost', endpoint)).toThrow(/Unknown 9Router connector target/);
  });

  it('throws when baseUrl is empty', () => {
    expect(() => buildConnectorPlan('kiro', { baseUrl: '  ', apiKey: 'k' })).toThrow(/baseUrl is required/);
  });

  it('throws when apiKey is empty', () => {
    expect(() => buildConnectorPlan('kiro', { baseUrl: 'http://x/v1', apiKey: '' })).toThrow(/apiKey is required/);
  });
});

describe('buildConnectorPlan — protocol/base-url shaping', () => {
  it('codex writes a durable Responses provider to config.toml', () => {
    const plan = buildConnectorPlan('codex', endpoint);
    expect(plan.baseUrl).toBe('http://127.0.0.1:20129/v1');
    expect(plan.env).toHaveLength(0);
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0].path).toBe('~/.codex/config.toml');
    expect(plan.files[0].content).toContain('model_provider = "tomni_gateway"');
    expect(plan.files[0].content).toContain('base_url = "http://127.0.0.1:20129/v1"');
    expect(plan.files[0].content).toContain('wire_api = "responses"');
    expect(plan.files[0].content).toContain('experimental_bearer_token = "sk_test_key"');
  });

  it('kiro (manual) keeps /v1 and produces copy-paste fields only', () => {
    const plan = buildConnectorPlan('kiro', endpoint);
    expect(plan.baseUrl).toBe('http://127.0.0.1:20129/v1');
    expect(plan.env).toHaveLength(0);
    expect(plan.files).toHaveLength(0);
    expect(plan.fields).toEqual([
      { key: 'baseUrl', value: 'http://127.0.0.1:20129/v1' },
      { key: 'apiKey', value: 'sk_test_key' },
      { key: 'model', value: 'kr/claude-sonnet-4.5' },
    ]);
  });
});

describe('buildConnectorPlan — config files', () => {
  it('writes an explicit reasoning effort for Claude Code and Codex without changing the model id', () => {
    const configured = { ...endpoint, reasoningEffort: 'high' as const };
    const claude = JSON.parse(buildConnectorPlan('claude-code', configured).files[0].content) as {
      effortLevel?: string;
      model?: string;
    };
    const codex = buildConnectorPlan('codex', configured).files[0].content;

    expect(claude.model).toBe('kr/claude-sonnet-4.5');
    expect(claude.effortLevel).toBe('high');
    expect(codex).toContain(`model = ${JSON.stringify('kr/claude-sonnet-4.5')}`);
    expect(codex).toContain(`model_reasoning_effort = ${JSON.stringify('high')}`);
  });

  it('keeps reasoning automatic when no effort is selected', () => {
    const claude = JSON.parse(buildConnectorPlan('claude-code', endpoint).files[0].content) as {
      effortLevel?: string;
    };
    const codex = buildConnectorPlan('codex', endpoint).files[0].content;

    expect(claude.effortLevel).toBeUndefined();
    expect(codex).not.toContain('model_reasoning_effort');
  });
  it('claude-code writes the documented gateway env settings with bare origin', () => {
    const plan = buildConnectorPlan('claude-code', endpoint);
    expect(plan.files).toHaveLength(1);
    const file = plan.files[0];
    expect(plan.baseUrl).toBe('http://127.0.0.1:20129');
    expect(file.path).toBe('~/.claude/settings.json');
    expect(file.mergeStrategy).toBe('deepMerge');
    const parsed = JSON.parse(file.content) as {
      env: Record<string, string>;
      model: string;
      availableModels: string[];
    };
    expect(parsed.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:20129');
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe('sk_test_key');
    expect(parsed.env.ANTHROPIC_MODEL).toBe('kr/claude-sonnet-4.5');
    expect(parsed.model).toBe('kr/claude-sonnet-4.5');
    expect(parsed.availableModels).toEqual(['kr/claude-sonnet-4.5']);
  });

  it('openclaw writes a Tomny gateway provider block with the chosen model', () => {
    const plan = buildConnectorPlan('openclaw', endpoint);
    const file = plan.files[0];
    expect(file.path).toBe('~/.openclaw/openclaw.json');
    const parsed = JSON.parse(file.content) as {
      models: {
        providers: { tomni_gateway: { baseUrl: string; apiKey: string; api: string; models: { id: string }[] } };
      };
    };
    const provider = parsed.models.providers['tomni_gateway'];
    expect(provider.baseUrl).toBe('http://127.0.0.1:20129/v1');
    expect(provider.api).toBe('openai-completions');
    expect(provider.models[0].id).toBe('kr/claude-sonnet-4.5');
  });

  it('openclaw falls back to a default model when none is given', () => {
    const plan = buildConnectorPlan('openclaw', { baseUrl: 'http://127.0.0.1:20129/v1', apiKey: 'k' });
    const parsed = JSON.parse(plan.files[0].content) as {
      models: { providers: { tomni_gateway: { models: { id: string }[] } } };
    };
    expect(parsed.models.providers['tomni_gateway'].models[0].id).toBe('kr/claude-sonnet-4.5');
    // No model field in copy-paste fields when endpoint.model is absent.
    expect(plan.fields.find((f) => f.key === 'model')).toBeUndefined();
  });
});
