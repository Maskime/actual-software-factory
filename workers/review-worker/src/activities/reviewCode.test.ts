import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockConnect, mockClose, mockCallTool, mockAnthropicCreate } = vi.hoisted(() => ({
  mockConnect:        vi.fn().mockResolvedValue(undefined),
  mockClose:          vi.fn().mockResolvedValue(undefined),
  mockCallTool:       vi.fn(),
  mockAnthropicCreate: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect:  mockConnect,
    close:    mockClose,
    callTool: mockCallTool,
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(),
}));

vi.mock('@temporalio/activity', () => ({
  ApplicationFailure: {
    nonRetryable: vi.fn().mockImplementation((msg: string, type: string) => {
      const err = new Error(msg) as Error & { type: string; nonRetryable: boolean };
      err.type = type;
      err.nonRetryable = true;
      return err;
    }),
  },
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  })),
}));

import { reviewCode } from './reviewCode.js';
import type { ReviewComment } from './reviewCode.js';

const DIFF_FIXTURE = [
  {
    old_path: 'src/foo.ts', new_path: 'src/foo.ts',
    diff: '@@ -1 +1 @@\n-old\n+new',
    new_file: false, renamed_file: false, deleted_file: false,
  },
];

const META_FIXTURE = { title: 'feat: add foo', description: 'Closes #1', labels: [] };

const INPUT = { mrIid: 10, projectId: 3, issueIid: 1, branchName: 'feature/1-test' };

function makeMcpResponse(payload: unknown): { content: { type: string; text: string }[]; isError?: boolean } {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

const COMMENT_FIXTURE: ReviewComment = {
  file: 'src/foo.ts',
  line: 1,
  description: 'Variable not used',
  classification: 'esthétique',
};

function makeAnthropicResponse(comments: ReviewComment[]): Anthropic.Message {
  return {
    id: 'msg_01',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'tu_01',
        name: 'submit_review',
        input: { comments },
      },
    ],
    model: 'claude-sonnet-4-6',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  } as unknown as Anthropic.Message;
}

// Import type for use in makeAnthropicResponse signature
import type Anthropic from '@anthropic-ai/sdk';

describe('reviewCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns ReviewComment[] when diff is non-empty', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE));
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse([COMMENT_FIXTURE]));

    const result = await reviewCode(INPUT);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      file: 'src/foo.ts',
      line: 1,
      description: expect.any(String),
      classification: 'esthétique',
    });
  });

  it('calls submit_review tool via tool_choice', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE));
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse([COMMENT_FIXTURE]));

    await reviewCode(INPUT);

    expect(mockAnthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: 'tool', name: 'submit_review' },
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'submit_review' }),
        ]),
      }),
    );
  });

  it('encodes all 4 review criteria and 3 category definitions in the system prompt', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE));
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse([]));

    await reviewCode(INPUT);

    const call = mockAnthropicCreate.mock.calls[0][0] as { system: Array<{ text: string }> };
    const systemText = call.system.map((b) => b.text).join('\n');

    expect(systemText).toMatch(/code quality/i);
    expect(systemText).toMatch(/readability/i);
    expect(systemText).toMatch(/OWASP/i);
    expect(systemText).toMatch(/consistency/i);
    expect(systemText).toContain('bloquant');
    expect(systemText).toContain('modéré');
    expect(systemText).toContain('esthétique');
  });

  it('accepts line: null for file-level comments', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const fileLevelComment: ReviewComment = {
      file: 'src/foo.ts',
      line: null,
      description: 'Missing test coverage',
      classification: 'modéré',
    };
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE));
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse([fileLevelComment]));

    const result = await reviewCode(INPUT);

    expect(result[0].line).toBeNull();
  });

  it('returns comments with valid classification values only', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const comments: ReviewComment[] = [
      { file: 'a.ts', line: 1, description: 'a', classification: 'bloquant' },
      { file: 'b.ts', line: 2, description: 'b', classification: 'modéré' },
      { file: 'c.ts', line: 3, description: 'c', classification: 'esthétique' },
    ];
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE));
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse(comments));

    const result = await reviewCode(INPUT);

    const validClassifications = ['bloquant', 'modéré', 'esthétique'];
    for (const comment of result) {
      expect(validClassifications).toContain(comment.classification);
    }
  });

  it('throws ApplicationFailure(MissingConfigError) when ANTHROPIC_API_KEY is absent', async () => {
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE));

    const err = await reviewCode(INPUT).catch((e: unknown) => e) as Error & { type: string };
    expect(err).toBeInstanceOf(Error);
    expect(err.type).toBe('MissingConfigError');
    expect(err.message).toContain('ANTHROPIC_API_KEY');
  });

  it('throws ApplicationFailure(EmptyDiffError) when diff is empty', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse([]))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE));

    const err = await reviewCode(INPUT).catch((e: unknown) => e) as Error & { type: string };
    expect(err).toBeInstanceOf(Error);
    expect(err.type).toBe('EmptyDiffError');
    expect(err.message).toContain('empty diff');
  });

  it('throws ApplicationFailure(McpToolError) when MCP returns isError', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCallTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Not found' }],
      isError: true,
    });

    const err = await reviewCode(INPUT).catch((e: unknown) => e) as Error & { type: string };
    expect(err).toBeInstanceOf(Error);
    expect(err.type).toBe('McpToolError');
  });
});
