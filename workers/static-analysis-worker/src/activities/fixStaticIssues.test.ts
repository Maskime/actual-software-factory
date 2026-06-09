import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockCallMcpTool, mockAuditLog, mockSummarize } = vi.hoisted(() => ({
  mockCallMcpTool: vi.fn(),
  mockAuditLog: vi.fn(),
  mockSummarize: vi.fn((v: unknown) => String(v)),
}));

vi.mock('@factory/worker-shared', () => ({
  callMcpTool: mockCallMcpTool,
  auditLog: mockAuditLog,
  summarize: mockSummarize,
  createAnthropicClient: vi.fn(() => mockAnthropicClient),
  loadPrompt: vi.fn().mockReturnValue('test prompt'),
}));

vi.mock('@temporalio/activity', () => ({
  ApplicationFailure: {
    nonRetryable: vi.fn().mockImplementation((msg: string, type: string) => {
      const err = new Error(msg) as Error & { type: string };
      err.type = type;
      return err;
    }),
  },
  log: { info: vi.fn(), warn: vi.fn() },
  activityInfo: vi.fn(() => ({
    workflowExecution: { workflowId: 'test-workflow-id', runId: 'test-run-id' },
    activityId: 'test-activity-id',
    activityType: { name: 'runFixStaticAgent' },
  })),
}));

const mockCreate = vi.fn();
const mockAnthropicClient = { messages: { create: mockCreate } };

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => mockAnthropicClient),
}));

import { runFixStaticAgent, type FixStaticInput } from './fixStaticIssues.js';

const BASE_INPUT: FixStaticInput = {
  issueIid: 1,
  projectId: 3,
  mrIid: 10,
  branchName: 'feature/1-test',
};

function makeIssuesResponse(issues: Array<{
  key: string; type: string; severity: string; message: string; component: string; line?: number;
}>): string {
  return JSON.stringify({ issues });
}

function makeHotspotsResponse(): string {
  return JSON.stringify({ hotspots: [] });
}

function makeFileResponse(content: string): string {
  return JSON.stringify({ content });
}

function makeApplyFixResponse(fixedContent: string) {
  return {
    content: [{
      type: 'tool_use',
      id: 'tu_1',
      name: 'apply_fix',
      input: { fixed_content: fixedContent },
    }],
    stop_reason: 'tool_use',
  };
}

