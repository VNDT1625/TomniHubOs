import { describe, expect, it } from 'vitest';

import {
  createDeepResearchPlan,
  evaluateSectionEvidence,
  type DeepResearchRequest,
  type EvidenceArchiveSnapshot,
  type EvidenceClaim,
  type ResearchSectionSpec,
  type SourceSnapshot,
} from '@process/agentRuntime/agentMesh/research';

const section = (id: string, overrides: Partial<ResearchSectionSpec> = {}): ResearchSectionSpec => ({
  id,
  title: `Section ${id}`,
  question: `What evidence supports ${id}?`,
  ...overrides,
});

const request = (overrides: Partial<DeepResearchRequest> = {}): DeepResearchRequest => ({
  topic: 'Evidence-led security architecture',
  sections: [section('architecture'), section('operations')],
  outputs: ['report', 'presentation'],
  ...overrides,
});

const source = (id: string, primary = false): SourceSnapshot => ({
  id,
  title: `Source ${id}`,
  kind: 'web',
  accessMethod: 'http',
  retrievedAt: '2026-07-18T00:00:00.000Z',
  contentHash: `${id}-hash`,
  rawArtifactPath: `sources/${id}.txt`,
  primary,
});

const claim = (overrides: Partial<EvidenceClaim> = {}): EvidenceClaim => ({
  id: 'claim-1',
  sectionId: 'architecture',
  text: 'The architecture has independently corroborated controls.',
  importance: 'important',
  references: [
    { sourceId: 'source-a', chunkId: 'chunk-a', locator: 'p. 1', relation: 'supports' },
    { sourceId: 'source-b', chunkId: 'chunk-b', locator: 'p. 2', relation: 'supports' },
  ],
  verification: { status: 'supported', checkedAt: '2026-07-18T00:00:00.000Z' },
  ...overrides,
});

const archive = (overrides: Partial<EvidenceArchiveSnapshot> = {}): EvidenceArchiveSnapshot => ({
  schema: 'tomny.evidence-archive.v1',
  sources: [source('source-a', true), source('source-b')],
  chunks: [
    { id: 'chunk-a', sourceId: 'source-a', locator: 'p. 1', contentHash: 'chunk-a-hash', excerpt: 'A' },
    { id: 'chunk-b', sourceId: 'source-b', locator: 'p. 2', contentHash: 'chunk-b-hash', excerpt: 'B' },
  ],
  claims: [claim()],
  summaries: [],
  reconciliations: [],
  ...overrides,
});

describe('createDeepResearchPlan', () => {
  it('assigns one researcher and one verifier to every section', () => {
    const plan = createDeepResearchPlan(request());

    expect(plan.jobs.filter((job) => job.agentId.startsWith('researcher-')).map((job) => job.jobId)).toEqual([
      'research-architecture',
      'research-operations',
    ]);
    expect(plan.jobs.filter((job) => job.agentId.startsWith('verifier-')).map((job) => job.jobId)).toEqual([
      'verify-architecture',
      'verify-operations',
    ]);
  });

  it('orders verification, synthesis, authoring and final review through explicit dependencies', () => {
    const plan = createDeepResearchPlan(request());
    const byId = new Map(plan.jobs.map((job) => [job.jobId, job]));

    expect(byId.get('verify-architecture')?.dependsOn).toEqual(['research-architecture']);
    expect(byId.get('evidence-group-1')?.dependsOn).toEqual(['verify-architecture', 'verify-operations']);
    expect(byId.get('cross-section-reconciliation')?.dependsOn).toEqual(['evidence-group-1']);
    expect(byId.get('evidence-synthesis')?.dependsOn).toEqual(['evidence-group-1', 'cross-section-reconciliation']);
    expect(byId.get('author-report')?.dependsOn).toEqual(['evidence-synthesis']);
    expect(byId.get('author-presentation')?.dependsOn).toEqual(['evidence-synthesis']);
    expect(byId.get('deliverable-review')?.dependsOn).toEqual(['author-report', 'author-presentation']);
  });

  it('builds repository context once and makes section researchers reuse it', () => {
    const plan = createDeepResearchPlan(request({ workspace: 'C:/workspace/project' }));
    const researchers = plan.jobs.filter((job) => job.agentId.startsWith('researcher-'));

    expect(plan.jobs.filter((job) => job.jobId === 'repo-context')).toHaveLength(1);
    expect(researchers.every((job) => job.dependsOn?.includes('repo-context'))).toBe(true);
    expect(researchers.every((job) => job.continuation?.some((line) => /do not repeat/i.test(line)))).toBe(true);
  });

  it('keeps long-report fan-in bounded through hierarchical reconciliation groups', () => {
    const sections = Array.from({ length: 20 }, (_, index) => section(`section-${index + 1}`));
    const plan = createDeepResearchPlan(request({ sections, outputs: ['report'] }));
    const byId = new Map(plan.jobs.map((job) => [job.jobId, job]));
    const groups = plan.jobs.filter((job) => job.jobId?.startsWith('evidence-group-'));

    expect(groups.map((job) => job.dependsOn?.length)).toEqual([8, 8, 4]);
    expect(byId.get('cross-section-reconciliation')?.dependsOn).toEqual([
      'evidence-group-1',
      'evidence-group-2',
      'evidence-group-3',
    ]);
    expect(plan.jobs.every((job) => (job.dependsOn?.length ?? 0) <= 16)).toBe(true);
  });

  it('allows only an authorized browser fallback and explicitly forbids bypassing access controls', () => {
    const plan = createDeepResearchPlan(request({ sections: [section('sources')] }));
    const researcher = plan.jobs.find((job) => job.jobId === 'research-sources');

    expect(researcher).toMatchObject({ surface: 'browser', permissionMode: 'full-access' });
    expect(researcher?.objective).toMatch(/authorized signed-in browser session/i);
    expect(researcher?.objective).toMatch(
      /never bypass paywalls, CAPTCHA, authentication, robots policy, or access controls/i
    );
  });

  it('keeps browser tooling out of the plan when interactive fallback is disabled', () => {
    const plan = createDeepResearchPlan(
      request({ allowAuthorizedBrowser: false, sections: [section('sources')], outputs: ['report'] })
    );
    const researcher = plan.jobs.find((job) => job.jobId === 'research-sources');

    expect(researcher).toMatchObject({ surface: 'chat', permissionMode: 'read-only' });
    expect(researcher?.objective).toMatch(/do not use an interactive browser fallback/i);
  });

  it.each([
    ['an empty topic', { topic: '   ' }, /topic cannot be empty/i],
    ['no sections', { sections: [] }, /at least one section/i],
    ['duplicate section ids', { sections: [section('same'), section('same')] }, /ids must be unique/i],
    ['no deliverable outputs', { outputs: [] }, /output is required/i],
  ] satisfies Array<[string, Partial<DeepResearchRequest>, RegExp]>)('rejects %s', (_name, overrides, error) => {
    expect(() => createDeepResearchPlan(request(overrides))).toThrow(error);
  });
});

