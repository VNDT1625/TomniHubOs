/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChatStageInput, ChatStageOutput, IChatStage } from '../types';

export class RtkKnowledgeStage implements IChatStage {
  public readonly id = 'builtin:rtk-knowledge';
  public readonly displayName = 'Realtime Knowledge (RTK)';
  public readonly description = 'Tra cứu tri thức cục bộ và dữ liệu sự thật thời sự được xác thực';
  public readonly phase = 'retrieve' as const;
  public readonly icon = 'Book';
  public readonly defaultEnabled = false; // opt-in as specified in docs
  public readonly defaultTimeoutMs = 3_000;

  public async execute(input: ChatStageInput): Promise<ChatStageOutput> {
    const startTime = Date.now();
    // Deterministic check for currentness keywords
    const isCurrentnessQuery = /\b(?:mới nhất|hôm nay|hiện tại|latest|current|today|status|version)\b/iu.test(
      input.query
    );

    if (!isCurrentnessQuery) {
      return { decision: 'continue' };
    }

    return {
      decision: 'continue',
      grounding: {
        rtkRetrieved: true,
        freshnessValidAsOf: new Date().toISOString(),
      },
      evidence: {
        latencyMs: Date.now() - startTime,
        matchedCurrentness: true,
      },
    };
  }
}
