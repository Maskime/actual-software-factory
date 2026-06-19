import type { ReviewAgentInput } from '../types.js';

export async function runFixReviewAgent(_input: ReviewAgentInput): Promise<void> {
  // Dispatched to review-fix-queue — implemented in workers/review-fix-worker
}
