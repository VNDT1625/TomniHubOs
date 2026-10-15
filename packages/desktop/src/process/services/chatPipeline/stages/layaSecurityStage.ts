/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { redactSecretText } from '@process/agentRuntime/agentMesh/security';
import {
  cleanTeencode,
  findVietnameseCredentials,
  normalizeVietnameseSlang,
  redactVietnameseCredentials,
  type DetectedSecretFinding,
} from '../../security/vietnameseNormalizer';
import type { ChatTemporarySecret, ChatTemporarySecretStore } from '../../security/chatDataProtection';
import type { KeyedSecretIndex } from '../../security/keyedSecretIndex';
import type { LayaAnswerChoice, LayaAnswerNoul, LayaPredictor } from '../../security/layaSemanticEgressModel';
import { analyzeForStage } from '../decisionSession';
import type { ChatStageInput, ChatStageOutput, IChatStage } from '../types';

export type LayaSecurityStageConfig = Readonly<{
  mode?: 'rewrite' | 'block';
  normalizeSlang?: boolean;
}>;

export type LayaSecurityStageDependencies = Readonly<{
  predictor?: LayaPredictor;
  secretStore?: ChatTemporarySecretStore;
  keyedSecretIndex?: KeyedSecretIndex;
}>;

const PROMPT_INJECTION_PATTERN =
  /\b(?:ignore (?:all |previous )?instructions|bypass (?:all |security )?rules|you are now in developer mode|system prompt override)\b/iu;

/** Redact secrets from text that is not the user's own words (retrieved documents, tool output). */
const redactContext = (context: string): string => redactSecretText(redactVietnameseCredentials(context)).text;

const hasSecret = (text: string): boolean =>
  findVietnameseCredentials(text).length > 0 || redactSecretText(text).redacted;

export class LayaSecurityStage implements IChatStage {
  public readonly id = 'builtin:laya-security';
  public readonly displayName = 'Laya Security Guard';
  public readonly description =
    'Phát hiện và bảo vệ dữ liệu nhạy cảm, mật khẩu, PII bằng Laya Decision Engine (~33ms) và Temp Secret Vault';
  public readonly phase = 'pre_query' as const;
  public readonly icon = 'Shield';
  public readonly defaultEnabled = true;
  // The first stage carries the shared model call for every stage after it, so it gets the longest wait.
  public readonly defaultTimeoutMs = 2_500;
  public readonly role = 'guard' as const;
  public readonly decisionTasks = ['security'] as const;

  private readonly predictor?: LayaPredictor;
  private readonly secretStore?: ChatTemporarySecretStore;
  private readonly keyedSecretIndex?: KeyedSecretIndex;

  public constructor(depsOrPredictor?: LayaPredictor | LayaSecurityStageDependencies) {
    if (typeof depsOrPredictor === 'function') {
      this.predictor = depsOrPredictor;
    } else if (depsOrPredictor) {
      this.predictor = depsOrPredictor.predictor;
      this.secretStore = depsOrPredictor.secretStore;
      this.keyedSecretIndex = depsOrPredictor.keyedSecretIndex;
    }
  }

