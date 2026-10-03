/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChatStageInput, ChatStageOutput, IChatStage } from '../types';

export type Context7StageConfig = Readonly<{
  maxTokens?: number;
  autoUpdate?: boolean;
}>;

/**
 * Example Store Package Stage: Context7 Documentation Retriever.
 * Demonstrates a third-party package downloaded from the TomniHubOS Store.
 */
export class MockContext7Stage implements IChatStage {
  public readonly id = 'com.context7.docs-retriever';
  public readonly displayName = 'Context7 Docs';
  public readonly description = 'Tự động trích xuất tài liệu SDK/API mới nhất cho Coding Agent';
  public readonly phase = 'retrieve' as const;
  public readonly icon = 'FileCode';
  public readonly defaultEnabled = false; // user adds this from palette
  public readonly defaultTimeoutMs = 2_000;

  public async execute(input: ChatStageInput): Promise<ChatStageOutput> {
    const startTime = Date.now();
    const query = input.query.toLowerCase();

    // Check if query is asking about a library/SDK
    let retrievedDoc: string | undefined;
    if (query.includes('python')) {
      retrievedDoc = '[Context7: Python 3.12 Standard Library Reference - AsyncIO & Typing]';
    } else if (query.includes('react') || query.includes('hook')) {
      retrievedDoc = '[Context7: React 19 Compiler & Server Actions API Reference]';
    } else if (query.includes('laya')) {
      retrievedDoc = '[Context7: Laya Decision Engine SDK v1.0 - Single Forward Pass Non-Autoregressive API]';
    } else {
      retrievedDoc = `[Context7: Generic SDK Knowledge Grounding for "${input.query.slice(0, 30)}..."]`;
    }

    const updatedContext = input.context ? `${input.context}\n\n${retrievedDoc}` : retrievedDoc;

    return {
      decision: 'continue',
      context: updatedContext,
      grounding: {
        context7: {
          retrieved: true,
          docsCount: 1,
          snippet: retrievedDoc,
        },
      },
      evidence: {
        latencyMs: Date.now() - startTime,
        docLength: retrievedDoc.length,
      },
    };
  }
}
