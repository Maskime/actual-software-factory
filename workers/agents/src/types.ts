export interface AgentInput {
  projectId: number;
  issueIid: number;
  workflowRunId: string;
}

export interface IssueContext {
  title: string;
  description: string;
  acceptanceCriteria: string[];
}

export interface WorkspaceContext {
  workDir: string;
  issue: IssueContext;
}

export interface DevAgentOutput {
  mrIid: number;
  branchName: string;
  projectId: number;
}