  public async execute(input: ChatStageInput): Promise<ChatStageOutput> {
    const startTime = Date.now();
    const config = (input.config ?? {}) as LayaSecurityStageConfig;
    const mode = config.mode ?? 'rewrite';
    const shouldNormalize = config.normalizeSlang ?? true;
    const scanned = input.context ? ['query', 'context'] : ['query'];

    // Step 1: Pre-processing with Vietnamese Normalizer (0.001ms)
    const sanitized = shouldNormalize ? normalizeVietnameseSlang(cleanTeencode(input.query)) : input.query;
    // The model answers about the normalized text; the labels also hold for the text as typed.
    input.decision?.alias(sanitized, input.query);

    // Step 2: Check for direct malicious prompt injections (always block)
    if (PROMPT_INJECTION_PATTERN.test(sanitized)) {
      return {
        decision: 'block',
        reasonCode: 'PROMPT_INJECTION_BLOCKED',
        evidence: { latencyMs: Date.now() - startTime, reason: 'Detected prompt injection pattern', scanned },
      };
    }

    // Step 2b: Retrieved context is untrusted input too. A document that tries to take over the agent is refused.
    if (input.context && PROMPT_INJECTION_PATTERN.test(input.context)) {
      return {
        decision: 'block',
        reasonCode: 'CONTEXT_PROMPT_INJECTION_BLOCKED',
        evidence: { latencyMs: Date.now() - startTime, reason: 'Prompt injection inside retrieved context', scanned },
      };
    }

    // Step 3: Fast scan for Vietnamese credentials / passwords
    const findings = findVietnameseCredentials(input.query);
    const hasDetectedCredentials = findings.length > 0;
    const contextHasSecret = input.context ? hasSecret(input.context) : false;

    // Step 4: Ask the shared decision model (one forward pass for every planned task)
    let isCredentialLeaked = hasDetectedCredentials;
    const answers = await analyzeForStage(input, this.predictor, 'security', sanitized);
    if (answers) {
      const riskAnswer = answers['riskType'] as LayaAnswerChoice | undefined;
      const credentialAnswer = (answers['isCredentialLeak'] ?? answers['isPasswordLeaked']) as
        | LayaAnswerNoul
        | undefined;

      // Priority 1: Credential exposure check
      isCredentialLeaked =
        riskAnswer?.choice === 'credential_exposure' ||
        (credentialAnswer !== undefined && credentialAnswer.noul >= 0.5) ||
        hasDetectedCredentials;

      // Priority 2: Genuine prompt injection attack (high confidence only)
      if (!isCredentialLeaked && riskAnswer?.choice === 'prompt_injection' && (riskAnswer.confidence ?? 0) >= 0.75) {
        return {
          decision: 'block',
          reasonCode: 'PROMPT_INJECTION_BLOCKED',
          evidence: { latencyMs: Date.now() - startTime, scanned },
        };
      }
    }

    // Credentials that sit in retrieved context are removed before anything leaves the machine.
    const redactedContext = contextHasSecret && input.context ? redactContext(input.context) : undefined;

    if (isCredentialLeaked || contextHasSecret) {
      if (mode === 'block') {
        return {
          decision: 'block',
          reasonCode: isCredentialLeaked ? 'CREDENTIAL_EXPOSURE_BLOCKED' : 'CONTEXT_CREDENTIAL_EXPOSURE_BLOCKED',
          evidence: { latencyMs: Date.now() - startTime, scanned },
        };
      }

      // Rewrite mode: store in Temporary Secret Vault + Keyed Secret Index if available
      let rewrittenQuery = input.query;
      const storedSecrets: ChatTemporarySecret[] = [];

      if (isCredentialLeaked) {
        rewrittenQuery = this.rewriteQuery(input, findings, storedSecrets);
        input.decision?.alias(sanitized, rewrittenQuery);
      }

      return {
        decision: 'rewrite',
        ...(isCredentialLeaked ? { query: rewrittenQuery } : {}),
        ...(redactedContext !== undefined ? { context: redactedContext } : {}),
        evidence: {
          redacted: true,
          latencyMs: Date.now() - startTime,
          riskType: isCredentialLeaked ? 'credential_exposure' : 'context_credential_exposure',
          scanned,
          protectedSecrets: storedSecrets.map((s) => ({
            handle: s.handle,
            label: s.label,
            category: s.category,
          })),
        },
      };
    }

    // No risk detected
    return {
      decision: 'continue',
      evidence: { latencyMs: Date.now() - startTime, scanned },
    };
  }

  private rewriteQuery(
    input: ChatStageInput,
    findings: readonly DetectedSecretFinding[],
    storedSecrets: ChatTemporarySecret[]
  ): string {
    let rewrittenQuery = input.query;

    if (this.secretStore && findings.length > 0) {
      // Replace from end to start to maintain string indices
      for (let i = findings.length - 1; i >= 0; i--) {
        const finding = findings[i];
        if (!finding) continue;

        try {
          const secret = this.secretStore.create(input.runId, {
            label: finding.label,
            category: finding.category,
            confidence: 0.95,
            source: 'text',
            value: finding.value,
          });
          storedSecrets.unshift(secret);

          // Also register in KeyedSecretIndex for outbound egress guard protection
          this.keyedSecretIndex?.add(finding.value);

          const placeholder = `[${finding.label.toUpperCase()}_TEMP_${String(i + 1).padStart(2, '0')}]`;
          rewrittenQuery = rewrittenQuery.slice(0, finding.start) + placeholder + rewrittenQuery.slice(finding.end);
        } catch (e) {
          console.warn('[LayaSecurityStage] Failed to store secret in vault:', e);
        }
      }
      return rewrittenQuery;
    }

    // Fallback redaction
    return redactVietnameseCredentials(input.query);
  }
}
