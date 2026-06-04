import type { ReviewAgentInput, ReviewAgentOutput } from '../types.js';

export async function reviewCode(_input: ReviewAgentInput): Promise<ReviewAgentOutput> {
  // Dispatched to review-agent task queue — implemented in workers/review-worker
  return { comments: [], bloquant: 0, modéré: 0, esthétique: 0, backlogIssueIids: [] };
}
