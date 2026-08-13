import { describe, expect, it } from 'vitest';
import { usageByConsumer } from '@/renderer/pages/settings/router9/router9Usage';

describe('usageByConsumer', () => {
  it('merges per-model buckets belonging to the same CLI key', () => {
    const rows = usageByConsumer({
      totalRequests: 3,
      totalPromptTokens: 30,
      totalCompletionTokens: 9,
      totalCachedTokens: 4,
      totalCost: 0.3,
      byApiKey: {
        first: { keyName: 'Tomny · Codex CLI', requests: 1, promptTokens: 10, completionTokens: 4, cost: 0.1 },
        second: { keyName: 'Tomny · Codex CLI', requests: 2, promptTokens: 20, completionTokens: 5, cost: 0.2 },
      },
    });

    expect(rows).toEqual([
      expect.objectContaining({
        consumer: 'Tomny · Codex CLI',
        requests: 3,
        promptTokens: 30,
        completionTokens: 9,
        cost: 0.30000000000000004,
      }),
    ]);
  });
});
