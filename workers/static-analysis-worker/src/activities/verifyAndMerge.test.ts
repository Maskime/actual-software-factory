import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockCallMcpTool, mockMetricLog } = vi.hoisted(() => ({
  mockCallMcpTool: vi.fn(),
  mockMetricLog:   vi.fn(),
}));

vi.mock('@factory/worker-shared', () => ({
  callMcpTool: mockCallMcpTool,
  metricLog:   mockMetricLog,
}));

vi.mock('@temporalio/activity', () => ({
  ApplicationFailure: {
    nonRetryable: vi.fn().mockImplementation((msg: string, type: string) => {
      const err = new Error(msg) as Error & { type: string };
      err.type = type;
      return err;
    }),
  },
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  activityInfo: vi.fn(() => ({
    workflowExecution: { workflowId: 'wf-123', runId: 'run-1' },
    activityId:        'act-1',
  })),
}));

vi.mock('./staticAnalysisAgent.js', () => ({
  fetchSonarIssues: vi.fn(),
  classifyIssue:    vi.fn(),
}));

import { runVerifyAndMergeAgent, type VerifyAndMergeInput } from './verifyAndMerge.js';
import { fetchSonarIssues, classifyIssue } from './staticAnalysisAgent.js';

const mockFetchSonarIssues = vi.mocked(fetchSonarIssues);
const mockClassifyIssue    = vi.mocked(classifyIssue);

const BASE_INPUT: VerifyAndMergeInput = {
  issueIid:   1,
  projectId:  3,
  mrIid:      10,
  branchName: 'feature/1-test',
};

const BLOCKING_ISSUE = {
  key: 'BUG-1', type: 'BUG', severity: 'MAJOR', message: 'null pointer', component: 'proj:src/foo.ts',
};

beforeEach(() => {
  process.env.SONARQUBE_PROJECT_KEY = 'test-key';
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.SONARQUBE_PROJECT_KEY;
});

describe('runVerifyAndMergeAgent', () => {
  it('returns failure and does not call gitlab_merge_mr when blocking issues persist', async () => {
    mockFetchSonarIssues.mockResolvedValueOnce([BLOCKING_ISSUE]);
    mockClassifyIssue.mockReturnValue('bloquant');

    const result = await runVerifyAndMergeAgent(BASE_INPUT);

    expect(result).toEqual({ status: 'failure', blockingCount: 1 });
    const mergeCalls = mockCallMcpTool.mock.calls.filter((c) => c[2] === 'gitlab_merge_mr');
    expect(mergeCalls).toHaveLength(0);
  });

  it('returns success and calls gitlab_merge_mr with correct args when no blocking issues', async () => {
    mockFetchSonarIssues.mockResolvedValueOnce([]);
    mockCallMcpTool.mockResolvedValue('{}');

    const result = await runVerifyAndMergeAgent(BASE_INPUT);

    expect(result).toEqual({ status: 'success', blockingCount: 0 });
    const mergeCall = mockCallMcpTool.mock.calls.find((c) => c[2] === 'gitlab_merge_mr');
    expect(mergeCall).toBeDefined();
    expect(mergeCall![3]).toEqual({ project_id: '3', mr_iid: 10 });
  });

  it('sends verify-and-merge-completed signal with status failure when blocking issues persist', async () => {
    mockFetchSonarIssues.mockResolvedValueOnce([BLOCKING_ISSUE]);
    mockClassifyIssue.mockReturnValue('bloquant');
    mockCallMcpTool.mockResolvedValue('{}');

    await runVerifyAndMergeAgent(BASE_INPUT);

    const signalCall = mockCallMcpTool.mock.calls.find((c) => c[2] === 'temporal_send_signal');
    expect(signalCall).toBeDefined();
    expect(signalCall![3]).toMatchObject({
      signal_name: 'verify-and-merge-completed',
      payload: { status: 'failure', blockingCount: 1 },
    });
  });

  it('sends verify-and-merge-completed signal with status success when clean', async () => {
    mockFetchSonarIssues.mockResolvedValueOnce([]);
    mockCallMcpTool.mockResolvedValue('{}');

    await runVerifyAndMergeAgent(BASE_INPUT);

    const signalCall = mockCallMcpTool.mock.calls.find((c) => c[2] === 'temporal_send_signal');
    expect(signalCall).toBeDefined();
    expect(signalCall![3]).toMatchObject({
      signal_name: 'verify-and-merge-completed',
      payload: { status: 'success', blockingCount: 0 },
    });
  });

  it('does not throw when temporal_send_signal fails', async () => {
    mockFetchSonarIssues.mockResolvedValueOnce([]);
    mockCallMcpTool
      .mockResolvedValueOnce('{}')             // gitlab_merge_mr
      .mockRejectedValueOnce(new Error('MCP error')); // temporal_send_signal

    await expect(runVerifyAndMergeAgent(BASE_INPUT)).resolves.toEqual({ status: 'success', blockingCount: 0 });
  });

  it('propagates gitlab_merge_mr error so withSuspendOnFailure can suspend', async () => {
    mockFetchSonarIssues.mockResolvedValueOnce([]);
    mockCallMcpTool.mockRejectedValueOnce(new Error('GitLab 500'));

    await expect(runVerifyAndMergeAgent(BASE_INPUT)).rejects.toThrow('GitLab 500');
  });

  it('calls metricLog in finally regardless of outcome', async () => {
    mockFetchSonarIssues.mockResolvedValueOnce([BLOCKING_ISSUE]);
    mockClassifyIssue.mockReturnValue('bloquant');
    mockCallMcpTool.mockResolvedValue('{}');

    await runVerifyAndMergeAgent(BASE_INPUT);

    expect(mockMetricLog).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'metric', stage: 'merge' }),
    );
  });
});
