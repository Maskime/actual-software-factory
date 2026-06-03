import {
  proxyActivities, defineSignal, setHandler, condition,
  upsertSearchAttributes, log, ActivityFailure,
} from '@temporalio/workflow';
import { defineSearchAttributeKey } from '@temporalio/common';
import type * as gitlab from './activities/gitlab.js';
import type * as agents from './activities/agents.js';
import type * as reviewActivities from './activities/reviewAgent.js';
import type { PipelineInput } from './types.js';
import { WORKFLOW_LABELS, PIPELINE_STAGE } from './types.js';
import {
  gitlabActivityOptions, agentActivityOptions, reviewAgentActivityOptions,
  humanInTheLoopConfig, suspendNotificationConfig,
} from './config.js';

const { applyWorkflowLabel, closeIssue, addIssueComment } = proxyActivities<typeof gitlab>(
  gitlabActivityOptions()
);

const { runDevAgent, runFixReviewAgent,
        runStaticAnalysisAgent, runFixStaticAgent, runMergeAgent } =
  proxyActivities<typeof agents>(agentActivityOptions());

const { reviewCode } = proxyActivities<typeof reviewActivities>(reviewAgentActivityOptions());

const approveMergeSignal = defineSignal('approve-merge');
const resumeSignal        = defineSignal('resume');

const issueIidKey = defineSearchAttributeKey('GitLabIssueIid', 'INT');
const stageKey    = defineSearchAttributeKey('PipelineStage', 'KEYWORD');

// ---------------------------------------------------------------------------
// Module-level helpers — extracted to keep pipelineWorkflow cognitive complexity low
// ---------------------------------------------------------------------------

interface SuspendCtx {
  pid: number;
  iid: number;
  L: typeof WORKFLOW_LABELS;
  notifyEnabled: boolean;
  resumeCountRef: { value: number };
  currentLabelRef: { value: string };
}

function causeMessage(err: unknown): string {
  if (err instanceof ActivityFailure && err.cause instanceof Error) return err.cause.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

async function notifySuspension(
  pid: number, iid: number,
  stageName: string, msg: string,
  suspendedFrom: string, notifyEnabled: boolean,
  L: typeof WORKFLOW_LABELS,
): Promise<void> {
  try {
    await applyWorkflowLabel(pid, iid, L.suspended, suspendedFrom);
    if (notifyEnabled) {
      await addIssueComment(pid, iid,
        `❌ Pipeline suspendu à l'étape \`${stageName}\` : ${msg}\n\n` +
        `Envoyez le signal Temporal \`resume\` pour relancer depuis cette étape.`);
    }
  } catch (notifyErr) {
    log.warn('Failed to notify suspension via GitLab', {
      issueIid: iid,
      error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
    });
  }
}

async function restoreAfterResume(
  pid: number, iid: number,
  stageValue: string, suspendedFrom: string,
  L: typeof WORKFLOW_LABELS,
): Promise<void> {
  upsertSearchAttributes([{ key: stageKey, value: stageValue }]);
  try {
    await applyWorkflowLabel(pid, iid, suspendedFrom, L.suspended);
  } catch (restoreErr) {
    log.warn('Failed to restore label after resume', {
      issueIid: iid,
      error: restoreErr instanceof Error ? restoreErr.message : String(restoreErr),
    });
  }
}

async function withSuspendOnFailure<T>(
  ctx: SuspendCtx,
  stageName: string,
  stageValue: string,
  fn: () => Promise<T>,
): Promise<T> {
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const msg = causeMessage(err);
      log.error('Pipeline suspended', { issueIid: ctx.iid, stage: stageName, error: msg });
      const suspendedFrom  = ctx.currentLabelRef.value;
      const expectedResume = ctx.resumeCountRef.value + 1;
      upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.suspended }]);
      await notifySuspension(ctx.pid, ctx.iid, stageName, msg, suspendedFrom, ctx.notifyEnabled, ctx.L);
      ctx.currentLabelRef.value = ctx.L.suspended;
      await condition(() => ctx.resumeCountRef.value >= expectedResume);
      await restoreAfterResume(ctx.pid, ctx.iid, stageValue, suspendedFrom, ctx.L);
      ctx.currentLabelRef.value = suspendedFrom;
    }
  }
}

