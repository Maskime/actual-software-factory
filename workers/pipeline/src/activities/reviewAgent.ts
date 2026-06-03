import type { ReviewAgentInput, ReviewAgentOutput } from '../types.js';

export async function reviewCode(_input: ReviewAgentInput): Promise<ReviewAgentOutput> {
  // Dispatched to review-agent task queue — implemented in workers/review-worker
  return { comments: [] };
}
