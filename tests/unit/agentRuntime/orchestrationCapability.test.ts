import { describe, expect, it } from 'vitest';

import {
  ORCHESTRATION_CAPABILITY_PROMPT,
  parseOrchestrationProposal,
  shouldOfferOrchestration,
} from '@/process/agentRuntime/orchestrationCapability';

describe('orchestration capability', () => {
  it('does not spend orchestration context on simple requests', () => {
    expect(shouldOfferOrchestration('Hello, explain this function.')).toBe(false);
  });

  it('exposes the capability for an explicit short Team or Company request', () => {
    expect(shouldOfferOrchestration('hãy test team và company')).toBe(true);
    expect(shouldOfferOrchestration('kiểm tra công ty')).toBe(true);
  });

  it('exposes the host proposal protocol for an explicit short subagent request', () => {
    expect(shouldOfferOrchestration('hãy tạo các subagent để đọc repo này phần MCP')).toBe(true);
    expect(shouldOfferOrchestration('spawn two agents to inspect the repository')).toBe(true);
  });

  it('tells the model to use the host proposal protocol instead of searching for spawn tools', () => {
    expect(ORCHESTRATION_CAPABILITY_PROMPT).toContain('HOST PROTOCOL');
    expect(ORCHESTRATION_CAPABILITY_PROMPT).toContain('team_spawn');
    expect(ORCHESTRATION_CAPABILITY_PROMPT).toContain('tools_search');
    expect(ORCHESTRATION_CAPABILITY_PROMPT).toContain('<tomny_orchestration_proposal>');
  });

  it('keeps same-tool query fan-out in the leader instead of duplicating subagents', () => {
    expect(ORCHESTRATION_CAPABILITY_PROMPT).toContain('same primary tool or evidence source');
    expect(ORCHESTRATION_CAPABILITY_PROMPT).toContain('two ide_research calls');
    expect(ORCHESTRATION_CAPABILITY_PROMPT).toContain('issue the tool calls concurrently');
    expect(ORCHESTRATION_CAPABILITY_PROMPT).toContain('does not bypass the efficiency gate');
  });

  it('allows subagents when independent work also uses materially different actions', () => {
    expect(ORCHESTRATION_CAPABILITY_PROMPT).toContain('primary actions or tool families must also differ materially');
    expect(ORCHESTRATION_CAPABILITY_PROMPT).toContain('repository investigation + runtime Quick Test');
    expect(ORCHESTRATION_CAPABILITY_PROMPT).toContain('implementation + independent testing/review');
  });

  it('offers orchestration for work with independent disciplines', () => {
    expect(
      shouldOfferOrchestration(
        'Build the frontend and backend, design the database, then run QA and security testing for the full application.'
      )
    ).toBe(true);
    expect(
      shouldOfferOrchestration(
        'Hãy xây dựng toàn bộ giao diện và backend, thiết kế cơ sở dữ liệu, sau đó kiểm thử QA và bảo mật.'
      )
    ).toBe(true);
  });

  it('accepts a bounded dependency graph', () => {
    const proposal = parseOrchestrationProposal(
      '<tomny_orchestration_proposal>{"kind":"team","name":"Delivery","reason":"Independent implementation and QA","parallelism":2,"estimatedTokens":3000,"roles":[{"id":"dev","name":"Developer","responsibility":"Implement","dependsOn":[]},{"id":"qa","name":"QA","responsibility":"Test","dependsOn":["dev"]}]}</tomny_orchestration_proposal>'
    );

    expect(proposal).toEqual(expect.objectContaining({ kind: 'team', parallelism: 2, estimatedTokens: 3000 }));
  });

  it('rejects dependencies outside the approved role graph', () => {
    expect(
      parseOrchestrationProposal(
        '<tomny_orchestration_proposal>{"kind":"team","name":"Bad","reason":"Bad graph","parallelism":2,"roles":[{"id":"dev","name":"Developer","responsibility":"Implement","dependsOn":[]},{"id":"qa","name":"QA","responsibility":"Test","dependsOn":["unknown"]}]}</tomny_orchestration_proposal>'
      )
    ).toBeUndefined();
  });

  it('rejects dependency cycles that would leave the agent mesh waiting forever', () => {
    expect(
      parseOrchestrationProposal(
        '<tomny_orchestration_proposal>{"kind":"team","name":"Cycle","reason":"Invalid cyclic graph","parallelism":2,"roles":[{"id":"dev","name":"Developer","responsibility":"Implement","dependsOn":["qa"]},{"id":"qa","name":"QA","responsibility":"Test","dependsOn":["dev"]}]}</tomny_orchestration_proposal>'
      )
    ).toBeUndefined();
  });
});