// ---------------------------------------------------------------------------
// Exported workflow
// ---------------------------------------------------------------------------

export async function pipelineWorkflow(input: PipelineInput): Promise<void> {
  const { issueIid: iid, projectId: pid } = input;
  const L      = WORKFLOW_LABELS;
  const notify = suspendNotificationConfig();

  const resumeCountRef  = { value: 0 };
  const currentLabelRef = { value: '' };
  setHandler(resumeSignal, () => { resumeCountRef.value++; });

  const ctx: SuspendCtx = { pid, iid, L, notifyEnabled: notify.enabled, resumeCountRef, currentLabelRef };

  async function applyLabel(add: string, remove?: string): Promise<void> {
    await applyWorkflowLabel(pid, iid, add, remove);
    currentLabelRef.value = add;
  }

  upsertSearchAttributes([
    { key: issueIidKey, value: iid },
    { key: stageKey, value: PIPELINE_STAGE.dev },
  ]);

  await applyLabel(L.dev);
  log.info('Starting dev agent', { issueIid: iid, projectId: pid });
  const devOutput = await withSuspendOnFailure(ctx, 'dev', PIPELINE_STAGE.dev, () => runDevAgent(input));
  log.info('Dev agent completed', { mrIid: devOutput.mrIid, branchName: devOutput.branchName });

  upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.review }]);
  await applyLabel(L.review, L.dev);
  log.info('Starting review agent', { issueIid: iid });
  const reviewOutput = await withSuspendOnFailure(ctx, 'review', PIPELINE_STAGE.review, () =>
    reviewCode({ ...input, mrIid: devOutput.mrIid, branchName: devOutput.branchName })
  );
  log.info('Review agent completed', {
    commentsCount: reviewOutput.comments.length,
    blocking: reviewOutput.comments.filter((c) => c.classification === 'bloquant').length,
  });

  upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.fix }]);
  await applyLabel(L.fix, L.review);
  log.info('Starting fix-review agent', { issueIid: iid });
  await withSuspendOnFailure(ctx, 'fix', PIPELINE_STAGE.fix, () => runFixReviewAgent(input));

  upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.sonarqube }]);
  await applyLabel(L.sonarqube, L.fix);
  log.info('Starting static analysis agent', { issueIid: iid });
  await withSuspendOnFailure(ctx, 'sonarqube', PIPELINE_STAGE.sonarqube, () => runStaticAnalysisAgent(input));
  await withSuspendOnFailure(ctx, 'sonarqube', PIPELINE_STAGE.sonarqube, () => runFixStaticAgent(input));

  const hitl = humanInTheLoopConfig();
  if (hitl.enabled) {
    let approved = false;
    // Register before applyLabel so no incoming signal is missed
    setHandler(approveMergeSignal, () => { approved = true; });

    upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.awaiting_approval }]);
    await applyLabel(L.awaiting_approval, L.sonarqube);
    log.info('Awaiting human approval', { issueIid: iid, timeout: hitl.timeout });

    const signaled = await condition(() => approved, hitl.timeout);
    if (!signaled) {
      log.warn('Human-in-the-loop timeout reached', { issueIid: iid, timeout: hitl.timeout });
      await addIssueComment(pid, iid,
        `⚠️ Human-in-the-loop timeout reached (${hitl.timeout}). ` +
        `Pipeline is paused. Send the \`approve-merge\` Temporal signal to resume.`);
      await condition(() => approved);
    }
  }

  upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.merge }]);
  await applyLabel(L.merge, currentLabelRef.value);
  log.info('Starting merge agent', { issueIid: iid });
  await withSuspendOnFailure(ctx, 'merge', PIPELINE_STAGE.merge, () => runMergeAgent(input));

  upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.done }]);
  await closeIssue(pid, iid);
}
