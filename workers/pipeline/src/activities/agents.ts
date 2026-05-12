import type { DevAgentOutput, PipelineInput, ReviewAgentInput } from '../types.js';

export async function runDevAgent(_input: PipelineInput): Promise<DevAgentOutput> {
  // Implemented in EPIC-05
  throw new Error('Not implemented');
}

export async function runReviewAgent(_input: ReviewAgentInput): Promise<void> {
  // Implemented in EPIC-06
}

export async function runFixReviewAgent(_input: PipelineInput): Promise<void> {
  // Implemented in EPIC-07
}

export async function runStaticAnalysisAgent(_input: PipelineInput): Promise<void> {
  // Implemented in EPIC-08
}

export async function runFixStaticAgent(_input: PipelineInput): Promise<void> {
  // Implemented in EPIC-09
}

export async function runMergeAgent(_input: PipelineInput): Promise<void> {
  // Implemented in EPIC-09
}
