import { describe, it, expect, vi } from 'vitest';
import { reviewCode } from './reviewCode.js';

vi.mock('@temporalio/activity', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('reviewCode', () => {
  it('resolves without error', async () => {
    await expect(
      reviewCode({ mrIid: 10, projectId: 3, issueIid: 1, branchName: 'feature/1-test' })
    ).resolves.toBeUndefined();
  });
});
