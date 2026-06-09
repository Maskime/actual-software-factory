import { ApplicationFailure, activityInfo, log } from '@temporalio/activity';
import Anthropic from '@anthropic-ai/sdk';
import {
  callMcpTool as sharedCallMcpTool, auditLog, loadPrompt, metricLog, summarize,
  type ReviewComment, type ReviewAgentOutput, type AuditContext,
} from '@factory/worker-shared';
import {
  SUBMIT_REVIEW_TOOL,
  buildReviewAgentMessage,
} from '../prompts/review-agent.js';

export interface ReviewCodeInput {
  mrIid: number;
  projectId: number;
  issueIid: number;
  branchName: string;
}

export interface MrFileChange {
  old_path: string;
  new_path: string;
  diff: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
}

export interface MrContext {
  title: string;
  description: string;
  diff: MrFileChange[];
}

const GENERATED_FILE_PATTERNS = [
  'package-lock.json',
  'yarn.lock',
  /\.min\.js$/,
  /\.min\.css$/,
];

function classificationPrefix(c: ReviewComment['classification']): string {
  if (c === 'bloquant') return '[BLOQUANT]';
  if (c === 'modéré')   return '[MODÉRÉ]';
  return '[ESTHÉTIQUE]';
}

function isGeneratedFile(path: string): boolean {
  return GENERATED_FILE_PATTERNS.some((p) =>
    typeof p === 'string' ? path.endsWith(p) : p.test(path),
  );
}

function reviewConfig(): { mcpGitlabUrl: string; anthropicModel: string } {
  return {
    mcpGitlabUrl:   process.env.MCP_GITLAB_URL  ?? 'http://mcp-gitlab:3000/mcp', // NOSONAR
    anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
  };
}

function anthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw ApplicationFailure.nonRetryable('ANTHROPIC_API_KEY is not set', 'MissingConfigError');
  }
  return new Anthropic({ apiKey });
}

function callMcpTool(
  mcpGitlabUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  auditCtx?: AuditContext,
): Promise<string> {
  return sharedCallMcpTool('review-worker', mcpGitlabUrl, toolName, args, auditCtx);
}

async function postInlineComment(
  mcpGitlabUrl: string,
  projectId: number,
  mrIid: number,
  comment: ReviewComment & { line: number },
  auditCtx?: AuditContext,
): Promise<void> {
  const body = `${classificationPrefix(comment.classification)} ${comment.description}`;
  try {
    await callMcpTool(mcpGitlabUrl, 'gitlab_add_mr_inline_comment', {
      project_id: String(projectId),
      mr_iid: mrIid,
      body,
      file_path: comment.file,
      new_line: comment.line,
    }, auditCtx);
  } catch (error) {
    log.warn('Failed to post inline comment', { file: comment.file, line: comment.line, error });
  }
}

function buildSummaryBody(comments: ReviewComment[]): string {
  const bloquant   = comments.filter((c) => c.classification === 'bloquant').length;
  const modere     = comments.filter((c) => c.classification === 'modéré').length;
  const esthetique = comments.filter((c) => c.classification === 'esthétique').length;
  const total      = comments.length;

  const fileLevelComments = comments.filter((c) => c.line === null);

  let body = `## Synthese de la revue de code

| Classification | Nombre |
|---|---|
| [BLOQUANT] | ${bloquant} |
| [MODÉRÉ] | ${modere} |
| [ESTHÉTIQUE] | ${esthetique} |

**Total : ${total} commentaire(s)**`;

  if (fileLevelComments.length > 0) {
    body += '\n\n## Commentaires generaux';
    for (const c of fileLevelComments) {
      body += `\n\n### ${c.file}\n\n${classificationPrefix(c.classification)} ${c.description}`;
    }
  }

  return body;
}

async function postSummaryComment(
  mcpGitlabUrl: string,
  projectId: number,
  mrIid: number,
  comments: ReviewComment[],
  auditCtx?: AuditContext,
): Promise<void> {
  const body = buildSummaryBody(comments);
  await callMcpTool(mcpGitlabUrl, 'gitlab_add_mr_comment', {
    project_id: String(projectId),
    mr_iid: mrIid,
    body,
  }, auditCtx);
}

