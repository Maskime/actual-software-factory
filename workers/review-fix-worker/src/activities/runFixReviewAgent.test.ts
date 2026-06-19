import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFixCode, mockCreateBacklogIssues } = vi.hoisted(() => ({
  mockFixCode: vi.fn(),
  mockCreateBacklogIssues: vi.fn(),
}));

vi.mock('./fixCode.js', () => ({
  fixCode: mockFixCode,
}));

vi.mock('./createBacklogIssues.js', () => ({
  createBacklogIssues: mockCreateBacklogIssues,
}));

import { runFixReviewAgent } from './runFixReviewAgent.js';

const INPUT = { issueIid: 1, projectId: 3, mrIid: 10, branchName: 'feature/1-test' };

describe('runFixReviewAgent orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFixCode.mockResolvedValue({ fixed: 1, skipped: 0 });
    mockCreateBacklogIssues.mockResolvedValue({ created: 0, skipped: 0 });
  });

  it('calls createBacklogIssues with projectId and mrIid', async () => {
    await runFixReviewAgent(INPUT);
    expect(mockCreateBacklogIssues).toHaveBeenCalledWith({ projectId: 3, mrIid: 10 });
  });

  it('calls fixCode with the full input', async () => {
    await runFixReviewAgent(INPUT);
    expect(mockFixCode).toHaveBeenCalledWith(INPUT);
  });

  it('runs createBacklogIssues before fixCode', async () => {
    await runFixReviewAgent(INPUT);
    const backlogOrder = mockCreateBacklogIssues.mock.invocationCallOrder[0];
    const fixOrder = mockFixCode.mock.invocationCallOrder[0];
    expect(backlogOrder).toBeLessThan(fixOrder);
  });

  it('does not call fixCode if createBacklogIssues throws', async () => {
    mockCreateBacklogIssues.mockRejectedValue(new Error('backlog failed'));
    await expect(runFixReviewAgent(INPUT)).rejects.toThrow('backlog failed');
    expect(mockFixCode).not.toHaveBeenCalled();
  });

  it('resolves to undefined', async () => {
    await expect(runFixReviewAgent(INPUT)).resolves.toBeUndefined();
  });
});
