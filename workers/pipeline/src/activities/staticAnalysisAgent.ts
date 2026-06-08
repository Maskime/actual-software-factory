import type { ReviewAgentInput, StaticAnalysisResult } from '../types.js';

export async function runStaticAnalysisAgent(
  _input: ReviewAgentInput,
): Promise<StaticAnalysisResult> {
  // Dispatched to static-analysis-agent task queue — implemented in workers/static-analysis-worker
  return { bloquant: [], modéré: [], hasBlockingIssues: false };
}

export async function runFixStaticAgent(_input: ReviewAgentInput): Promise<void> {
  // Dispatched to static-analysis-agent task queue — implemented in workers/static-analysis-worker
}

export async function runVerifyAndMergeAgent(
  _input: ReviewAgentInput,
): Promise<{ status: 'success' | 'failure'; blockingCount: number }> {
  // Dispatched to static-analysis-agent task queue — implemented in workers/static-analysis-worker
  return { status: 'success', blockingCount: 0 };
}
