import type { PipelineInput } from '../types.js';

// Stubs — will be implemented in EPIC-05 to EPIC-09
export async function runDevAgent(_input: PipelineInput): Promise<void> {}
export async function runReviewAgent(_input: PipelineInput): Promise<void> {}
export async function runFixReviewAgent(_input: PipelineInput): Promise<void> {}
export async function runStaticAnalysisAgent(_input: PipelineInput): Promise<void> {}
export async function runFixStaticAgent(_input: PipelineInput): Promise<void> {}
export async function runMergeAgent(_input: PipelineInput): Promise<void> {}
