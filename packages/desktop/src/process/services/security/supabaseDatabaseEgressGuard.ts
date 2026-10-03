/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type { LayaAnswerChoice, LayaPredictor } from './layaSemanticEgressModel';

export type SupabaseEgressRiskType =
  | 'safe'
  | 'sql_injection'
  | 'destructive_script'
  | 'rls_bypass'
  | 'exempt_local_storage';

export type SupabaseEgressDecision = 'allow' | 'block';

export type SupabaseEgressInspectOptions = Readonly<{
  destination: string; // e.g. 'supabase', 'supabase://...', 'https://*.supabase.co', or 'local_note', 'local_draft'
  runId?: string;
  isDryRun?: boolean;
}>;

export type SupabaseEgressAuditReceipt = Readonly<{
  payloadHash: string;
  destination: string;
  riskType: SupabaseEgressRiskType;
  decision: SupabaseEgressDecision;
  timestamp: number;
  reasonCode: string;
}>;

export type SupabaseEgressInspectionResult = Readonly<{
  allowed: boolean;
  decision: SupabaseEgressDecision;
  riskType: SupabaseEgressRiskType;
  reasonCode: string;
  auditReceipt: SupabaseEgressAuditReceipt;
  latencyMs: number;
  method: 'exempt' | 'deterministic_pattern' | 'laya_neural';
}>;

export class SupabaseDatabaseEgressGuard {
  public constructor(private readonly predictor?: LayaPredictor) {}

  public async inspect(
    payload: string | Record<string, unknown>,
    options: SupabaseEgressInspectOptions,
    signal?: AbortSignal
  ): Promise<SupabaseEgressInspectionResult> {
    const startTime = Date.now();
    const destination = options.destination.toLowerCase();

    // 1. SELECTIVE SCOPE BOUNDARY:
    // Local-only storage operations (Notes, Drafts, local files) are strictly exempt.
    // They bypass inspection completely: zero latency, zero scanning, 100% privacy.
    if (this.isExemptLocalDestination(destination)) {
      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
      return {
        allowed: true,
        decision: 'allow',
        riskType: 'exempt_local_storage',
        reasonCode: 'LOCAL_STORAGE_EXEMPT',
        latencyMs: 0,
        method: 'exempt',
        auditReceipt: {
          payloadHash: this.hash(payloadStr),
          destination: options.destination,
          riskType: 'exempt_local_storage',
          decision: 'allow',
          timestamp: Date.now(),
          reasonCode: 'LOCAL_STORAGE_EXEMPT',
        },
      };
    }

    // 2. Governed outbound inspection for Supabase destination
    const serializedPayload = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const payloadHash = this.hash(serializedPayload);

    // 2a. Deterministic pattern checks
    const deterministicRisk = this.checkDeterministicPatterns(serializedPayload);
    if (deterministicRisk) {
      return {
        allowed: false,
        decision: 'block',
        riskType: deterministicRisk,
        reasonCode: `DETERMINISTIC_${deterministicRisk.toUpperCase()}`,
        latencyMs: Date.now() - startTime,
        method: 'deterministic_pattern',
        auditReceipt: {
          payloadHash,
          destination: options.destination,
          riskType: deterministicRisk,
          decision: 'block',
          timestamp: Date.now(),
          reasonCode: `DETERMINISTIC_${deterministicRisk.toUpperCase()}`,
        },
      };
    }

    // 2b. Neural classification via Laya (~26ms)
    let neuralRisk: SupabaseEgressRiskType = 'safe';
    let method: 'deterministic_pattern' | 'laya_neural' = 'deterministic_pattern';

    if (this.predictor) {
      try {
        const prediction = await this.predictor(
          { body: serializedPayload.slice(0, 1000) },
          {
            databaseSafety: {
              type: 'choice',
              instructions: 'Classify if the payload poses a destructive or malicious risk to Supabase database:',
              criteria: {
                safe: 'Standard user data, legitimate text, safe JSON fields, normal updates',
                sql_injection: 'SQL injection patterns, unauthorized UNION/SELECT, statement stacking',
                destructive_script: 'Destructive DDL/DML, DROP/TRUNCATE/ALTER table commands, table wipe attempts',
                rls_bypass: 'Malicious auth header overrides, role elevation, RLS circumvention payload',
              },
            },
          },
          signal
        );

        const choice = (prediction.answers['databaseSafety'] as LayaAnswerChoice | undefined)?.choice as
          | SupabaseEgressRiskType
          | undefined;

        if (choice && choice !== 'safe') {
          neuralRisk = choice;
          method = 'laya_neural';
        }
      } catch (err) {
        console.warn('[SupabaseDatabaseEgressGuard] Laya neural check failed:', err);
      }
    }

    const isAllowed = neuralRisk === 'safe';
    const decision: SupabaseEgressDecision = isAllowed ? 'allow' : 'block';
    const reasonCode = isAllowed ? 'PAYLOAD_VERIFIED_SAFE' : `NEURAL_${neuralRisk.toUpperCase()}`;

    return {
      allowed: isAllowed,
      decision,
      riskType: neuralRisk,
      reasonCode,
      latencyMs: Date.now() - startTime,
      method: this.predictor ? 'laya_neural' : 'deterministic_pattern',
      auditReceipt: {
        payloadHash,
        destination: options.destination,
        riskType: neuralRisk,
        decision,
        timestamp: Date.now(),
        reasonCode,
      },
    };
  }

  private isExemptLocalDestination(destination: string): boolean {
    return (
      destination === 'local' ||
      destination === 'local_note' ||
      destination === 'local_draft' ||
      destination === 'scratchpad' ||
      destination.startsWith('local_') ||
      destination.startsWith('file://')
    );
  }

  private checkDeterministicPatterns(payload: string): SupabaseEgressRiskType | null {
    // 1. Destructive DDL / DML
    if (
      /\b(?:DROP\s+TABLE|DROP\s+DATABASE|DROP\s+SCHEMA|TRUNCATE\s+(?:TABLE\s+)?|ALTER\s+TABLE\s+[\w.]+\s+DROP)\b/iu.test(
        payload
      )
    ) {
      return 'destructive_script';
    }

    // 2. Destructive mass deletes without bounds
    if (/\bDELETE\s+FROM\s+[\w.]+\s*(?:;|$|\s*WHERE\s+(?:1\s*=\s*1|TRUE))\b/iu.test(payload)) {
      return 'destructive_script';
    }

    // 3. SQL Injection patterns
    if (
      /(?:'\s*OR\s*['"]?1['"]?\s*=\s*['"]?1|UNION\s+(?:ALL\s+)?SELECT|;\s*DROP\s|--\s*[\r\n]|\/\*!)/iu.test(payload)
    ) {
      return 'sql_injection';
    }

    // 4. RLS Bypass attempts
    if (
      /(?:role\s*=\s*['"]service_role['"]|apikey\s*=\s*['"]eyJ.*service_role|bypassrls|auth\.uid\(\)\s*is\s*null)/iu.test(
        payload
      )
    ) {
      return 'rls_bypass';
    }

    return null;
  }

  private hash(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }
}
