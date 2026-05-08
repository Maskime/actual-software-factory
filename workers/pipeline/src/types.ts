export interface PipelineInput {
  issueIid: number;
  projectId: number;
}

export const WORKFLOW_LABELS = {
  dev: 'workflow::dev',
  review: 'workflow::review',
  fix: 'workflow::fix',
  sonarqube: 'workflow::sonarqube',
} as const;
