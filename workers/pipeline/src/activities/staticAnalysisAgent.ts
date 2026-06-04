import type { ReviewAgentInput, StaticAnalysisResult } from '../types.js';

export async function runStaticAnalysisAgent(
  _input: ReviewAgentInput,
): Promise<StaticAnalysisResult> {
  // Dispatched to static-analysis-agent task queue — implemented in workers/static-analysis-worker
  return { bloquant: [], modéré: [], hasBlockingIssues: false };
}