async function createBacklogIssue(
  mcpGitlabUrl: string,
  projectId: number,
  mrWebUrl: string,
  comment: ReviewComment,
  auditCtx?: AuditContext,
): Promise<number | null> {
  const fileRef = comment.line === null ? comment.file : `${comment.file}:${comment.line}`;
  const rawTitle = `[Backlog] ${fileRef} — ${comment.description}`;
  const title = rawTitle.length > 200 ? rawTitle.slice(0, 200) : rawTitle;
  const description = `${comment.description}\n\n**MR :** ${mrWebUrl}\n**Fichier :** \`${fileRef}\``;
  try {
    const raw = await callMcpTool(mcpGitlabUrl, 'gitlab_create_issue', {
      project_id: String(projectId),
      title,
      description,
      labels: 'backlog',
    }, auditCtx);
    const issue = JSON.parse(raw || '{}') as { iid?: number };
    return issue.iid ?? null;
  } catch (error) {
    log.warn('Failed to create backlog issue', { file: comment.file, line: comment.line, error });
    return null;
  }
}

async function createBacklogIssues(
  mcpGitlabUrl: string,
  projectId: number,
  mrWebUrl: string,
  comments: ReviewComment[],
  auditCtx?: AuditContext,
): Promise<number[]> {
  const moderate = comments.filter((c) => c.classification === 'modéré');
  const iids: number[] = [];
  for (const comment of moderate) {
    const iid = await createBacklogIssue(mcpGitlabUrl, projectId, mrWebUrl, comment, auditCtx);
    if (iid !== null) iids.push(iid);
  }
  return iids;
}

async function publishComments(
  mcpGitlabUrl: string,
  projectId: number,
  mrIid: number,
  comments: ReviewComment[],
  auditCtx?: AuditContext,
): Promise<void> {
  for (const comment of comments) {
    if (comment.line !== null) {
      await postInlineComment(mcpGitlabUrl, projectId, mrIid, comment as ReviewComment & { line: number }, auditCtx);
    }
  }
  await postSummaryComment(mcpGitlabUrl, projectId, mrIid, comments, auditCtx);
}

async function readMrDiff(
  mcpGitlabUrl: string,
  projectId: number,
  mrIid: number,
  auditCtx?: AuditContext,
): Promise<MrFileChange[]> {
  const text = await callMcpTool(mcpGitlabUrl, 'gitlab_get_mr_diff', {
    project_id: String(projectId),
    mr_iid: mrIid,
  }, auditCtx);
  return JSON.parse(text || '[]') as MrFileChange[];
}

async function readMrMetadata(
  mcpGitlabUrl: string,
  projectId: number,
  mrIid: number,
  auditCtx?: AuditContext,
): Promise<{ title: string; description: string; webUrl: string }> {
  const text = await callMcpTool(mcpGitlabUrl, 'gitlab_get_mr', {
    project_id: String(projectId),
    mr_iid: mrIid,
  }, auditCtx);
  const mr = JSON.parse(text || '{}') as { title: string; description: string; web_url?: string };
  return { title: mr.title, description: mr.description ?? '', webUrl: mr.web_url ?? '' };
}

const MAX_DIFF_LINES = 300;

function formatDiff(diff: MrFileChange[]): string {
  return diff
    .filter((f) => !isGeneratedFile(f.new_path) && !isGeneratedFile(f.old_path))
    .map((f) => {
      let label = '';
      if (f.new_file) label = ' [NEW FILE]';
      else if (f.deleted_file) label = ' [DELETED]';
      else if (f.renamed_file) label = ` [RENAMED from ${f.old_path}]`;

      const lines = f.diff.split('\n');
      const truncated = lines.length > MAX_DIFF_LINES;
      const content = truncated
        ? lines.slice(0, MAX_DIFF_LINES).join('\n') + '\n… [tronqué à 300 lignes]'
        : f.diff;

      return `### ${f.new_path}${label}\n\`\`\`diff\n${content}\n\`\`\``;
    })
    .join('\n\n');
}

