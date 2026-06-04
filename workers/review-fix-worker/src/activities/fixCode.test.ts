import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCallMcpTool, mockAnthropicCreate } = vi.hoisted(() => ({
  mockCallMcpTool:    vi.fn(),
  mockAnthropicCreate: vi.fn(),
}));

vi.mock('@factory/worker-shared', () => ({
  callMcpTool: mockCallMcpTool,
  createAnthropicClient: vi.fn().mockReturnValue({
    messages: { create: mockAnthropicCreate },
  }),
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

import { fixCode } from './fixCode.js';

const INPUT = { issueIid: 1, projectId: 3, mrIid: 10, branchName: 'feature/42' };

// callMcpTool returns a plain string (the text content extracted by worker-shared)
function mrText(comments: unknown[]): string {
  return JSON.stringify({ comments });
}
function diffText(changes: unknown[] = []): string {
  return JSON.stringify(changes);
}
function fileText(content: string): string {
  return JSON.stringify({ content });
}
function commitText(): string {
  return JSON.stringify({ id: 'abc123' });
}

function applyFixResponse(fixedContent: string): { content: unknown[] } {
  return {
    content: [{
      type: 'tool_use',
      id:   'tu_1',
      name: 'apply_fix',
      input: { fixed_content: fixedContent },
    }],
  };
}

describe('fixCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Filtering tests (0 blocking comments) ──────────────────────────────────

  it('returns { fixed: 0, skipped: 0 } when MR has no comments', async () => {
    mockCallMcpTool.mockResolvedValueOnce(mrText([]));
    expect(await fixCode(INPUT)).toEqual({ fixed: 0, skipped: 0 });
  });

  it('returns { fixed: 0, skipped: 0 } when no comments start with [BLOQUANT]', async () => {
    mockCallMcpTool.mockResolvedValueOnce(mrText([
      { id: 1, body: '[MODÉRÉ] Missing error handling', position: null },
      { id: 2, body: '[ESTHÉTIQUE] Rename variable',    position: null },
    ]));
    expect(await fixCode(INPUT)).toEqual({ fixed: 0, skipped: 0 });
  });

  // ── File-level blocking comments (no file path) ────────────────────────────

  it('skips file-level blocking comment (position: null) and counts it', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(mrText([
        { id: 1, body: '[BLOQUANT] General architecture issue', position: null },
      ]))
      .mockResolvedValueOnce(diffText());
    expect(await fixCode(INPUT)).toEqual({ fixed: 0, skipped: 1 });
  });

  // ── Full fix pipeline ──────────────────────────────────────────────────────

  it('fixes one blocking comment with a file target', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(mrText([
        { id: 1, body: '[BLOQUANT] Null dereference on line 5', position: { new_path: 'src/foo.ts', new_line: 5 } },
      ]))
      .mockResolvedValueOnce(diffText([
        { old_path: 'src/foo.ts', new_path: 'src/foo.ts', diff: '@@ -1,3 +1,3 @@\n-old\n+new' },
      ]))
      .mockResolvedValueOnce(fileText('const x = obj.value;'))
      .mockResolvedValueOnce(commitText());
    mockAnthropicCreate.mockResolvedValueOnce(applyFixResponse('const x = obj?.value;'));

    expect(await fixCode(INPUT)).toEqual({ fixed: 1, skipped: 0 });
  });

  it('fixes file comment and skips file-level comment', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(mrText([
        { id: 1, body: '[BLOQUANT] SQL injection risk',    position: { new_path: 'src/db.ts', new_line: 10 } },
        { id: 2, body: '[BLOQUANT] General arch issue',   position: null },
      ]))
      .mockResolvedValueOnce(diffText([]))
      .mockResolvedValueOnce(fileText('db.query(`SELECT * FROM users WHERE id = ${id}`);'))
      .mockResolvedValueOnce(commitText());
    mockAnthropicCreate.mockResolvedValueOnce(applyFixResponse('db.query("SELECT * FROM users WHERE id = ?", [id]);'));

    expect(await fixCode(INPUT)).toEqual({ fixed: 1, skipped: 1 });
  });

  it('skips when Claude does not call apply_fix', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(mrText([
        { id: 1, body: '[BLOQUANT] Null dereference', position: { new_path: 'src/foo.ts', new_line: 5 } },
      ]))
      .mockResolvedValueOnce(diffText([]))
      .mockResolvedValueOnce(fileText('const x = obj.value;'));
    mockAnthropicCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'I cannot fix this.' }] });

    expect(await fixCode(INPUT)).toEqual({ fixed: 0, skipped: 1 });
  });

  it('uses correct commit message with [BLOQUANT] prefix', async () => {
    const feedback = 'Null dereference on line 5';
    mockCallMcpTool
      .mockResolvedValueOnce(mrText([
        { id: 1, body: `[BLOQUANT] ${feedback}`, position: { new_path: 'src/foo.ts', new_line: 5 } },
      ]))
      .mockResolvedValueOnce(diffText([]))
      .mockResolvedValueOnce(fileText('original'))
      .mockResolvedValueOnce(commitText());
    mockAnthropicCreate.mockResolvedValueOnce(applyFixResponse('fixed'));

    await fixCode(INPUT);

    // calls: [0] gitlab_get_mr, [1] gitlab_get_mr_diff, [2] gitlab_get_file, [3] gitlab_commit_files
    const [, , , commitArgs] = mockCallMcpTool.mock.calls[3] as [string, string, string, { commit_message: string }];
    expect(commitArgs.commit_message).toBe(`fix: [BLOQUANT] ${feedback}`);
  });

  it('truncates feedback message longer than 72 chars in commit message', async () => {
    const longFeedback = 'A'.repeat(100);
    mockCallMcpTool
      .mockResolvedValueOnce(mrText([
        { id: 1, body: `[BLOQUANT] ${longFeedback}`, position: { new_path: 'src/foo.ts', new_line: 5 } },
      ]))
      .mockResolvedValueOnce(diffText([]))
      .mockResolvedValueOnce(fileText('original'))
      .mockResolvedValueOnce(commitText());
    mockAnthropicCreate.mockResolvedValueOnce(applyFixResponse('fixed'));

    await fixCode(INPUT);

    const [, , , commitArgs] = mockCallMcpTool.mock.calls[3] as [string, string, string, { commit_message: string }];
    expect(commitArgs.commit_message).toBe(`fix: [BLOQUANT] ${'A'.repeat(72)}`);
  });

  it('passes file content and diff to Claude', async () => {
    const fileContent = 'const foo = bar.baz;';
    const fileDiff    = '@@ -1 +1 @@\n-old\n+new';
    mockCallMcpTool
      .mockResolvedValueOnce(mrText([
        { id: 1, body: '[BLOQUANT] Missing null check', position: { new_path: 'src/foo.ts', new_line: 1 } },
      ]))
      .mockResolvedValueOnce(diffText([
        { old_path: 'src/foo.ts', new_path: 'src/foo.ts', diff: fileDiff },
      ]))
      .mockResolvedValueOnce(fileText(fileContent))
      .mockResolvedValueOnce(commitText());
    mockAnthropicCreate.mockResolvedValueOnce(applyFixResponse('fixed'));

    await fixCode(INPUT);

    const claudeArg = mockAnthropicCreate.mock.calls[0][0] as { messages: Array<{ content: string }> };
    const userMessage = claudeArg.messages[0].content;
    expect(userMessage).toContain(fileContent);
    expect(userMessage).toContain(fileDiff);
    expect(userMessage).toContain('Missing null check');
  });

  it('throws McpToolError when gitlab_get_mr returns isError', async () => {
    const err = Object.assign(new Error('gitlab_get_mr failed'), { type: 'McpToolError', nonRetryable: true });
    mockCallMcpTool.mockRejectedValueOnce(err);
    const caught = await fixCode(INPUT).catch((e: unknown) => e) as Error & { type: string };
    expect(caught).toBeInstanceOf(Error);
    expect(caught.type).toBe('McpToolError');
  });

  it('does not match summary note that contains [BLOQUANT] inside a Markdown table', async () => {
    mockCallMcpTool.mockResolvedValueOnce(mrText([
      {
        id: 1,
        body: '## Synthese de la revue de code\n\n| Classification | Nombre |\n|---|---|\n| [BLOQUANT] | 2 |',
        position: null,
      },
    ]));
    expect(await fixCode(INPUT)).toEqual({ fixed: 0, skipped: 0 });
  });

  // ── Position mapping (preserved from US-2) ────────────────────────────────

  it('maps position.new_path and position.new_line', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(mrText([
        {
          id: 1,
          body: '[BLOQUANT] Bug',
          position: { new_path: 'src/foo.ts', old_path: 'src/foo.ts', new_line: 42, old_line: null },
        },
      ]))
      .mockResolvedValueOnce(diffText([]))
      .mockResolvedValueOnce(fileText('original'))
      .mockResolvedValueOnce(commitText());
    mockAnthropicCreate.mockResolvedValueOnce(applyFixResponse('fixed'));

    await fixCode(INPUT);

    const claudeArg = mockAnthropicCreate.mock.calls[0][0] as { messages: Array<{ content: string }> };
    const userMessage = claudeArg.messages[0].content;
    expect(userMessage).toContain('src/foo.ts');
    expect(userMessage).toContain('line 42');
  });
});
