import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk');
vi.mock('@factory/worker-shared', () => ({
  loadPrompt: vi.fn().mockReturnValue('review system prompt'),
}));
vi.mock('./gitlab.js', () => ({
  fetchMrDiffs: vi.fn(),
}));

import Anthropic from '@anthropic-ai/sdk';
import { fetchMrDiffs } from './gitlab.js';
import { evalReviewAgent } from './evalReview.js';

const FAKE_DIFFS = [
  { new_path: 'src/foo.ts', old_path: 'src/foo.ts', diff: '@@ -1 +1 @@ const x = 1;' },
];

const FAKE_COMMENTS = [
  { file: 'src/foo.ts', line: 1, description: 'Missing error handling', classification: 'bloquant' },
  { file: 'src/foo.ts', description: 'Style issue', classification: 'esthétique' },
];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  vi.mocked(fetchMrDiffs).mockResolvedValue(FAKE_DIFFS);
});

function buildAnthropicMock(toolInput: object) {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [{ type: 'tool_use', id: 'tu-1', name: 'submit_review', input: toolInput }],
  });
  vi.mocked(Anthropic).mockImplementation(
    () => ({ messages: { create: mockCreate } }) as unknown as Anthropic,
  );
  return mockCreate;
}

describe('evalReviewAgent', () => {
  it('returns an EvalResult for each case', async () => {
    buildAnthropicMock({ comments: FAKE_COMMENTS });

    const results = await evalReviewAgent([{ mrIid: 42, projectId: 3, description: 'Test MR' }]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      iid: 42,
      structureValid: true,
      promptVersion: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns empty array for empty cases', async () => {
    buildAnthropicMock({ comments: [] });
    const results = await evalReviewAgent([]);
    expect(results).toEqual([]);
  });

  it('throws when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(
      evalReviewAgent([{ mrIid: 1, projectId: 3, description: '' }]),
    ).rejects.toThrow('ANTHROPIC_API_KEY');
  });

  it('handles missing tool_use block in response', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'No tool use here' }],
    });
    vi.mocked(Anthropic).mockImplementation(
      () => ({ messages: { create: mockCreate } }) as unknown as Anthropic,
    );

    const results = await evalReviewAgent([{ mrIid: 10, projectId: 3, description: '' }]);
    expect(results[0].structureValid).toBe(true);
    expect(results[0].outputLength).toBe(2); // JSON.stringify([]) → '[]'
  });

  it('processes multiple cases independently', async () => {
    const mockCreate = buildAnthropicMock({ comments: FAKE_COMMENTS });
    vi.mocked(fetchMrDiffs)
      .mockResolvedValueOnce(FAKE_DIFFS)
      .mockResolvedValueOnce(FAKE_DIFFS);

    const results = await evalReviewAgent([
      { mrIid: 1, projectId: 3, description: '' },
      { mrIid: 2, projectId: 3, description: '' },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].iid).toBe(1);
    expect(results[1].iid).toBe(2);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('scores criteriaHit against the 3 classification types', async () => {
    buildAnthropicMock({ comments: FAKE_COMMENTS });

    const results = await evalReviewAgent([{ mrIid: 5, projectId: 3, description: '' }]);
    expect(results[0].criteriaTotal).toBe(3);
    expect(results[0].criteriaHit).toBeGreaterThan(0);
  });
});
