/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LayaAnswerChoice, LayaPredictor } from '../../security/layaSemanticEgressModel';
import type { ChatStageInput, ChatStageOutput, IChatStage } from '../types';

export const UNIVERSAL_TOOL_FALLBACK_DIRECTIVE =
  'Nếu bạn nhận thấy cần công cụ hoặc schema để code / thao tác hệ thống mà chưa được nạp, hãy gọi action request_tools(domain).';

export class ToolRouterStage implements IChatStage {
  public readonly id = 'builtin:tool-router';
  public readonly displayName = 'Pre-flight Tool Router & Speculative Loader';
  public readonly description =
    'Nạp suy đoán schema công cụ có cơ chế tự phục hồi hai chiều (Universal Fallback Directive)';
  public readonly phase = 'pre_model' as const;
  public readonly icon = 'Wrench';
  public readonly defaultEnabled = true;
  public readonly defaultTimeoutMs = 1_000;

  public constructor(private readonly predictor?: LayaPredictor) {}

  public async execute(input: ChatStageInput): Promise<ChatStageOutput> {
    const startTime = Date.now();
    const query = input.query.toLowerCase().trim();
    const selectedTools: string[] = [];
    let method = 'pattern_fallback';
    let isSelfHealed = false;

    // 0. Check if Agent emitted a self-healing fallback signal: request_tools(...)
    const fallbackMatch = /(?:request_tools|cần_công_cụ)\s*(?:\(([\w-]+)\))?/iu.exec(query);
    if (fallbackMatch) {
      const requestedDomain = fallbackMatch[1]?.toLowerCase() ?? 'all';
      if (requestedDomain === 'browser') {
        selectedTools.push('browser_action');
      } else if (requestedDomain === 'code') {
        selectedTools.push('code_executor', 'file_search');
      } else {
        selectedTools.push('code_executor', 'file_search', 'browser_action');
      }
      isSelfHealed = true;
      method = 'agent_self_healing_fallback';
    }

    // 1. Pure greetings -> 0 tools (0 token waste)
    const isPureGreeting =
      /^(?:hello(?:\s+there)?|hi(?:\s+there)?|xin chào(?:\s+bạn)?|chào(?:\s+bạn)?|alo|hey|good\s+(?:morning|evening|afternoon))[!.,\s]*$/iu.test(
        query
      );

    if (!isSelfHealed && !isPureGreeting) {
      if (this.predictor) {
        try {
          const prediction = await this.predictor(
            { query: input.query },
            {
              toolDomain: {
                type: 'choice',
                instructions: 'Classify which tool domain is required for this query:',
                criteria: {
                  browser: 'Web search, browsing web pages, URLs, checking online status, reading internet content',
                  code: 'Writing code, fixing bugs, programming, terminal commands, git operations, file search',
                  general: 'General conversational query, explanation, chat, translation, prose writing',
                },
              },
            },
            input.signal
          );

          const choice = (prediction.answers['toolDomain'] as LayaAnswerChoice | undefined)?.choice;
          if (choice === 'browser') {
            selectedTools.push('browser_action');
            method = 'laya_neural';
          } else if (choice === 'code') {
            selectedTools.push('code_executor', 'file_search');
            method = 'laya_neural';
          }
        } catch (err) {
          console.warn('[ToolRouterStage] Laya predictor failed, falling back to regex:', err);
        }
      }

      // Pattern fallback / supplement
      if (selectedTools.length === 0) {
        if (/(?:code|viết code|debug|python|typescript|javascript|git|function|lập trình)/iu.test(query)) {
          selectedTools.push('code_executor', 'file_search');
        }
        if (/(?:browser|trang web|url|web|tìm kiếm|google|lướt web|mở trang)/iu.test(query)) {
          if (!selectedTools.includes('browser_action')) {
            selectedTools.push('browser_action');
          }
        }
      }
    }

    return {
      decision: 'continue',
      grounding: {
        toolRouter: {
          selectedTools,
          requiresBrowser: selectedTools.includes('browser_action'),
          mcpServers: selectedTools.includes('browser_action') ? ['browser-control'] : [],
          universalDirective: UNIVERSAL_TOOL_FALLBACK_DIRECTIVE,
          fallbackAction: 'request_tools',
          selfHealed: isSelfHealed,
        },
      },
      evidence: {
        latencyMs: Date.now() - startTime,
        routedTools: selectedTools,
        isPureGreeting,
        selfHealed: isSelfHealed,
        method,
      },
    };
  }
}
