import { describe, expect, it } from 'vitest';
import type { CompanyStructure, RoleNode } from '@process/company/companyOrchestrator';
import { listGroups, parseMentions, resolveAudience } from '@/renderer/pages/guid/HubHome/company/companyGroups';
import { buildGroupPrompt } from '@/renderer/pages/guid/HubHome/company/group/groupPrompts';

const node = (id: string, name: string, role: RoleNode['role'], children: RoleNode[] = []): RoleNode => ({
  id,
  name,
  role,
  children,
});

const alice = node('w1', 'Alice', 'worker');
const bob = node('w2', 'Bob', 'worker');
const frontend = node('d1', 'Frontend Lead', 'division-head', [node('w3', 'Carol', 'worker')]);
const root = node('p', 'Ada', 'president', [alice, bob, frontend]);
const structure: CompanyStructure = { companyId: 'acme', root };

describe('company groups', () => {
  it('makes a group for every role that has direct reports, root first', () => {
    const groups = listGroups(structure);
    expect(groups.map((group) => group.id)).toEqual(['p', 'd1']);
    expect(groups[0].members.map((member) => member.id)).toEqual(['w1', 'w2', 'd1']);
  });

  it('resolves @name tags with or without spaces and ignores unknown tags', () => {
    const all = [alice, bob, frontend];
    expect(parseMentions('hi @Alice and @frontendlead please', all).map((r) => r.id)).toEqual(['w1', 'd1']);
    expect(parseMentions('hi @Frontend Lead check', all).map((r) => r.id)).toEqual(['d1']);
    expect(parseMentions('mail me at x@nobody', all)).toEqual([]);
  });

  it('puts tagged outsiders in as guests and never duplicates members', () => {
    const [rootGroup, divisionGroup] = listGroups(structure);
    expect(resolveAudience(rootGroup, structure, '@Alice @Carol').guests.map((r) => r.id)).toEqual(['w3']);
    const audience = resolveAudience(divisionGroup, structure, '@Alice help');
    expect(audience.primary.map((r) => r.id)).toEqual(['d1', 'w3']);
    expect(audience.guests.map((r) => r.id)).toEqual(['w1']);
  });

  it('tells a guest it is temporary and carries the transcript', () => {
    const [group] = listGroups(structure);
    const prompt = buildGroupPrompt({
      companyName: 'acme',
      group,
      role: alice,
      guest: true,
      unseen: [{ id: '1', from: 'user', name: 'User', text: 'hello team', at: 0 }],
    });
    expect(prompt).toContain('temporarily');
    expect(prompt).toContain('User: hello team');
    expect(prompt).toContain('Ada (leader)');
  });
});
