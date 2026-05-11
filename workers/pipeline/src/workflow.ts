import { proxyActivities, defineSignal, setHandler, condition, upsertSearchAttributes, log } from '@temporalio/workflow';
import { defineSearchAttributeKey } from '@temporalio/common';
import type * as gitlab from './activities/gitlab.js';
import type * as agents from './activities/agents.js';
import type { PipelineInput } from './types.js';
import { WORKFLOW_LABELS, PIPELINE_STAGE } from './types.js';
import { gitlabActivityOptions, agentActivityOptions, humanInTheLoopConfig } from './config.js';

const { applyWorkflowLabel, closeIssue, addIssueComment } = proxyActivities<typeof gitlab>(
  gitlabActivityOptions()
);

const { runDevAgent, runReviewAgent, runFixReviewAgent,
        runStaticAnalysisAgent, runFixStaticAgent, runMergeAgent } =
  proxyActivities<typeof agents>(agentActivityOptions());

const approveMergeSignal = defineSignal('approve-merge');

const issueIidKey = defineSearchAttributeKey('GitLabIssueIid', 'INT');
const stageKey    = defineSearchAttributeKey('PipelineStage', 'KEYWORD');

export async function pipelineWorkflow(input: PipelineInput): Promise<void> {
  const { issueIid: iid, projectId: pid } = input;
  const L = WORKFLOW_LABELS;

  upsertSearchAttributes([
    { key: issueIidKey, value: iid },
    { key: stageKey, value: PIPELINE_STAGE.dev },
  ]);

  await applyWorkflowLabel(pid, iid, L.dev);
  log.info('Starting dev agent', { issueIid: iid, projectId: pid });
  await runDevAgent(input);

  upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.review }]);
  await applyWorkflowLabel(pid, iid, L.review, L.dev);
  log.info('Starting review agent', { issueIid: iid });
  await runReviewAgent(input);

  upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.fix }]);
  await applyWorkflowLabel(pid, iid, L.fix, L.review);
  log.info('Starting fix-review agent', { issueIid: iid });
  await runFixReviewAgent(input);

  upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.sonarqube }]);
  await applyWorkflowLabel(pid, iid, L.sonarqube, L.fix);
  log.info('Starting static analysis agent', { issueIid: iid });
  await runStaticAnalysisAgent(input);
  await runFixStaticAgent(input);

  const hitl = humanInTheLoopConfig();
  if (hitl.enabled) {
    let approved = false;
    // Register handler before applying the label so no incoming signal is missed
    setHandler(approveMergeSignal, () => { approved = true; });

    upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.awaiting_approval }]);
    await applyWorkflowLabel(pid, iid, L.awaiting_approval, L.sonarqube);
    log.info('Awaiting human approval', { issueIid: iid, timeout: hitl.timeout });

    const signaled = await condition(() => approved, hitl.timeout);
    if (!signaled) {
      log.warn('Human-in-the-loop timeout reached', { issueIid: iid, timeout: hitl.timeout });
      await addIssueComment(
        pid, iid,
        `⚠️ Human-in-the-loop timeout reached (${hitl.timeout}). ` +
        `Pipeline is paused. Send the \`approve-merge\` Temporal signal to resume.`
      );
      await condition(() => approved);
    }
  }

  upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.merge }]);
  log.info('Approval received, starting merge', { issueIid: iid });
  await runMergeAgent(input);

  upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.done }]);
  await closeIssue(pid, iid);
}
