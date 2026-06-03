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

import { reviewCode } from './reviewCode.js';

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

describe('reviewCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves when diff is non-empty and logs MR data', async () => {
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse(DIFF_FIXTURE))   // gitlab_get_mr_diff
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE));  // gitlab_get_mr

    const { log } = await import('@temporalio/activity');
    await expect(reviewCode(INPUT)).resolves.toBeUndefined();

    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'gitlab_get_mr_diff' }),
    );
    expect(mockCallTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'gitlab_get_mr' }),
    );
    expect(log.info).toHaveBeenCalledWith('MR data loaded', expect.objectContaining({
      mrTitle:      META_FIXTURE.title,
      filesChanged: DIFF_FIXTURE.length,
      linkedIssueIid: INPUT.issueIid,
    }));
  });

  it('throws ApplicationFailure(EmptyDiffError) when diff is empty', async () => {
    mockCallTool
      .mockResolvedValueOnce(makeMcpResponse([]))            // gitlab_get_mr_diff → empty
      .mockResolvedValueOnce(makeMcpResponse(META_FIXTURE)); // gitlab_get_mr

    const err = await reviewCode(INPUT).catch((e: unknown) => e) as Error & { type: string };
    expect(err).toBeInstanceOf(Error);
    expect(err.type).toBe('EmptyDiffError');
    expect(err.message).toContain('empty diff');
  });

  it('throws ApplicationFailure(McpToolError) when MCP returns isError', async () => {
    mockCallTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Not found' }],
      isError: true,
    });

    const err = await reviewCode(INPUT).catch((e: unknown) => e) as Error & { type: string };
    expect(err).toBeInstanceOf(Error);
    expect(err.type).toBe('McpToolError');
  });
});
