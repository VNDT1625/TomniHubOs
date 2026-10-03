import { describe, expect, it } from 'vitest';
import { createPostgresStoreRepository } from '../src/repositories.js';

const repositoryWithRows = (rows: readonly { rowCount: number; rows: readonly Record<string, unknown>[] }[]) => {
  let index = 0;
  const client = { query: async () => rows[index++] ?? { rowCount: 0, rows: [] }, release: () => undefined };
  return createPostgresStoreRepository({ connect: async () => client } as never);
};

describe('review queue RBAC', () => {
  it('denies non-reviewer accounts before reading submissions', async () => {
    const repo = repositoryWithRows([{ rowCount: 0, rows: [] }]);
    await expect(repo.listPendingReviews('publisher-account')).rejects.toThrow('REVIEWER_REQUIRED');
  });
  it('allows active reviewer accounts to read pending submissions', async () => {
    const repo = repositoryWithRows([
      { rowCount: 1, rows: [{ allowed: true }] },
      { rowCount: 1, rows: [{ submission_id: 'submission-1' }] },
    ]);
    await expect(repo.listPendingReviews('reviewer-account')).resolves.toEqual([{ submission_id: 'submission-1' }]);
  });
  it('replays the same terminal decision but rejects a conflicting decision', async () => {
    const approved = { publisher_id: 'pub', artifact_digest: 'sha256-a', state: 'approved' };
    const replay = repositoryWithRows([
      { rowCount: 1, rows: [approved] },
      { rowCount: 1, rows: [{ decision: 'approved', artifact_digest: 'sha256-a' }] },
    ]);
    await expect(
      replay.decideReview({
        submissionId: 'submission-1',
        reviewerAccountId: 'reviewer',
        decision: 'approved',
        artifactDigest: 'sha256-a',
      })
    ).resolves.toEqual(approved);

    const conflict = repositoryWithRows([
      { rowCount: 1, rows: [approved] },
      { rowCount: 1, rows: [{ decision: 'approved', artifact_digest: 'sha256-a' }] },
    ]);
    await expect(
      conflict.decideReview({
        submissionId: 'submission-1',
        reviewerAccountId: 'reviewer',
        decision: 'rejected',
        artifactDigest: 'sha256-a',
      })
    ).rejects.toThrow('REVIEW_TERMINAL');
  });
});
