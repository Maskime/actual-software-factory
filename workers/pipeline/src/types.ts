export interface PipelineInput {
  issueIid: number;
  projectId: number;
}

export interface SonarqubeScanResult {
  status: 'passed' | 'failed';
  sonarqubePrKey: string;
}

export const WORKFLOW_LABELS = {
  dev:               'workflow::dev',
  review:            'workflow::review',
  fix:               'workflow::fix',
  sonarqube:         'workflow::sonarqube',
  awaiting_ci:       'workflow::awaiting-ci',
  awaiting_approval: 'workflow::awaiting-approval',
  merge:             'workflow::merge',
  suspended:         'workflow::suspended',
} as const;

// Temporal search attribute values for PipelineStage (Keyword type).
// Keys mirror WORKFLOW_LABELS keys where both overlap; 'merge' and 'done' have no GitLab label equivalent.
export const PIPELINE_STAGE = {
  dev:               'dev',
  review:            'review',
  fix:               'fix',
  sonarqube:         'sonarqube',
  awaiting_ci:       'awaiting-ci',
  awaiting_approval: 'awaiting-approval',
  merge:             'merge',
  done:              'done',
  suspended:         'suspended',
} as const;
export type PipelineStageValue = typeof PIPELINE_STAGE[keyof typeof PIPELINE_STAGE];

export interface DevAgentOutput {
  mrIid: number;
  branchName: string;
  projectId: number;
}

export interface ReviewAgentInput {
  issueIid: number;
  projectId: number;
  mrIid: number;
  branchName: string;
}

export type { ReviewComment, ReviewAgentOutput } from '@factory/worker-shared';
