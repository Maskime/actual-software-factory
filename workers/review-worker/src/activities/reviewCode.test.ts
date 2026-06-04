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

const META_FIXTURE = { title: 'feat: add foo', description: 'Closes #1', labels: [], web_url: 'http://localhost/root/software-factory/-/merge_requests/10' };

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

  it('returns ReviewAgentOutput when diff is non-empty', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 1 }))  // inline comment
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 2 })); // summary
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse([COMMENT_FIXTURE]));

    const result = await reviewCode(INPUT);

    expect(result).toHaveProperty('comments');
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]).toMatchObject({
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
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 1 }))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 2 }));
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
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 1 })); // summary only (no comments)
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
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 1 }))  // summary only
      .mockResolvedValueOnce(makeMcpResponse({ iid: 1, id: 1, web_url: 'http://localhost/...' })); // backlog issue
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse([fileLevelComment]));

    const result = await reviewCode(INPUT);

    expect(result.comments[0].line).toBeNull();
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
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 1 }))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 2 }))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 3 }))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 4 }))  // summary
      .mockResolvedValueOnce(makeMcpResponse({ iid: 1, id: 1, web_url: 'http://localhost/...' })); // backlog issue
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse(comments));

    const result = await reviewCode(INPUT);

    const validClassifications = ['bloquant', 'modéré', 'esthétique'];
    for (const comment of result.comments) {
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

  // --- US-4 tests ---

  it('posts an inline comment for each comment with a non-null line', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const comments: ReviewComment[] = [
      { file: 'src/a.ts', line: 10, description: 'Bug here', classification: 'bloquant' },
      { file: 'src/b.ts', line: 5,  description: 'Style issue', classification: 'esthétique' },
    ];
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 1 }))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 2 }))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 3 }));
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse(comments));

    await reviewCode(INPUT);

    expect(mockCallTool).toHaveBeenNthCalledWith(3,
      expect.objectContaining({
        name: 'gitlab_add_mr_inline_comment',
        arguments: expect.objectContaining({
          file_path: 'src/a.ts',
          new_line: 10,
          body: expect.stringContaining('[BLOQUANT]'),
        }),
      }),
    );
    expect(mockCallTool).toHaveBeenNthCalledWith(4,
      expect.objectContaining({
        name: 'gitlab_add_mr_inline_comment',
        arguments: expect.objectContaining({
          file_path: 'src/b.ts',
          new_line: 5,
          body: expect.stringContaining('[ESTHÉTIQUE]'),
        }),
      }),
    );
  });

  it('skips inline posting for comments with line null and includes them in summary', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const fileLevel: ReviewComment = {
      file: 'src/a.ts',
      line: null,
      description: 'No tests written',
      classification: 'modéré',
    };
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 1 }))
      .mockResolvedValueOnce(makeMcpResponse({ iid: 1, id: 1, web_url: 'http://localhost/...' })); // backlog issue
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse([fileLevel]));

    await reviewCode(INPUT);

    expect(mockCallTool).toHaveBeenCalledTimes(4);
    expect(mockCallTool).toHaveBeenNthCalledWith(3,
      expect.objectContaining({
        name: 'gitlab_add_mr_comment',
        arguments: expect.objectContaining({
          body: expect.stringContaining('No tests written'),
        }),
      }),
    );
  });

  it('logs a warning and continues when an inline comment fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const comments: ReviewComment[] = [
      { file: 'src/a.ts', line: 999, description: 'Bug', classification: 'bloquant' },
      { file: 'src/b.ts', line: 5,   description: 'Style', classification: 'esthétique' },
    ];
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE))
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'line not in diff' }], isError: true })
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 2 }))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 3 }));
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse(comments));

    const result = await reviewCode(INPUT);

    const { log } = await import('@temporalio/activity');
    expect(log.warn).toHaveBeenCalledWith(
      'Failed to post inline comment',
      expect.objectContaining({ file: 'src/a.ts', line: 999 }),
    );
    expect(result.comments).toHaveLength(2);
  });

  it('posts an empty summary even when there are no review comments', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 1 }));
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse([]));

    const result = await reviewCode(INPUT);

    expect(result.comments).toHaveLength(0);
    expect(mockCallTool).toHaveBeenNthCalledWith(3,
      expect.objectContaining({ name: 'gitlab_add_mr_comment' }),
    );
  });

  // --- US-5 tests ---

  it('creates a backlog issue for each modéré comment', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const comments: ReviewComment[] = [
      { file: 'src/a.ts', line: 10,   description: 'Missing error handling', classification: 'modéré' },
      { file: 'src/b.ts', line: null, description: 'No tests written',       classification: 'modéré' },
    ];
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 1 }))  // inline a.ts
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 2 }))  // summary
      .mockResolvedValueOnce(makeMcpResponse({ iid: 1, id: 1, web_url: 'http://localhost/...' }))  // issue a.ts
      .mockResolvedValueOnce(makeMcpResponse({ iid: 2, id: 2, web_url: 'http://localhost/...' })); // issue b.ts
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse(comments));

    await reviewCode(INPUT);

    type CallArg = { name: string };
    const issueCalls = mockCallTool.mock.calls
      .map((c: unknown[]) => c[0] as CallArg)
      .filter((a) => a.name === 'gitlab_create_issue');
    expect(issueCalls).toHaveLength(2);
  });

  it('backlog issue has correct title, description, label and MR link', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const comment: ReviewComment = {
      file: 'src/a.ts',
      line: 10,
      description: 'Missing error handling',
      classification: 'modéré',
    };
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 1 }))  // inline
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 2 }))  // summary
      .mockResolvedValueOnce(makeMcpResponse({ iid: 1, id: 1, web_url: 'http://localhost/...' })); // issue
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse([comment]));

    await reviewCode(INPUT);

    type IssueCallArg = { name: string; arguments: { title: string; description: string; labels: string; project_id: string } };
    const issueCall = mockCallTool.mock.calls
      .map((c: unknown[]) => c[0] as IssueCallArg)
      .find((a) => a.name === 'gitlab_create_issue')!;
    expect(issueCall.arguments.title).toContain('[Backlog]');
    expect(issueCall.arguments.title).toContain('src/a.ts:10');
    expect(issueCall.arguments.title).toContain('Missing error handling');
    expect(issueCall.arguments.description).toContain('Missing error handling');
    expect(issueCall.arguments.description).toContain(META_FIXTURE.web_url);
    expect(issueCall.arguments.description).toContain('`src/a.ts:10`');
    expect(issueCall.arguments.labels).toBe('backlog');
    expect(issueCall.arguments.project_id).toBe('3');
  });

  it('does not create backlog issues for bloquant or esthétique comments', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const comments: ReviewComment[] = [
      { file: 'src/a.ts', line: 1, description: 'Security bug',  classification: 'bloquant' },
      { file: 'src/b.ts', line: 2, description: 'Style issue',   classification: 'esthétique' },
    ];
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 1 }))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 2 }))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 3 }));
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse(comments));

    await reviewCode(INPUT);

    type CallArg = { name: string };
    const issueCalls = mockCallTool.mock.calls
      .map((c: unknown[]) => c[0] as CallArg)
      .filter((a) => a.name === 'gitlab_create_issue');
    expect(issueCalls).toHaveLength(0);
  });

  it('logs a warning and continues when backlog issue creation fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const comment: ReviewComment = {
      file: 'src/a.ts',
      line: 5,
      description: 'Missing error handling',
      classification: 'modéré',
    };
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 1 }))  // inline
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 2 }))  // summary
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Forbidden' }], isError: true }); // issue fails
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse([comment]));

    const result = await reviewCode(INPUT);

    const { log } = await import('@temporalio/activity');
    expect(log.warn).toHaveBeenCalledWith(
      'Failed to create backlog issue',
      expect.objectContaining({ file: 'src/a.ts', line: 5 }),
    );
    expect(result.comments).toHaveLength(1);
  });

  it('summary body contains a count table with correct totals and file-level comment', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const comments: ReviewComment[] = [
      { file: 'a.ts', line: 1,    description: 'bug1',    classification: 'bloquant' },
      { file: 'b.ts', line: 2,    description: 'bug2',    classification: 'bloquant' },
      { file: 'c.ts', line: 3,    description: 'improve', classification: 'modéré' },
      { file: 'd.ts', line: null, description: 'no tests', classification: 'esthétique' },
    ];
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 1 }))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 2 }))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 3 }))
      .mockResolvedValueOnce(makeMcpResponse({ note_id: 4 }))  // summary
      .mockResolvedValueOnce(makeMcpResponse({ iid: 1, id: 1, web_url: 'http://localhost/...' })); // backlog issue
    mockAnthropicCreate.mockResolvedValue(makeAnthropicResponse(comments));

    await reviewCode(INPUT);

    type CallArg = { name: string; arguments: { body: string } };
    const summaryCall = mockCallTool.mock.calls
      .map((c: unknown[]) => c[0] as CallArg)
      .find((a) => a.name === 'gitlab_add_mr_comment')!;
    const body = summaryCall.arguments.body;
    expect(body).toContain('[BLOQUANT]');
    expect(body).toContain('[MODÉRÉ]');
    expect(body).toContain('[ESTHÉTIQUE]');
    expect(body).toContain('| [BLOQUANT] | 2 |');
    expect(body).toContain('| [MODÉRÉ] | 1 |');
    expect(body).toContain('| [ESTHÉTIQUE] | 1 |');
    expect(body).toContain('d.ts');
    expect(body).toContain('no tests');
  });
});
