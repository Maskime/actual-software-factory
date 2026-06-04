import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockConnect, mockClose, mockCallTool } = vi.hoisted(() => ({
  mockConnect:  vi.fn().mockResolvedValue(undefined),
  mockClose:    vi.fn().mockResolvedValue(undefined),
  mockCallTool: vi.fn(),
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

const { mockAnthropicCreate } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  })),
}));

import { fixCode } from './fixCode.js';

const INPUT = { issueIid: 1, projectId: 3, mrIid: 10, branchName: 'feature/42' };

function makeMrResponse(comments: unknown[]): { content: { type: string; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify({ comments }) }] };
}

function makeDiffResponse(changes: unknown[] = []): { content: { type: string; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(changes) }] };
}

function makeFileResponse(content: string): { content: { type: string; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify({ content }) }] };
}

function makeApplyFixResponse(fixedContent: string): { content: unknown[] } {
  return {
    content: [{
      type: 'tool_use',
      id: 'tu_1',
      name: 'apply_fix',
      input: { fixed_content: fixedContent },
    }],
  };
}

function makeCommitResponse(): { content: { type: string; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify({ id: 'abc123' }) }] };
}

describe('fixCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  // ── Filtering tests (0 blocking comments) ──────────────────────────────────

  it('returns { fixed: 0, skipped: 0 } when MR has no comments', async () => {
    mockCallTool.mockResolvedValueOnce(makeMrResponse([]));
    const result = await fixCode(INPUT);
    expect(result).toEqual({ fixed: 0, skipped: 0 });
  });

  it('returns { fixed: 0, skipped: 0 } when comments exist but none start with [BLOQUANT]', async () => {
    mockCallTool.mockResolvedValueOnce(makeMrResponse([
      { id: 1, body: '[MODÉRÉ] Missing error handling', position: null },
      { id: 2, body: '[ESTHÉTIQUE] Rename variable', position: null },
    ]));
    const result = await fixCode(INPUT);
    expect(result).toEqual({ fixed: 0, skipped: 0 });
  });

  // ── File-level blocking comments (no file path) ────────────────────────────

  it('skips file-level blocking comment (position: null) and counts it', async () => {
    mockCallTool.mockResolvedValueOnce(makeMrResponse([
      { id: 1, body: '[BLOQUANT] General architecture issue', position: null },
    ]));
    mockCallTool.mockResolvedValueOnce(makeDiffResponse());
    const result = await fixCode(INPUT);
    expect(result).toEqual({ fixed: 0, skipped: 1 });
  });

  // ── Full fix pipeline ──────────────────────────────────────────────────────

  it('fixes one blocking comment with a file target', async () => {
    mockCallTool
      .mockResolvedValueOnce(makeMrResponse([
        { id: 1, body: '[BLOQUANT] Null dereference on line 5', position: { new_path: 'src/foo.ts', new_line: 5 } },
      ]))
      .mockResolvedValueOnce(makeDiffResponse([
        { old_path: 'src/foo.ts', new_path: 'src/foo.ts', diff: '@@ -1,3 +1,3 @@\n-old\n+new' },
      ]))
      .mockResolvedValueOnce(makeFileResponse('const x = obj.value;'))
      .mockResolvedValueOnce(makeCommitResponse());
    mockAnthropicCreate.mockResolvedValueOnce(makeApplyFixResponse('const x = obj?.value;'));

    const result = await fixCode(INPUT);
    expect(result).toEqual({ fixed: 1, skipped: 0 });
  });

  it('fixes file comment and skips file-level comment', async () => {
    mockCallTool
      .mockResolvedValueOnce(makeMrResponse([
        { id: 1, body: '[BLOQUANT] SQL injection risk', position: { new_path: 'src/db.ts', new_line: 10 } },
        { id: 2, body: '[BLOQUANT] General arch issue', position: null },
      ]))
      .mockResolvedValueOnce(makeDiffResponse([]))
      .mockResolvedValueOnce(makeFileResponse('db.query(`SELECT * FROM users WHERE id = ${id}`);'))
      .mockResolvedValueOnce(makeCommitResponse());
    mockAnthropicCreate.mockResolvedValueOnce(makeApplyFixResponse('db.query("SELECT * FROM users WHERE id = ?", [id]);'));

    const result = await fixCode(INPUT);
    expect(result).toEqual({ fixed: 1, skipped: 1 });
  });

  it('skips when Claude does not call apply_fix', async () => {
    mockCallTool
      .mockResolvedValueOnce(makeMrResponse([
        { id: 1, body: '[BLOQUANT] Null dereference', position: { new_path: 'src/foo.ts', new_line: 5 } },
      ]))
      .mockResolvedValueOnce(makeDiffResponse([]))
      .mockResolvedValueOnce(makeFileResponse('const x = obj.value;'));
    mockAnthropicCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'I cannot fix this.' }] });

    const result = await fixCode(INPUT);
    expect(result).toEqual({ fixed: 0, skipped: 1 });
  });

  it('uses correct commit message with [BLOQUANT] prefix', async () => {
    const feedback = 'Null dereference on line 5';
    mockCallTool
      .mockResolvedValueOnce(makeMrResponse([
        { id: 1, body: `[BLOQUANT] ${feedback}`, position: { new_path: 'src/foo.ts', new_line: 5 } },
      ]))
      .mockResolvedValueOnce(makeDiffResponse([]))
      .mockResolvedValueOnce(makeFileResponse('original'))
      .mockResolvedValueOnce(makeCommitResponse());
    mockAnthropicCreate.mockResolvedValueOnce(makeApplyFixResponse('fixed'));

    await fixCode(INPUT);

    const commitCall = mockCallTool.mock.calls[3];
    const args = commitCall[0].arguments as { commit_message: string };
    expect(args.commit_message).toBe(`fix: [BLOQUANT] ${feedback}`);
  });

  it('truncates feedback message longer than 72 chars in commit message', async () => {
    const longFeedback = 'A'.repeat(100);
    mockCallTool
      .mockResolvedValueOnce(makeMrResponse([
        { id: 1, body: `[BLOQUANT] ${longFeedback}`, position: { new_path: 'src/foo.ts', new_line: 5 } },
      ]))
      .mockResolvedValueOnce(makeDiffResponse([]))
      .mockResolvedValueOnce(makeFileResponse('original'))
      .mockResolvedValueOnce(makeCommitResponse());
    mockAnthropicCreate.mockResolvedValueOnce(makeApplyFixResponse('fixed'));

    await fixCode(INPUT);

    const commitCall = mockCallTool.mock.calls[3];
    const args = commitCall[0].arguments as { commit_message: string };
    expect(args.commit_message).toBe(`fix: [BLOQUANT] ${'A'.repeat(72)}`);
  });

  it('passes file content and diff to Claude', async () => {
    const fileContent = 'const foo = bar.baz;';
    const fileDiff = '@@ -1 +1 @@\n-old\n+new';
    mockCallTool
      .mockResolvedValueOnce(makeMrResponse([
        { id: 1, body: '[BLOQUANT] Missing null check', position: { new_path: 'src/foo.ts', new_line: 1 } },
      ]))
      .mockResolvedValueOnce(makeDiffResponse([
        { old_path: 'src/foo.ts', new_path: 'src/foo.ts', diff: fileDiff },
      ]))
      .mockResolvedValueOnce(makeFileResponse(fileContent))
      .mockResolvedValueOnce(makeCommitResponse());
    mockAnthropicCreate.mockResolvedValueOnce(makeApplyFixResponse('fixed'));

    await fixCode(INPUT);

    const claudeCall = mockAnthropicCreate.mock.calls[0][0];
    const userMessage = claudeCall.messages[0].content as string;
    expect(userMessage).toContain(fileContent);
    expect(userMessage).toContain(fileDiff);
    expect(userMessage).toContain('Missing null check');
  });

  it('throws McpToolError when gitlab_get_mr returns isError', async () => {
    mockCallTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Not found' }],
      isError: true,
    });
    const err = await fixCode(INPUT).catch((e: unknown) => e) as Error & { type: string };
    expect(err).toBeInstanceOf(Error);
    expect(err.type).toBe('McpToolError');
  });

  it('does not match summary note that contains [BLOQUANT] inside a Markdown table', async () => {
    mockCallTool.mockResolvedValueOnce(makeMrResponse([
      { id: 1, body: '## Synthese de la revue de code\n\n| Classification | Nombre |\n|---|---|\n| [BLOQUANT] | 2 |', position: null },
    ]));
    const result = await fixCode(INPUT);
    expect(result).toEqual({ fixed: 0, skipped: 0 });
  });

  // ── Position mapping (preserved from US-2) ────────────────────────────────

  it('maps position.new_path and position.new_line', async () => {
    mockCallTool
      .mockResolvedValueOnce(makeMrResponse([
        { id: 1, body: '[BLOQUANT] Bug', position: { new_path: 'src/foo.ts', old_path: 'src/foo.ts', new_line: 42, old_line: null } },
      ]))
      .mockResolvedValueOnce(makeDiffResponse([]))
      .mockResolvedValueOnce(makeFileResponse('original'))
      .mockResolvedValueOnce(makeCommitResponse());
    mockAnthropicCreate.mockResolvedValueOnce(makeApplyFixResponse('fixed'));

    await fixCode(INPUT);

    const claudeCall = mockAnthropicCreate.mock.calls[0][0];
    const userMessage = claudeCall.messages[0].content as string;
    expect(userMessage).toContain('src/foo.ts');
    expect(userMessage).toContain('line 42');
  });
});
