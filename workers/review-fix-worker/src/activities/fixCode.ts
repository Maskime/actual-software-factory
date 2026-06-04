import { ApplicationFailure, log } from '@temporalio/activity';
import Anthropic from '@anthropic-ai/sdk';
import { callMcpTool as sharedCallMcpTool } from '@factory/worker-shared';

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

function fixConfig(): { mcpGitlabUrl: string; anthropicModel: string } {
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

function callMcpTool(mcpGitlabUrl: string, toolName: string, args: Record<string, unknown>): Promise<string> {
  return sharedCallMcpTool('review-fix-worker', mcpGitlabUrl, toolName, args);
}

async function fetchBlockingComments(
  mcpGitlabUrl: string,
  projectId: number,
  mrIid: number,
): Promise<BlockingFeedback[]> {
  const text = await callMcpTool(mcpGitlabUrl, 'gitlab_get_mr', {
    project_id: String(projectId),
    mr_iid: mrIid,
  });

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
): Promise<MrFileChange[]> {
  const text = await callMcpTool(mcpGitlabUrl, 'gitlab_get_mr_diff', {
    project_id: String(projectId),
    mr_iid: mrIid,
  });
  return JSON.parse(text || '[]') as MrFileChange[];
}

async function fetchFileContent(
  mcpGitlabUrl: string,
  projectId: number,
  branch: string,
  filePath: string,
): Promise<string> {
  const text = await callMcpTool(mcpGitlabUrl, 'gitlab_get_file', {
    project_id: String(projectId),
    file_path: filePath,
    ref: branch,
  });
  const response = JSON.parse(text || '{}') as GitLabFileResponse;
  return response.content ?? '';
}

function findFileDiff(diff: MrFileChange[], filePath: string): string {
  const change = diff.find((c) => c.new_path === filePath || c.old_path === filePath);
  return change?.diff ?? '';
}

const FIX_SYSTEM_PROMPT = `You are a code correction agent. Given a file, the diff that introduced it, and a blocking review comment, produce a corrected version of the file that resolves exactly that issue. Make minimal, targeted changes. Call apply_fix with the complete corrected file content.`;

const APPLY_FIX_TOOL: Anthropic.Tool = {
  name: 'apply_fix',
  description: 'Submit the corrected file content',
  input_schema: {
    type: 'object',
    properties: {
      fixed_content: { type: 'string', description: 'Complete corrected file content' },
    },
    required: ['fixed_content'],
  },
};

async function generateFix(
  client: Anthropic,
  model: string,
  filePath: string,
  fileContent: string,
  fileDiff: string,
  feedback: BlockingFeedback,
): Promise<string | null> {
  const lineRef = feedback.line != null ? ` (line ${feedback.line})` : '';
  const diffSection = fileDiff
    ? `\n\n### Diff introducing this file\n\`\`\`diff\n${fileDiff}\n\`\`\``
    : '';

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: [{ type: 'text', text: FIX_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [APPLY_FIX_TOOL],
    tool_choice: { type: 'tool', name: 'apply_fix' },
    messages: [
      {
        role: 'user',
        content: `## File: ${filePath}

### Current content
\`\`\`
${fileContent}
\`\`\`${diffSection}

### Blocking review comment${lineRef}
${feedback.message}`,
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
): Promise<void> {
  const summary = feedbackMessage.length > 72 ? feedbackMessage.slice(0, 72) : feedbackMessage;
  await callMcpTool(mcpGitlabUrl, 'gitlab_commit_files', {
    project_id: String(projectId),
    branch,
    commit_message: `fix: [BLOQUANT] ${summary}`,
    actions: [{ action: 'update', file_path: filePath, content }],
  });
}

export async function fixCode(input: FixCodeInput): Promise<FixCodeOutput> {
  log.info('Fix-review agent starting', { mrIid: input.mrIid, projectId: input.projectId });
  const { mcpGitlabUrl, anthropicModel } = fixConfig();

  const feedbacks = await fetchBlockingComments(mcpGitlabUrl, input.projectId, input.mrIid);
  log.info('Blocking comments fetched', { count: feedbacks.length, mrIid: input.mrIid });

  if (feedbacks.length === 0) return { fixed: 0, skipped: 0 };

  const diff = await fetchMrDiff(mcpGitlabUrl, input.projectId, input.mrIid);
  const client = anthropicClient();
  let fixed = 0;
  let skipped = 0;

  for (const feedback of feedbacks) {
    if (!feedback.file) {
      log.warn('Skipping file-level comment (no target file)', { message: feedback.message });
      skipped++;
      continue;
    }

    const fileContent  = await fetchFileContent(mcpGitlabUrl, input.projectId, input.branchName, feedback.file);
    const fileDiff     = findFileDiff(diff, feedback.file);
    const fixedContent = await generateFix(client, anthropicModel, feedback.file, fileContent, fileDiff, feedback);

    if (!fixedContent) {
      skipped++;
      continue;
    }

    await commitFix(mcpGitlabUrl, input.projectId, input.branchName, feedback.file, fixedContent, feedback.message);
    log.info('Fix committed', { file: feedback.file, mrIid: input.mrIid });
    fixed++;
  }

  log.info('Fix-review agent done', { fixed, skipped, mrIid: input.mrIid });
  return { fixed, skipped };
}