describe('evaluateSectionEvidence', () => {
  it('passes evidence with resolvable chunks, enough sources and independent support', () => {
    const report = evaluateSectionEvidence(
      archive(),
      section('architecture', {
        minimumSources: 2,
        minimumPrimarySourceRatio: 0.5,
        requireIndependentVerification: true,
      })
    );

    expect(report).toMatchObject({ passed: true, sourceCount: 2, primarySourceRatio: 0.5, verifiedClaimRatio: 1 });
    expect(report.issues).toEqual([]);
  });

  it('reports claims without citations', () => {
    const report = evaluateSectionEvidence(archive({ claims: [claim({ references: [] })] }), section('architecture'));

    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'missing-citation', claimId: 'claim-1' }));
  });

  it('reports missing sources and source/chunk backlink mismatches', () => {
    const brokenClaim = claim({
      references: [
        { sourceId: 'missing-source', chunkId: 'chunk-a', locator: 'p. 1', relation: 'supports' },
        { sourceId: 'source-a', chunkId: 'missing-chunk', locator: 'p. 9', relation: 'supports' },
      ],
    });
    const report = evaluateSectionEvidence(
      archive({ claims: [brokenClaim] }),
      section('architecture', { minimumSources: 0, minimumPrimarySourceRatio: 0 })
    );

    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'missing-source', claimId: 'claim-1' }));
    expect(report.issues.filter((issue) => issue.code === 'missing-chunk')).toHaveLength(2);
  });

  it('requires independent supporting sources instead of duplicate citations to one source', () => {
    const repeatedSourceClaim = claim({
      references: [
        { sourceId: 'source-a', chunkId: 'chunk-a', locator: 'p. 1', relation: 'supports' },
        { sourceId: 'source-a', chunkId: 'chunk-a', locator: 'p. 1', relation: 'supports' },
      ],
    });
    const report = evaluateSectionEvidence(
      archive({ claims: [repeatedSourceClaim] }),
      section('architecture', {
        minimumSources: 1,
        minimumPrimarySourceRatio: 0,
        requireIndependentVerification: true,
      })
    );

    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'insufficient-independent-support', claimId: 'claim-1' })
    );
  });

  it('fails the quality gate on unresolved critical cross-section contradictions', () => {
    const criticalClaim = claim({ importance: 'critical' });
    const report = evaluateSectionEvidence(
      archive({
        claims: [criticalClaim],
        reconciliations: [
          {
            id: 'conflict-1',
            sectionIds: ['architecture', 'operations'],
            claimIds: ['claim-1'],
            sourceIds: ['source-a', 'source-b'],
            relation: 'contradiction',
            cause: 'method',
            resolution: 'unresolved',
            rationale: 'The sources use incompatible measurement methods.',
            verifiedByAgentId: 'consistency-editor',
            checkedAt: '2026-07-18T00:00:00.000Z',
          },
        ],
      }),
      section('architecture', {
        minimumSources: 2,
        minimumPrimarySourceRatio: 0,
        requireIndependentVerification: true,
      })
    );

    expect(report.passed).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'unresolved-critical-contradiction', sectionId: 'architecture' })
    );
  });

  it('does not treat context or contradiction citations as independent support', () => {
    const weakClaim = claim({
      references: [
        { sourceId: 'source-a', chunkId: 'chunk-a', locator: 'p. 1', relation: 'supports' },
        { sourceId: 'source-b', chunkId: 'chunk-b', locator: 'p. 2', relation: 'context' },
      ],
    });
    const report = evaluateSectionEvidence(
      archive({ claims: [weakClaim] }),
      section('architecture', {
        minimumSources: 2,
        minimumPrimarySourceRatio: 0,
        requireIndependentVerification: true,
      })
    );

    expect(report.issues).toContainEqual(
      expect.objectContaining({ code: 'insufficient-independent-support', claimId: 'claim-1' })
    );
  });
});
