/**
 * @license
 * Copyright 2026 TomniHubOS
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

import { ToolSchemaStage, type ToolSchemaSelection } from '@process/services/chatPipeline/stages/toolSchemaStage';
import { capabilitiesFromCues, UnderstandStage } from '@process/services/chatPipeline/stages/understandStage';
import type { ChatStageInput } from '@process/services/chatPipeline/types';

const input = (query: string, grounding: Record<string, unknown> = {}): ChatStageInput =>
  ({ schemaVersion: 1, runId: 'r', stageId: 's', query, context: '', grounding }) as unknown as ChatStageInput;

/** The numbers the inspector showed for "hello bạn thấy repo này thế nào?" */
const SEEN_IN_THE_APP = {
  intent: { choice: 'code', confidence: 0.24 },
  needsFreshDocs: { noul: 0.28 },
  needsProjectTools: { noul: 0.34 },
  needsBrowserTools: { noul: 0.78 },
  needsOfficeTools: { noul: 0.24 },
  needsAgentTools: { noul: 0.73 },
  needsTestTools: { noul: 0.42 },
};

const modelSaying = (answers: Record<string, unknown>) => vi.fn(async () => ({ answers })) as never;

const selectionFrom = async (query: string, answers: Record<string, unknown>): Promise<ToolSchemaSelection> => {
  const output = await new ToolSchemaStage(modelSaying(answers)).execute(input(query));
  return (output.grounding as { toolSchema: ToolSchemaSelection }).toolSchema;
};

describe('capabilitiesFromCues', () => {
  it('reads what the wording points at', () => {
    expect(capabilitiesFromCues('bạn thấy repo này thế nào?')).toEqual(['surface.ide']);
    expect(capabilitiesFromCues('mở trang web https://example.com')).toEqual(['surface.browser']);
    expect(capabilitiesFromCues('sửa file report.docx')).toEqual(['surface.office']);
    expect(capabilitiesFromCues('chạy unit test cho module này')).toEqual(['core.testing']);
    expect(capabilitiesFromCues('tạo team agents để làm song song')).toContain('core.agent-orchestrator');
  });

  it('points at nothing for a greeting or small talk', () => {
    expect(capabilitiesFromCues('xin chào')).toEqual([]);
    expect(capabilitiesFromCues('cảm ơn bạn')).toEqual([]);
  });
});

describe('tool groups when the model scores are unreliable (the numbers seen in the app)', () => {
  it('loads what the sentence points at and ignores groups the model merely leaned toward', async () => {
    const selection = await selectionFrom('hello bạn thấy repo này thế nào?', SEEN_IN_THE_APP);

    expect(selection.capabilityIds).toContain('surface.ide');
    expect(selection.capabilityIds).not.toContain('surface.browser');
    expect(selection.capabilityIds).not.toContain('core.agent-orchestrator');
    // The raw scores stay visible for the inspector.
    expect(selection.scores['surface.browser']).toBe(0.78);
  });

  it('still obeys a model that is nearly certain about a group the wording does not name', async () => {
    const selection = await selectionFrom('lên kế hoạch cho cả nhóm làm việc', {
      ...SEEN_IN_THE_APP,
      needsAgentTools: { noul: 0.95 },
    });
    expect(selection.capabilityIds).toContain('core.agent-orchestrator');
  });

  it('loads nothing for a plain greeting even when the model leans toward some groups', async () => {
    const selection = await selectionFrom('xin chào', SEEN_IN_THE_APP);
    expect(selection.capabilityIds).toEqual([]);
  });
});

describe('the understand stage and a model that is only guessing', () => {
  const understand = async (query: string, intent: { choice: string; confidence: number }) => {
    const output = await new UnderstandStage(modelSaying({ intent, needsFreshDocs: { noul: 0.1 } })).execute(
      input(query)
    );
    return (output.grounding as { intent: { kind: string; method: string } }).intent;
  };

  it('prefers clear wording over a near-guess', async () => {
    expect(await understand('bạn thấy repo này thế nào?', { choice: 'web', confidence: 0.2 })).toMatchObject({
      kind: 'code',
      method: 'pattern_fallback',
    });
  });

  it('trusts a model that is confident', async () => {
    expect(await understand('bạn thấy repo này thế nào?', { choice: 'web', confidence: 0.8 })).toMatchObject({
      kind: 'web',
      method: 'laya_neural',
    });
  });

  it('keeps a guess when the wording says nothing either way', async () => {
    expect(await understand('giúp mình với', { choice: 'code', confidence: 0.2 })).toMatchObject({
      kind: 'code',
      method: 'laya_neural',
    });
  });
});