async function analyzeWithClaude(
  client: Anthropic,
  model: string,
  mrContext: MrContext,
): Promise<ReviewComment[]> {
  const formattedDiff = formatDiff(mrContext.diff);

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: loadPrompt('review-code'),
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [SUBMIT_REVIEW_TOOL],
    tool_choice: { type: 'tool', name: 'submit_review' },
    messages: [
      {
        role: 'user',
        content: buildReviewAgentMessage(mrContext.title, mrContext.description, formattedDiff),
      },
    ],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'submit_review',
  );
  if (!toolUse) {
    log.warn('Claude did not call submit_review — returning empty review');
    return [];
  }

  const input = toolUse.input as { comments: ReviewComment[] };
  return Array.isArray(input.comments) ? input.comments : [];
}

export async function reviewCode(input: ReviewCodeInput): Promise<ReviewAgentOutput> {
  const info = activityInfo();
  const auditCtx: AuditContext = {
    workflowId: info.workflowExecution?.workflowId ?? info.activityId,
    activityName: 'reviewCode',
  };

  const startTime = Date.now();

  try {
  log.info('Review agent starting', {
    mrIid: input.mrIid,
    projectId: input.projectId,
    issueIid: input.issueIid,
    branchName: input.branchName,
  });

  const { mcpGitlabUrl, anthropicModel } = reviewConfig();

  const [diff, metadata] = await Promise.all([
    readMrDiff(mcpGitlabUrl, input.projectId, input.mrIid, auditCtx),
    readMrMetadata(mcpGitlabUrl, input.projectId, input.mrIid, auditCtx),
  ]);

  if (diff.length === 0) {
    throw ApplicationFailure.nonRetryable(
      `MR !${input.mrIid} has an empty diff — nothing to review`,
      'EmptyDiffError',
    );
  }

  log.info('MR data loaded', {
    mrTitle: metadata.title,
    filesChanged: diff.length,
    linkedIssueIid: input.issueIid,
  });

  const client = anthropicClient();
  const mrContext: MrContext = { title: metadata.title, description: metadata.description, diff };

  auditLog({
    timestamp: new Date().toISOString(),
    workflowId: auditCtx.workflowId,
    activityName: auditCtx.activityName,
    agent: 'review-worker',
    eventType: 'llm_call',
    tool: 'claude/messages.create',
    inputSummary: summarize(`${mrContext.title} — ${diff.length} file(s)`),
    outputSummary: '',
  });
  const comments = await analyzeWithClaude(client, anthropicModel, mrContext);
  auditLog({
    timestamp: new Date().toISOString(),
    workflowId: auditCtx.workflowId,
    activityName: auditCtx.activityName,
    agent: 'review-worker',
    eventType: 'llm_call',
    tool: 'claude/messages.create',
    inputSummary: summarize(`${mrContext.title} — ${diff.length} file(s)`),
    outputSummary: summarize(`${comments.length} comment(s)`),
  });

  await publishComments(mcpGitlabUrl, input.projectId, input.mrIid, comments, auditCtx);
  const backlogIssueIids = await createBacklogIssues(mcpGitlabUrl, input.projectId, metadata.webUrl, comments, auditCtx);

  const bloquant   = comments.filter((c) => c.classification === 'bloquant').length;
  const modéré     = comments.filter((c) => c.classification === 'modéré').length;
  const esthétique = comments.filter((c) => c.classification === 'esthétique').length;

  log.info('Review completed', { mrIid: input.mrIid, total: comments.length, bloquant });

  metricLog({
    type: 'metric',
    timestamp: new Date().toISOString(),
    workflowId: auditCtx.workflowId,
    stage: 'review',
    status: 'success',
    durationMs: Date.now() - startTime,
    bloquant,
    modéré,
    esthétique,
    totalComments: comments.length,
  });
  return { comments, bloquant, modéré, esthétique, backlogIssueIids };
  } catch (err) {
    metricLog({
      type: 'metric',
      timestamp: new Date().toISOString(),
      workflowId: auditCtx.workflowId,
      stage: 'review',
      status: 'failure',
      durationMs: Date.now() - startTime,
    });
    throw err;
  }
}
