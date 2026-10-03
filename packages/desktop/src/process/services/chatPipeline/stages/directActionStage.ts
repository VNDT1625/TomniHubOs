/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LayaAnswerChoice, LayaPredictor } from '../../security/layaSemanticEgressModel';
import type { ChatStageInput, ChatStageOutput, IChatStage } from '../types';

export type DirectActionType = 'open_url' | 'open_github' | 'open_file' | 'repotopackage' | 'none';

export type DirectActionPayload = Readonly<{
  actionType: 'open_url' | 'open_file' | 'repotopackage';
  target: string;
  provider: 'system_browser' | 'system_ide';
  metadata?: Record<string, unknown>;
}>;

export class DirectActionStage implements IChatStage {
  public readonly id = 'builtin:direct-action';
  public readonly displayName = 'Zero-LLM Direct Action';
  public readonly description =
    'Nhận diện các hành động trực tiếp (mở link GitHub, URL web, mở file) và thực thi ngay không gọi LLM';
  public readonly phase = 'pre_model' as const;
  public readonly icon = 'Compass';
  public readonly defaultEnabled = true;
  public readonly defaultTimeoutMs = 1_000;

  public constructor(private readonly predictor?: LayaPredictor) {}

  public async execute(input: ChatStageInput): Promise<ChatStageOutput> {
    const startTime = Date.now();
    const query = input.query.trim();

    let detectedAction: DirectActionPayload | null = null;
    let method = 'pattern_fallback';

    // 1. Neural classification via Laya if available
    if (this.predictor) {
      try {
        const prediction = await this.predictor(
          { query },
          {
            directAction: {
              type: 'choice',
              instructions: 'Classify if the query is an immediate one-step direct action:',
              criteria: {
                open_github: 'Explicitly requests opening or viewing a GitHub link or repository',
                open_url: 'Requests opening, visiting, or browsing an external website or URL',
                open_file: 'Requests opening, viewing, or editing a specific local file path',
                none: 'General conversational query, coding question, explanation, or multi-step task',
              },
            },
          },
          input.signal
        );

        const choice = (prediction.answers['directAction'] as LayaAnswerChoice | undefined)?.choice as
          | DirectActionType
          | undefined;

        if (choice && choice !== 'none') {
          const extracted = this.extractTarget(query, choice);
          if (extracted) {
            detectedAction = extracted;
            method = 'laya_neural';
          }
        }
      } catch (err) {
        console.warn('[DirectActionStage] Laya predictor failed, falling back to regex:', err);
      }
    }

    // 2. Pattern-based fallback or supplement
    if (!detectedAction) {
      detectedAction = this.extractTargetPattern(query);
    }

    if (detectedAction) {
      return {
        decision: 'direct_action',
        grounding: {
          directAction: detectedAction,
        },
        evidence: {
          latencyMs: Date.now() - startTime,
          directAction: detectedAction,
          method,
        },
      };
    }

    return {
      decision: 'continue',
      evidence: {
        latencyMs: Date.now() - startTime,
        directAction: null,
        method,
      },
    };
  }

  private extractTarget(query: string, choice: DirectActionType): DirectActionPayload | null {
    if (choice === 'open_github' || choice === 'open_url') {
      const urlMatch = /(https?:\/\/[^\s]+|github\.com\/[^\s]+)/i.exec(query);
      if (urlMatch) {
        let url = urlMatch[1]!;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = `https://${url}`;
        }
        return {
          actionType: 'open_url',
          target: url,
          provider: 'system_browser',
          metadata: { isGitHub: choice === 'open_github' || url.includes('github.com') },
        };
      }
    } else if (choice === 'open_file') {
      const fileMatch = /(?:mở|đọc|open|view)\s+(?:file|tệp|tập tin)?\s*([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+)/i.exec(
        query
      );
      if (fileMatch) {
        return {
          actionType: 'open_file',
          target: fileMatch[1]!,
          provider: 'system_ide',
        };
      }
    }
    return null;
  }

  private extractTargetPattern(query: string): DirectActionPayload | null {
    const repoToPackageMatch = /^\/repotopackage(?:\s+([\s\S]+))?$/i.exec(query);
    if (repoToPackageMatch) {
      const rawTarget = repoToPackageMatch[1]?.trim() || '.';
      return {
        actionType: 'repotopackage',
        target: rawTarget,
        provider: 'system_ide',
        metadata: {
          isRepoToPackage: true,
          steps: [
            '1. Fetch and scan repository structure',
            '2. Classify package archetype and capabilities',
            '3. Run Laya static and security guardrail verification',
            '4. Generate Ed25519 signed .tomny package bundle',
          ],
        },
      };
    }

    // 1. Direct GitHub URL or "mở link github abc/xyz"
    const ghMatch = /(https?:\/\/github\.com\/[\w.-]+\/[\w.-]+[^\s]*|github\.com\/[\w.-]+\/[\w.-]+[^\s]*)/i.exec(query);
    if (ghMatch) {
      let target = ghMatch[1]!;
      if (!target.startsWith('http://') && !target.startsWith('https://')) {
        target = `https://${target}`;
      }
      return {
        actionType: 'open_url',
        target,
        provider: 'system_browser',
        metadata: { isGitHub: true },
      };
    }

    // 2. Generic URL
    const urlMatch =
      /(https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_+.~#?&//=]*)/i.exec(
        query
      );
    if (urlMatch) {
      return {
        actionType: 'open_url',
        target: urlMatch[1]!,
        provider: 'system_browser',
      };
    }

    // 3. Local file
    const fileMatch = /^(?:mở|đọc|open|view)\s+(?:file|tệp|tập tin)?\s*([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+)$/i.exec(
      query
    );
    if (fileMatch) {
      return {
        actionType: 'open_file',
        target: fileMatch[1]!,
        provider: 'system_ide',
      };
    }

    return null;
  }
}
