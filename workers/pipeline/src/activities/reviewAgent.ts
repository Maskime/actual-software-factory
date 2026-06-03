import type { ReviewAgentInput } from '../types.js';

export async function reviewCode(_input: ReviewAgentInput): Promise<void> {
  // Dispatched to review-agent task queue — implemented in workers/review-worker
}
