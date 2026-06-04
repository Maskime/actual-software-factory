import type { PipelineInput } from '../types.js';

export async function runStaticAnalysisAgent(_input: PipelineInput): Promise<void> {
  // Dispatched to static-analysis-agent task queue — implemented in workers/static-analysis-worker
}
