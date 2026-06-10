import { activityInfo, log } from '@temporalio/activity';
import Anthropic from '@anthropic-ai/sdk';
import { callMcpTool, createAnthropicClient, auditLog, metricLog, summarize, type AuditContext } from '@factory/worker-shared';
import { FIX_AGENT_SYSTEM, APPLY_FIX_TOOL, buildFixAgentMessage } from '../prompts/fix-agent.js';

export interface FixCodeInput {
  issueIid: number;
  projectId: number;
  mrIid: number;
  branchName: string;
}

export interface FixCodeOutput {
  fixed: number;
  skipped: number;
}

export interface BlockingFeedback {
  file: string | null;
  line: number | null;
  message: string;
}

const BLOQUANT_PREFIX = '[BLOQUANT]';
const WORKER_NAME = 'review-fix-worker';

interface MrNotePosition {
  new_path?: string;
  old_path?: string;
  new_line?: number | null;
  old_line?: number | null;
}

interface MrNote {
  id: number;
  body: string;
  position?: MrNotePosition | null;
}

interface MrResponse {
  comments: MrNote[];
}

interface MrFileChange {
  old_path: string;
  new_path: string;
  diff: string;
}

interface GitLabFileResponse {
  content: string;
}

function fixConfig(): { mcpGitlabUrl: string; mcpTemporalUrl: string; anthropicModel: string } {
  return {
    mcpGitlabUrl:   process.env.MCP_GITLAB_URL   ?? 'http://mcp-gitlab:3000/mcp',   // NOSONAR
    mcpTemporalUrl: process.env.MCP_TEMPORAL_URL  ?? 'http://mcp-temporal:3000/mcp', // NOSONAR
    anthropicModel: process.env.ANTHROPIC_MODEL  ?? 'claude-sonnet-4-6',
  };
}

async function fetchBlockingComments(
  mcpGitlabUrl: string,
  projectId: number,
  mrIid: number,
  auditCtx?: AuditContext,
): Promise<BlockingFeedback[]> {
  const text = await callMcpTool(WORKER_NAME, mcpGitlabUrl, 'gitlab_get_mr', {
    project_id: String(projectId),
    mr_iid: mrIid,
  }, auditCtx);

  const mr = JSON.parse(text || '{}') as MrResponse;
  const notes = mr.comments ?? [];

  return notes
    .filter((n) => n.body.startsWith(BLOQUANT_PREFIX))
    .map((n) => ({
      file: n.position?.new_path ?? n.position?.old_path ?? null,
      line: n.position?.new_line ?? n.position?.old_line ?? null,
      message: n.body.slice(BLOQUANT_PREFIX.length).trim(),
    }));
}

async function fetchMrDiff(
  mcpGitlabUrl: string,
  projectId: number,
  mrIid: number,
  auditCtx?: AuditContext,
): Promise<MrFileChange[]> {
  const text = await callMcpTool(WORKER_NAME, mcpGitlabUrl, 'gitlab_get_mr_diff', {
    project_id: String(projectId),
    mr_iid: mrIid,
  }, auditCtx);
  return JSON.parse(text || '[]') as MrFileChange[];
}

async function fetchFileContent(
  mcpGitlabUrl: string,
  projectId: number,
  branch: string,
  filePath: string,
  auditCtx?: AuditContext,
): Promise<string> {
  const text = await callMcpTool(WORKER_NAME, mcpGitlabUrl, 'gitlab_get_file', {
    project_id: String(projectId),
    file_path: filePath,
    ref: branch,
  }, auditCtx);
  const response = JSON.parse(text || '{}') as GitLabFileResponse;
  return response.content ?? '';
}

function findFileDiff(diff: MrFileChange[], filePath: string): string {
  const change = diff.find((c) => c.new_path === filePath || c.old_path === filePath);
  return change?.diff ?? '';
}

