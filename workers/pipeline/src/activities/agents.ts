import type { DevAgentOutput, PipelineInput } from '../types.js';

export async function runDevAgent(_input: PipelineInput): Promise<DevAgentOutput> {
  // Implemented in EPIC-05
  throw new Error('Not implemented');
}

export async function runFixReviewAgent(_input: PipelineInput): Promise<void> {
  // Implemented in EPIC-07
}

// Reserved — superseded by runVerifyAndMergeAgent (static-analysis-agent task queue, EPIC-09 US-5)
export async function runMergeAgent(_input: PipelineInput): Promise<void> {
}
