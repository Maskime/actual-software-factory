import { proxyActivities } from '@temporalio/workflow';
import type * as gitlab from './activities/gitlab.js';
import type * as agents from './activities/agents.js';
import type { PipelineInput } from './types.js';
import { WORKFLOW_LABELS } from './types.js';
import { gitlabActivityOptions, agentActivityOptions } from './config.js';

const { applyWorkflowLabel, closeIssue } = proxyActivities<typeof gitlab>(
  gitlabActivityOptions()
);

const { runDevAgent, runReviewAgent, runFixReviewAgent,
        runStaticAnalysisAgent, runFixStaticAgent, runMergeAgent } =
  proxyActivities<typeof agents>(agentActivityOptions());

export async function pipelineWorkflow(input: PipelineInput): Promise<void> {
  const { issueIid: iid, projectId: pid } = input;
  const L = WORKFLOW_LABELS;

  await applyWorkflowLabel(pid, iid, L.dev);
  await runDevAgent(input);

  await applyWorkflowLabel(pid, iid, L.review, L.dev);
  await runReviewAgent(input);

  await applyWorkflowLabel(pid, iid, L.fix, L.review);
  await runFixReviewAgent(input);

  await applyWorkflowLabel(pid, iid, L.sonarqube, L.fix);
  await runStaticAnalysisAgent(input);
  await runFixStaticAgent(input);

  await runMergeAgent(input);
  await closeIssue(pid, iid);
}
