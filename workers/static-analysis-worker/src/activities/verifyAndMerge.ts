import { ApplicationFailure, activityInfo, log } from '@temporalio/activity';
import { callMcpTool, metricLog, type AuditContext } from '@factory/worker-shared';
import { fetchSonarIssues, classifyIssue } from './staticAnalysisAgent.js';

export interface VerifyAndMergeInput {
  issueIid: number;
  projectId: number;
  mrIid: number;
  branchName: string;
}

export interface VerifyAndMergeOutput {
  status: 'success' | 'failure';
  blockingCount: number;
}

const WORKER_NAME = 'static-analysis-worker';

function verifyAndMergeConfig(): {
  projectKey: string;
  mcpSonarqubeUrl: string;
  mcpGitlabUrl: string;
  mcpTemporalUrl: string;
} {
  const projectKey = process.env.SONARQUBE_PROJECT_KEY;
  if (!projectKey) {
    throw ApplicationFailure.nonRetryable('SONARQUBE_PROJECT_KEY is not set', 'MissingConfigError');
  }
  return {
    projectKey,
    mcpSonarqubeUrl: process.env.MCP_SONARQUBE_INTERNAL_URL ?? 'http://mcp-sonarqube:3000/mcp', // NOSONAR
    mcpGitlabUrl:    process.env.MCP_GITLAB_INTERNAL_URL    ?? 'http://mcp-gitlab:3000/mcp',    // NOSONAR
    mcpTemporalUrl:  process.env.MCP_TEMPORAL_URL           ?? 'http://mcp-temporal:3000/mcp',  // NOSONAR
  };
}

async function sendVerifySignal(
  mcpTemporalUrl: string,
  workflowId: string,
  status: 'success' | 'failure',
  blockingCount: number,
  auditCtx: AuditContext,
): Promise<void> {
  try {
    await callMcpTool(WORKER_NAME, mcpTemporalUrl, 'temporal_send_signal', {
      workflow_id:  workflowId,
      signal_name:  'verify-and-merge-completed',
      payload: { status, blockingCount },
    }, auditCtx);
    log.info('verify-and-merge-completed signal sent', { workflowId, status, blockingCount });
  } catch (err) {
    log.warn('Failed to send verify-and-merge-completed signal', {
      workflowId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function runVerifyAndMergeAgent(input: VerifyAndMergeInput): Promise<VerifyAndMergeOutput> {
  const info = activityInfo();
  const auditCtx: AuditContext = {
    workflowId: info.workflowExecution?.workflowId ?? info.activityId,
    activityName: 'runVerifyAndMergeAgent',
  };
  const workflowId = info.workflowExecution?.workflowId ?? '';

  log.info('Verify-and-merge agent starting', { mrIid: input.mrIid, branchName: input.branchName });
  const startTime = Date.now();
  let succeeded = false;

  try {
    const { projectKey, mcpSonarqubeUrl, mcpGitlabUrl, mcpTemporalUrl } = verifyAndMergeConfig();

    const allIssues = await fetchSonarIssues(mcpSonarqubeUrl, projectKey, input.branchName, auditCtx);
    const blocking  = allIssues.filter((i) => classifyIssue(i) === 'bloquant');

    if (blocking.length > 0) {
      log.error('Blocking issues persist after fix — merge aborted', {
        mrIid:         input.mrIid,
        blockingCount: blocking.length,
        issues:        blocking.map((i) => ({ key: i.key, type: i.type, message: i.message })),
      });
      await sendVerifySignal(mcpTemporalUrl, workflowId, 'failure', blocking.length, auditCtx);
      succeeded = true;
      return { status: 'failure', blockingCount: blocking.length };
    }

    log.info('No blocking issues — proceeding with merge', { mrIid: input.mrIid });

    // Infrastructure errors here propagate as exceptions → withSuspendOnFailure will suspend
    await callMcpTool(WORKER_NAME, mcpGitlabUrl, 'gitlab_merge_mr', {
      project_id: String(input.projectId),
      mr_iid:     input.mrIid,
    }, auditCtx);

    log.info('MR merged successfully', { mrIid: input.mrIid, projectId: input.projectId });
    await sendVerifySignal(mcpTemporalUrl, workflowId, 'success', 0, auditCtx);
    succeeded = true;
    return { status: 'success', blockingCount: 0 };
  } finally {
    metricLog({
      type:        'metric',
      timestamp:   new Date().toISOString(),
      workflowId:  auditCtx.workflowId,
      stage:       'merge',
      status:      succeeded ? 'success' : 'failure',
      durationMs:  Date.now() - startTime,
    });
  }
}
