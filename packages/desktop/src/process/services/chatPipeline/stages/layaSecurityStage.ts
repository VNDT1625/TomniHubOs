/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

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

export class LayaSecurityStage implements IChatStage {
  public readonly id = 'builtin:laya-security';
  public readonly displayName = 'Laya Security Guard';
  public readonly description =
    'Phát hiện và bảo vệ dữ liệu nhạy cảm, mật khẩu, PII bằng Laya Decision Engine (~33ms) và Temp Secret Vault';
  public readonly phase = 'pre_query' as const;
  public readonly icon = 'Shield';
  public readonly defaultEnabled = true;
  public readonly defaultTimeoutMs = 1_000;

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

    // Step 1: Pre-processing with Vietnamese Normalizer (0.001ms)
    const sanitized = shouldNormalize ? normalizeVietnameseSlang(cleanTeencode(input.query)) : input.query;

    // Step 2: Check for direct malicious prompt injections (always block)
    if (PROMPT_INJECTION_PATTERN.test(sanitized)) {
      return {
        decision: 'block',
        reasonCode: 'PROMPT_INJECTION_BLOCKED',
        evidence: { latencyMs: Date.now() - startTime, reason: 'Detected prompt injection pattern' },
      };
    }

    // Step 3: Fast scan for Vietnamese credentials / passwords
    const findings = findVietnameseCredentials(input.query);
    const hasDetectedCredentials = findings.length > 0;

    // Step 4: If predictor is supplied, run non-autoregressive decision pass
    let isCredentialLeaked = hasDetectedCredentials;
    if (this.predictor) {
      try {
        const prediction = await this.predictor(
          { body: sanitized },
          {
            riskType: {
              type: 'choice',
              instructions: 'Classify the security risk of body:',
              criteria: {
                none: 'Safe, benign query, normal coding request, standard prompt',
                credential_exposure: 'Contains passwords, secrets, tokens, mk, login credentials',
                prompt_injection: 'Malicious system prompt override or instruction injection',
              },
            },
            isPasswordLeaked: {
              type: 'noul',
              instructions: 'Does body expose a secret password or credentials?',
            },
          },
          input.signal
        );

        const riskAnswer = prediction.answers['riskType'] as LayaAnswerChoice | undefined;
        const passwordAnswer = prediction.answers['isPasswordLeaked'] as LayaAnswerNoul | undefined;

        // Priority 1: Credential exposure check
        isCredentialLeaked =
          riskAnswer?.choice === 'credential_exposure' ||
          (passwordAnswer && passwordAnswer.noul >= 0.5) ||
          hasDetectedCredentials;

        // Priority 2: Genuine prompt injection attack (high confidence only)
        if (!isCredentialLeaked && riskAnswer?.choice === 'prompt_injection' && (riskAnswer.confidence ?? 0) >= 0.75) {
          return {
            decision: 'block',
            reasonCode: 'PROMPT_INJECTION_BLOCKED',
            evidence: { latencyMs: Date.now() - startTime },
          };
        }
      } catch (error) {
        // If predictor fails or times out, fallback to regex result
        console.warn('[LayaSecurityStage] Predictor pass failed, using fallback:', error);
      }
    }

    // If credential exposure detected
    if (isCredentialLeaked) {
      if (mode === 'block') {
        return {
          decision: 'block',
          reasonCode: 'CREDENTIAL_EXPOSURE_BLOCKED',
          evidence: { latencyMs: Date.now() - startTime },
        };
      }

      // Rewrite mode: store in Temporary Secret Vault + Keyed Secret Index if available
      let rewrittenQuery = input.query;
      const storedSecrets: ChatTemporarySecret[] = [];

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
      } else {
        // Fallback redaction
        rewrittenQuery = redactVietnameseCredentials(input.query);
      }

      return {
        decision: 'rewrite',
        query: rewrittenQuery,
        evidence: {
          redacted: true,
          latencyMs: Date.now() - startTime,
          riskType: 'credential_exposure',
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
      evidence: { latencyMs: Date.now() - startTime },
    };
  }
}
