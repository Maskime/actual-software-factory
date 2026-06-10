import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/sdk');
vi.mock('@factory/worker-shared', () => ({
  loadPrompt: vi.fn().mockReturnValue('system prompt text'),
}));
vi.mock('./gitlab.js', () => ({
  fetchIssue: vi.fn(),
}));

import Anthropic from '@anthropic-ai/sdk';
import { fetchIssue } from './gitlab.js';
import { evalDevAgent } from './evalDev.js';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_MODEL = 'claude-test';

  vi.mocked(fetchIssue).mockResolvedValue({
    iid: 1,
    title: 'Test Issue',
    description: '- implement the feature\n- write tests',
  });
});

function buildAnthropicMock(outputText: string) {
  const mockCreate = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: outputText }],
  });
  vi.mocked(Anthropic).mockImplementation(
    () => ({ messages: { create: mockCreate } }) as unknown as Anthropic,
  );
  return mockCreate;
}

describe('evalDevAgent', () => {
  it('returns an EvalResult for each case', async () => {
    buildAnthropicMock('1. Create src/feature.ts\n2. Add tests in feature.test.ts');

    const results = await evalDevAgent([{ iid: 1, description: 'test' }], 3);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      iid: 1,
      structureValid: true,
      mentionsFiles: true,
      promptVersion: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(results[0].outputLength).toBeGreaterThan(0);
  });

  it('returns empty array for empty cases', async () => {
    buildAnthropicMock('');
    const results = await evalDevAgent([], 3);
    expect(results).toEqual([]);
  });

  it('throws when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(evalDevAgent([{ iid: 1, description: '' }], 3)).rejects.toThrow('ANTHROPIC_API_KEY');
  });

  it('handles issue with no acceptance criteria', async () => {
    vi.mocked(fetchIssue).mockResolvedValue({
      iid: 2,
      title: 'Simple Issue',
      description: 'A plain description with no list items.',
    });
    buildAnthropicMock('- Do src/thing.ts');

    const results = await evalDevAgent([{ iid: 2, description: '' }], 3);
    expect(results[0].criteriaTotal).toBe(0);
    expect(results[0].criteriaHit).toBe(0);
  });

  it('processes multiple cases independently', async () => {
    const mockCreate = buildAnthropicMock('1. Do src/foo.ts');
    vi.mocked(fetchIssue)
      .mockResolvedValueOnce({ iid: 1, title: 'Issue 1', description: '- criterion one' })
      .mockResolvedValueOnce({ iid: 2, title: 'Issue 2', description: '- criterion two' });

    const results = await evalDevAgent(
      [{ iid: 1, description: '' }, { iid: 2, description: '' }],
      3,
    );

    expect(results).toHaveLength(2);
    expect(results[0].iid).toBe(1);
    expect(results[1].iid).toBe(2);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('uses ANTHROPIC_MODEL env var when set', async () => {
    process.env.ANTHROPIC_MODEL = 'claude-opus-4-8';
    const mockCreate = buildAnthropicMock('- src/result.ts');

    await evalDevAgent([{ iid: 1, description: '' }], 3);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-8' }),
    );
  });
});