async function generateFix(
  client: Anthropic,
  model: string,
  filePath: string,
  fileContent: string,
  fileDiff: string,
  feedback: BlockingFeedback,
): Promise<string | null> {
  const lineRef = feedback.line === null ? '' : ` (line ${feedback.line})`;
  const diffSection = fileDiff
    ? `\n\n### Diff introducing this file\n\`\`\`diff\n${fileDiff}\n\`\`\``
    : '';

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: [{ type: 'text', text: FIX_AGENT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: [APPLY_FIX_TOOL],
    tool_choice: { type: 'tool', name: 'apply_fix' },
    messages: [
      {
        role: 'user',
        content: buildFixAgentMessage(filePath, fileContent, diffSection, lineRef, feedback.message),
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'apply_fix',
  );
  if (!toolUse) {
    log.warn('Claude did not call apply_fix', { file: filePath });
    return null;
  }

  const input = toolUse.input as { fixed_content: string };
  return typeof input.fixed_content === 'string' ? input.fixed_content : null;
}

async function commitFix(
  mcpGitlabUrl: string,
  projectId: number,
  branch: string,
  filePath: string,
  content: string,
  feedbackMessage: string,
  auditCtx?: AuditContext,
): Promise<void> {
  const summary = feedbackMessage.length > 72 ? feedbackMessage.slice(0, 72) : feedbackMessage;
  await callMcpTool(WORKER_NAME, mcpGitlabUrl, 'gitlab_commit_files', {
    project_id: String(projectId),
    branch,
    commit_message: `fix: [BLOQUANT] ${summary}`,
    actions: [{ action: 'update', file_path: filePath, content }],
  }, auditCtx);
}

export async function fixCode(input: FixCodeInput): Promise<FixCodeOutput> {
  const info = activityInfo();
  const auditCtx: AuditContext = {
    workflowId: info.workflowExecution?.workflowId ?? info.activityId,
    activityName: 'fixCode',
  };

  const startTime = Date.now();
  let fixSucceeded = false;
  let metricFixed = 0;
  let metricSkipped = 0;

  try {
  log.info('Fix-review agent starting', { mrIid: input.mrIid, projectId: input.projectId });
  const { mcpGitlabUrl, mcpTemporalUrl, anthropicModel } = fixConfig();

  const feedbacks = await fetchBlockingComments(mcpGitlabUrl, input.projectId, input.mrIid, auditCtx);
  log.info('Blocking comments fetched', { count: feedbacks.length, mrIid: input.mrIid });

  if (feedbacks.length === 0) {
    fixSucceeded = true;
    return { fixed: 0, skipped: 0 };
  }

  const diff = await fetchMrDiff(mcpGitlabUrl, input.projectId, input.mrIid, auditCtx);
  const client = createAnthropicClient();
  let fixed = 0;
  let skipped = 0;

  for (const feedback of feedbacks) {
    if (!feedback.file) {
      log.warn('Skipping file-level comment (no target file)', { message: feedback.message });
      skipped++;
      continue;
    }

    const fileContent  = await fetchFileContent(mcpGitlabUrl, input.projectId, input.branchName, feedback.file, auditCtx);
    const fileDiff     = findFileDiff(diff, feedback.file);

    auditLog({
      timestamp: new Date().toISOString(),
      workflowId: auditCtx.workflowId,
      activityName: auditCtx.activityName,
      agent: WORKER_NAME,
      eventType: 'llm_call',
      tool: 'claude/messages.create',
      inputSummary: summarize(`fix ${feedback.file}: ${feedback.message}`),
      outputSummary: '',
    });
    const fixedContent = await generateFix(client, anthropicModel, feedback.file, fileContent, fileDiff, feedback);
    auditLog({
      timestamp: new Date().toISOString(),
      workflowId: auditCtx.workflowId,
      activityName: auditCtx.activityName,
      agent: WORKER_NAME,
      eventType: 'llm_call',
      tool: 'claude/messages.create',
      inputSummary: summarize(`fix ${feedback.file}: ${feedback.message}`),
      outputSummary: fixedContent ? summarize(`fixed ${feedback.file}`) : 'no fix produced',
    });

    if (!fixedContent) {
      skipped++;
      continue;
    }

    await commitFix(mcpGitlabUrl, input.projectId, input.branchName, feedback.file, fixedContent, feedback.message, auditCtx);
    log.info('Fix committed', { file: feedback.file, mrIid: input.mrIid });
    fixed++;
  }

  log.info('Fix-review agent done', { fixed, skipped, mrIid: input.mrIid });

  const workflowId    = info.workflowExecution?.workflowId ?? '';
  const signalStatus: 'success' | 'partial' = skipped > 0 ? 'partial' : 'success';
  try {
    await callMcpTool(WORKER_NAME, mcpTemporalUrl, 'temporal_send_signal', {
      workflow_id:  workflowId,
      signal_name:  'review-fix-completed',
      payload: { status: signalStatus, commitCount: fixed },
    }, auditCtx);
    log.info('review-fix-completed signal sent', { workflowId, status: signalStatus, commitCount: fixed });
  } catch (signalErr) {
    log.warn('Failed to send review-fix-completed signal', {
      workflowId,
      error: signalErr instanceof Error ? signalErr.message : String(signalErr),
    });
  }

  fixSucceeded = true;
  metricFixed = fixed;
  metricSkipped = skipped;
  return { fixed, skipped };
  } finally {
    metricLog({
      type: 'metric',
      timestamp: new Date().toISOString(),
      workflowId: auditCtx.workflowId,
      stage: 'fix',
      status: fixSucceeded ? 'success' : 'failure',
      durationMs: Date.now() - startTime,
      fixed: metricFixed,
      skipped: metricSkipped,
    });
  }
}