describe('runFixStaticAgent', () => {
  beforeEach(() => {
    process.env.SONARQUBE_PROJECT_KEY = 'test-project-key';
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.SONARQUBE_PROJECT_KEY;
  });

  it('returns { fixed: 0, skipped: 0 } when no blocking issues', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(makeIssuesResponse([]))
      .mockResolvedValueOnce(makeHotspotsResponse());

    const result = await runFixStaticAgent(BASE_INPUT);

    expect(result).toEqual({ fixed: 0, skipped: 0 });
    expect(mockCallMcpTool).toHaveBeenCalledTimes(2);
  });

  it('returns { fixed: 0, skipped: 0 } when only modéré issues', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(makeIssuesResponse([
        { key: 's1', type: 'CODE_SMELL', severity: 'INFO', message: 'smell', component: 'proj:src/a.ts' },
      ]))
      .mockResolvedValueOnce(makeHotspotsResponse());

    const result = await runFixStaticAgent(BASE_INPUT);

    expect(result).toEqual({ fixed: 0, skipped: 0 });
  });

  it('calls gitlab_get_file with correct branch and file path', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(makeIssuesResponse([
        { key: 'BUG-1', type: 'BUG', severity: 'MAJOR', message: 'null pointer', component: 'proj:src/foo.ts', line: 10 },
      ]))
      .mockResolvedValueOnce(makeHotspotsResponse())
      .mockResolvedValueOnce(makeFileResponse('const x = null;\n'))
      .mockResolvedValueOnce('{}');

    mockCreate.mockResolvedValueOnce(makeApplyFixResponse('const x = "";\n'));

    await runFixStaticAgent(BASE_INPUT);

    expect(mockCallMcpTool).toHaveBeenCalledWith(
      'static-analysis-worker',
      expect.any(String),
      'gitlab_get_file',
      { project_id: '3', file_path: 'src/foo.ts', ref: BASE_INPUT.branchName },
      expect.objectContaining({ workflowId: expect.any(String) }),
    );
  });

  it('calls gitlab_commit_files with commit message referencing the issue key', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(makeIssuesResponse([
        { key: 'BUG-1', type: 'BUG', severity: 'MAJOR', message: 'null pointer', component: 'proj:src/foo.ts', line: 10 },
      ]))
      .mockResolvedValueOnce(makeHotspotsResponse())
      .mockResolvedValueOnce(makeFileResponse('const x = null;\n'))
      .mockResolvedValueOnce('{}');

    mockCreate.mockResolvedValueOnce(makeApplyFixResponse('const x = "";\n'));

    const result = await runFixStaticAgent(BASE_INPUT);

    expect(result).toEqual({ fixed: 1, skipped: 0 });

    const commitCall = mockCallMcpTool.mock.calls.find((c) => c[2] === 'gitlab_commit_files');
    expect(commitCall).toBeDefined();
    expect(commitCall![3].commit_message).toContain('BUG-1');
    expect(commitCall![3].branch).toBe(BASE_INPUT.branchName);
  });

  it('skips and increments skipped when Claude returns no fix', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(makeIssuesResponse([
        { key: 'BUG-1', type: 'BUG', severity: 'MAJOR', message: 'null pointer', component: 'proj:src/foo.ts' },
      ]))
      .mockResolvedValueOnce(makeHotspotsResponse())
      .mockResolvedValueOnce(makeFileResponse('const x = null;\n'));

    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'I cannot fix this.' }],
      stop_reason: 'end_turn',
    });

    const result = await runFixStaticAgent(BASE_INPUT);

    expect(result).toEqual({ fixed: 0, skipped: 1 });
  });

  it('skips and increments skipped when gitlab_get_file throws', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(makeIssuesResponse([
        { key: 'BUG-1', type: 'BUG', severity: 'MAJOR', message: 'null pointer', component: 'proj:src/foo.ts' },
      ]))
      .mockResolvedValueOnce(makeHotspotsResponse())
      .mockRejectedValueOnce(new Error('GitLab 404'));

    const result = await runFixStaticAgent(BASE_INPUT);

    expect(result).toEqual({ fixed: 0, skipped: 1 });
  });

  it('groups multiple issues in the same file into one commit', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(makeIssuesResponse([
        { key: 'BUG-1', type: 'BUG', severity: 'MAJOR', message: 'null pointer', component: 'proj:src/foo.ts', line: 5 },
        { key: 'BUG-2', type: 'BUG', severity: 'MAJOR', message: 'wrong cast', component: 'proj:src/foo.ts', line: 12 },
      ]))
      .mockResolvedValueOnce(makeHotspotsResponse())
      .mockResolvedValueOnce(makeFileResponse('const x = null;\n'))
      .mockResolvedValueOnce('{}');

    mockCreate.mockResolvedValueOnce(makeApplyFixResponse('const x = "";\n'));

    const result = await runFixStaticAgent(BASE_INPUT);

    expect(result).toEqual({ fixed: 1, skipped: 0 });
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const commitCall = mockCallMcpTool.mock.calls.find((c) => c[2] === 'gitlab_commit_files');
    expect(commitCall![3].commit_message).toContain('BUG-1');
    expect(commitCall![3].commit_message).toContain('BUG-2');
  });

  it('processes multiple files independently — failure in one does not stop others', async () => {
    mockCallMcpTool
      .mockResolvedValueOnce(makeIssuesResponse([
        { key: 'BUG-1', type: 'BUG', severity: 'MAJOR', message: 'err', component: 'proj:src/a.ts' },
        { key: 'BUG-2', type: 'BUG', severity: 'MAJOR', message: 'err', component: 'proj:src/b.ts' },
      ]))
      .mockResolvedValueOnce(makeHotspotsResponse())
      .mockRejectedValueOnce(new Error('file a not found'))      // a.ts fetch fails
      .mockResolvedValueOnce(makeFileResponse('const y = 0;\n')) // b.ts fetch succeeds
      .mockResolvedValueOnce('{}');                               // b.ts commit

    mockCreate.mockResolvedValueOnce(makeApplyFixResponse('const y = 1;\n'));

    const result = await runFixStaticAgent(BASE_INPUT);

    expect(result.fixed).toBe(1);
    expect(result.skipped).toBe(1);
  });
});
