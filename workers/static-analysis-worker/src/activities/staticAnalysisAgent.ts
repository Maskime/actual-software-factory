export interface PipelineInput {
  issueIid: number;
  projectId: number;
}

export async function runStaticAnalysisAgent(_input: PipelineInput): Promise<void> {
  // Implementation pending — subsequent EPIC-09 user stories will add SonarQube analysis logic
}
