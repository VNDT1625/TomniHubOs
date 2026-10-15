import { describe, expect, it } from 'vitest';
import type { CompanyStructure, RoleNode } from '@process/company/companyOrchestrator';
import {
  planAssignments,
  toAssignment,
  type AgentPool,
  type CompanySetup,
} from '@/renderer/pages/guid/HubHome/company/create/companySetup';

const pool: AgentPool = {
  clis: [{ id: 'claude', name: 'Claude Code', available: true, teamCapable: true }],
  assistants: [{ id: 'a1', name: 'Writer', model: 'm-writer', presetAgentType: 'claude' }],
  engineIds: [],
  models: [],
  mcpServers: [],
  skills: [],
  modes: [],
};

const node = (id: string, role: RoleNode['role'], children: RoleNode[] = []): RoleNode => ({
  id,
  name: id,
  role,
  children,
});
const structure: CompanyStructure = {
  companyId: 'c',
  root: node('p', 'president', [node('w1', 'worker'), node('w2', 'worker'), node('w3', 'worker')]),
};
const base: CompanySetup = {
  mode: 'manual',
  companyId: 'c',
  purpose: '',
  presidentName: '',
  hire: [],
  skills: [],
  mcpServerIds: [],
  rules: [],
  strengths: '',
  divisions: [],
  directWorkers: 3,
};

describe('company setup planning', () => {
  it('resolves executors and falls back to the assistant model', () => {
    expect(toAssignment('assistant:a1', pool)?.model).toBe('m-writer');
    expect(toAssignment('cli:claude', pool, 'x')?.model).toBe('x');
    expect(toAssignment('cli:missing', pool)).toBeNull();
  });

  it('gives the Boss the chosen executor and draws employees from the hire pool in turn', () => {
    const plan = planAssignments(
      structure,
      { ...base, boss: { executor: 'cli:claude' }, hire: ['assistant:a1', 'cli:claude'] },
      pool
    );
    expect(plan.get('p')?.refId).toBe('claude');
    expect([plan.get('w1')?.refId, plan.get('w2')?.refId, plan.get('w3')?.refId]).toEqual(['a1', 'claude', 'a1']);
  });

  it('grants company-wide permissions to every role, using a CLI when a role has no executor', () => {
    const plan = planAssignments(structure, { ...base, sessionMode: 'yolo', skills: ['docx'] }, pool);
    expect(plan.size).toBe(4);
    expect(plan.get('w2')?.capabilities).toEqual({ sessionMode: 'yolo', skills: ['docx'] });
  });

  it('changes nothing when the form asks for nothing', () => {
    expect(planAssignments(structure, base, pool).size).toBe(0);
  });
});
