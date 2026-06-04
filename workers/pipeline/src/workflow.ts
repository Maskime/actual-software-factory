import {
  proxyActivities, defineSignal, setHandler, condition,
  upsertSearchAttributes, log, ActivityFailure,
} from '@temporalio/workflow';
import { defineSearchAttributeKey } from '@temporalio/common';
import type * as gitlab from './activities/gitlab.js';
import type * as agents from './activities/agents.js';
import type * as reviewActivities from './activities/reviewAgent.js';
import type * as staticAnalysisActivities from './activities/staticAnalysisAgent.js';
import type { PipelineInput, SonarqubeScanResult } from './types.js';
import { WORKFLOW_LABELS, PIPELINE_STAGE } from './types.js';
import {
  gitlabActivityOptions, agentActivityOptions, reviewAgentActivityOptions,
  staticAnalysisActivityOptions,
  humanInTheLoopConfig, suspendNotificationConfig, sonarqubeCiTimeoutConfig,
} from './config.js';

const { applyWorkflowLabel, closeIssue, addIssueComment } = proxyActivities<typeof gitlab>(
  gitlabActivityOptions()
);

const { runDevAgent, runFixReviewAgent,
        runFixStaticAgent, runMergeAgent } =
  proxyActivities<typeof agents>(agentActivityOptions());

const { reviewCode } = proxyActivities<typeof reviewActivities>(reviewAgentActivityOptions());

const { runStaticAnalysisAgent } = proxyActivities<typeof staticAnalysisActivities>(staticAnalysisActivityOptions());

const approveMergeSignal             = defineSignal('approve-merge');
const resumeSignal                    = defineSignal('resume');
const sonarqubeScanCompletedSignal    = defineSignal<[SonarqubeScanResult]>('sonarqube-scan-completed');

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

  const resumeCountRef    = { value: 0 };
  const currentLabelRef   = { value: '' };
  const scanResultVersion = { value: 0 };
  let sonarqubeScanResult: SonarqubeScanResult | undefined;

  setHandler(resumeSignal, () => { resumeCountRef.value++; });
  setHandler(sonarqubeScanCompletedSignal, (r) => { sonarqubeScanResult = r; scanResultVersion.value++; });

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
    blocking: reviewOutput.bloquant,
  });

  if (reviewOutput.bloquant > 0) {
    upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.fix }]);
    await applyLabel(L.fix, L.review);
    log.info('Starting fix-review agent', { issueIid: iid, bloquant: reviewOutput.bloquant });
    await withSuspendOnFailure(ctx, 'fix', PIPELINE_STAGE.fix, () => runFixReviewAgent(input));
    upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.sonarqube }]);
    await applyLabel(L.sonarqube, L.fix);
  } else {
    log.info('No blocking comments — skipping fix-review agent', { issueIid: iid });
    upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.sonarqube }]);
    await applyLabel(L.sonarqube, L.review);
  }
  log.info('Starting static analysis agent', { issueIid: iid });
  await withSuspendOnFailure(ctx, 'sonarqube', PIPELINE_STAGE.sonarqube, () => runStaticAnalysisAgent(input));

  // Await GitLab CI pipeline completion via webhook signal
  upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.awaiting_ci }]);
  await applyLabel(L.awaiting_ci, L.sonarqube);
  log.info('Awaiting sonarqube-scan-completed signal', { issueIid: iid });

  const ciTimeout = sonarqubeCiTimeoutConfig().timeout;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const expectedVersion = scanResultVersion.value + 1;
    const signaled = await condition(() => scanResultVersion.value >= expectedVersion, ciTimeout);

    if (!signaled) {
      log.warn('CI timeout — waiting indefinitely for signal', { issueIid: iid });
      await addIssueComment(pid, iid,
        `⚠️ Timeout en attente du signal \`sonarqube-scan-completed\`. ` +
        `Relancer le pipeline CI ou envoyer le signal manuellement.`);
      await condition(() => scanResultVersion.value >= expectedVersion);
    }

    if (sonarqubeScanResult!.status === 'passed') {
      log.info('CI SonarQube passed', { issueIid: iid, prKey: sonarqubeScanResult!.sonarqubePrKey });
      break;
    }

    log.warn('CI SonarQube failed — suspending', { issueIid: iid });
    const suspendedFrom  = currentLabelRef.value;
    const expectedResume = resumeCountRef.value + 1;
    upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.suspended }]);
    await notifySuspension(pid, iid, 'sonarqube-ci',
      'Le pipeline CI SonarQube a échoué. Corriger et relancer le pipeline CI pour reprendre.',
      suspendedFrom, notify.enabled, L);
    ctx.currentLabelRef.value = L.suspended;
    await condition(() => ctx.resumeCountRef.value >= expectedResume);
    await restoreAfterResume(pid, iid, PIPELINE_STAGE.awaiting_ci, suspendedFrom, L);
    ctx.currentLabelRef.value = suspendedFrom;
  }

  upsertSearchAttributes([{ key: stageKey, value: PIPELINE_STAGE.sonarqube }]);
  await applyLabel(L.sonarqube, L.awaiting_ci);

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
