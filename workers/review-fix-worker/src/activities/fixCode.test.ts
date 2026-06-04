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

import { fixCode } from './fixCode.js';

const INPUT = { issueIid: 1, projectId: 3, mrIid: 10 };

function makeMrResponse(comments: unknown[]): { content: { type: string; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify({ comments }) }] };
}

describe('fixCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns [] when MR has no comments', async () => {
    mockCallTool.mockResolvedValueOnce(makeMrResponse([]));
    const result = await fixCode(INPUT);
    expect(result).toEqual([]);
  });

  it('returns [] when comments exist but none start with [BLOQUANT]', async () => {
    mockCallTool.mockResolvedValueOnce(makeMrResponse([
      { id: 1, body: '[MODÉRÉ] Missing error handling', position: null },
      { id: 2, body: '[ESTHÉTIQUE] Rename variable', position: null },
    ]));
    const result = await fixCode(INPUT);
    expect(result).toEqual([]);
  });

  it('keeps [BLOQUANT] notes and filters out [MODÉRÉ] and [ESTHÉTIQUE]', async () => {
    mockCallTool.mockResolvedValueOnce(makeMrResponse([
      { id: 1, body: '[BLOQUANT] Null dereference on line 5', position: null },
      { id: 2, body: '[MODÉRÉ] Missing error handling', position: null },
      { id: 3, body: '[ESTHÉTIQUE] Rename variable', position: null },
      { id: 4, body: '[BLOQUANT] SQL injection risk', position: null },
    ]));
    const result = await fixCode(INPUT);
    expect(result).toHaveLength(2);
    expect(result[0].message).toBe('Null dereference on line 5');
    expect(result[1].message).toBe('SQL injection risk');
  });

  it('maps position.new_path and position.new_line to file and line', async () => {
    mockCallTool.mockResolvedValueOnce(makeMrResponse([
      {
        id: 1,
        body: '[BLOQUANT] Null dereference',
        position: { new_path: 'src/foo.ts', old_path: 'src/foo.ts', new_line: 42, old_line: null },
      },
    ]));
    const result = await fixCode(INPUT);
    expect(result[0].file).toBe('src/foo.ts');
    expect(result[0].line).toBe(42);
  });

  it('falls back to position.old_path and position.old_line when new_* are absent', async () => {
    mockCallTool.mockResolvedValueOnce(makeMrResponse([
      {
        id: 1,
        body: '[BLOQUANT] Deleted line issue',
        position: { new_path: undefined, old_path: 'src/bar.ts', new_line: undefined, old_line: 7 },
      },
    ]));
    const result = await fixCode(INPUT);
    expect(result[0].file).toBe('src/bar.ts');
    expect(result[0].line).toBe(7);
  });

  it('returns file: null and line: null for notes without position', async () => {
    mockCallTool.mockResolvedValueOnce(makeMrResponse([
      { id: 1, body: '[BLOQUANT] File-level issue', position: null },
    ]));
    const result = await fixCode(INPUT);
    expect(result[0].file).toBeNull();
    expect(result[0].line).toBeNull();
  });

  it('strips [BLOQUANT] prefix and trims whitespace from message', async () => {
    mockCallTool.mockResolvedValueOnce(makeMrResponse([
      { id: 1, body: '[BLOQUANT]   Leading and trailing spaces   ', position: null },
    ]));
    const result = await fixCode(INPUT);
    expect(result[0].message).toBe('Leading and trailing spaces');
  });

  it('throws McpToolError when MCP returns isError', async () => {
    mockCallTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Not found' }],
      isError: true,
    });
    const err = await fixCode(INPUT).catch((e: unknown) => e) as Error & { type: string };
    expect(err).toBeInstanceOf(Error);
    expect(err.type).toBe('McpToolError');
  });

  it('does not match the summary note that contains [BLOQUANT] inside a Markdown table', async () => {
    mockCallTool.mockResolvedValueOnce(makeMrResponse([
      { id: 1, body: '## Synthese de la revue de code\n\n| Classification | Nombre |\n|---|---|\n| [BLOQUANT] | 2 |', position: null },
    ]));
    const result = await fixCode(INPUT);
    expect(result).toEqual([]);
  });
});
