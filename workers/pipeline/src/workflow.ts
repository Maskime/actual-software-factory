import { proxyActivities, defineSignal, setHandler, condition } from '@temporalio/workflow';
import type * as gitlab from './activities/gitlab.js';
import type * as agents from './activities/agents.js';
import type { PipelineInput } from './types.js';
import { WORKFLOW_LABELS } from './types.js';
import { gitlabActivityOptions, agentActivityOptions, humanInTheLoopConfig } from './config.js';

const { applyWorkflowLabel, closeIssue, addIssueComment } = proxyActivities<typeof gitlab>(
  gitlabActivityOptions()
);

const { runDevAgent, runReviewAgent, runFixReviewAgent,
        runStaticAnalysisAgent, runFixStaticAgent, runMergeAgent } =
  proxyActivities<typeof agents>(agentActivityOptions());

const approveMergeSignal = defineSignal('approve-merge');

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

  const hitl = humanInTheLoopConfig();
  if (hitl.enabled) {
    let approved = false;
    // Register handler before applying the label so no incoming signal is missed
    setHandler(approveMergeSignal, () => { approved = true; });

    await applyWorkflowLabel(pid, iid, L.awaiting_approval, L.sonarqube);

    const signaled = await condition(() => approved, hitl.timeout);
    if (!signaled) {
      await addIssueComment(
        pid, iid,
        `⚠️ Human-in-the-loop timeout reached (${hitl.timeout}). ` +
        `Pipeline is paused. Send the \`approve-merge\` Temporal signal to resume.`
      );
      await condition(() => approved);
    }
  }

  await runMergeAgent(input);
  await closeIssue(pid, iid);
}
