import { ApplicationFailure, log } from '@temporalio/activity';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import Anthropic from '@anthropic-ai/sdk';

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

export interface ReviewComment {
  file: string;
  line: number | null;
  description: string;
  classification: 'bloquant' | 'modéré' | 'esthétique';
}

export interface ReviewAgentOutput {
  comments: ReviewComment[];
}

type McpContent = { type: string; text?: string };
type McpToolResult = { content: McpContent[]; isError?: boolean };

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

async function callMcpTool(
  mcpGitlabUrl: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const client = new Client({ name: 'review-worker', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(mcpGitlabUrl));
  await client.connect(transport);
  try {
    const result = (await client.callTool({ name: toolName, arguments: args })) as McpToolResult;
    if (result.isError) {
      const text = result.content.find((c) => c.type === 'text')?.text ?? '';
      throw ApplicationFailure.nonRetryable(`${toolName} failed: ${text}`, 'McpToolError');
    }
    return result.content.find((c) => c.type === 'text')?.text ?? '';
  } finally {
    await client.close();
  }
}

async function postInlineComment(
  mcpGitlabUrl: string,
  projectId: number,
  mrIid: number,
  comment: ReviewComment & { line: number },
): Promise<void> {
  const body = `${classificationPrefix(comment.classification)} ${comment.description}`;
  try {
    await callMcpTool(mcpGitlabUrl, 'gitlab_add_mr_inline_comment', {
      project_id: String(projectId),
      mr_iid: mrIid,
      body,
      file_path: comment.file,
      new_line: comment.line,
    });
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
): Promise<void> {
  const body = buildSummaryBody(comments);
  await callMcpTool(mcpGitlabUrl, 'gitlab_add_mr_comment', {
    project_id: String(projectId),
    mr_iid: mrIid,
    body,
  });
}

async function createBacklogIssue(
  mcpGitlabUrl: string,
  projectId: number,
  mrWebUrl: string,
  comment: ReviewComment,
): Promise<void> {
  const fileRef = comment.line !== null ? `${comment.file}:${comment.line}` : comment.file;
  const rawTitle = `[Backlog] ${fileRef} — ${comment.description}`;
  const title = rawTitle.length > 200 ? rawTitle.slice(0, 200) : rawTitle;
  const description = `${comment.description}\n\n**MR :** ${mrWebUrl}\n**Fichier :** \`${fileRef}\``;
  try {
    await callMcpTool(mcpGitlabUrl, 'gitlab_create_issue', {
      project_id: String(projectId),
      title,
      description,
      labels: 'backlog',
    });
  } catch (error) {
    log.warn('Failed to create backlog issue', { file: comment.file, line: comment.line, error });
  }
}

async function createBacklogIssues(
  mcpGitlabUrl: string,
  projectId: number,
  mrWebUrl: string,
  comments: ReviewComment[],
): Promise<void> {
  const moderate = comments.filter((c) => c.classification === 'modéré');
  for (const comment of moderate) {
    await createBacklogIssue(mcpGitlabUrl, projectId, mrWebUrl, comment);
  }
}

async function publishComments(
  mcpGitlabUrl: string,
  projectId: number,
  mrIid: number,
  comments: ReviewComment[],
): Promise<void> {
  for (const comment of comments) {
    if (comment.line !== null) {
      await postInlineComment(mcpGitlabUrl, projectId, mrIid, comment as ReviewComment & { line: number });
    }
  }
  await postSummaryComment(mcpGitlabUrl, projectId, mrIid, comments);
}

async function readMrDiff(
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

async function readMrMetadata(
  mcpGitlabUrl: string,
  projectId: number,
  mrIid: number,
): Promise<{ title: string; description: string; webUrl: string }> {
  const text = await callMcpTool(mcpGitlabUrl, 'gitlab_get_mr', {
    project_id: String(projectId),
    mr_iid: mrIid,
  });
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

const REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer. Analyze the MR diff and produce a structured review.

Classify each finding as:
- bloquant: mandatory fix before merge — correctness bugs, security vulnerabilities (OWASP Top 10), breaking changes, data loss risks
- modéré: important improvement, deferrable — code quality debt, missing error handling, minor security concerns
- esthétique: style/convention only — naming, formatting, non-functional organization. No automatic action will be taken.

Review criteria:
1. Code quality: correctness, error handling, edge cases, performance
2. Readability: naming clarity, function size, cognitive complexity
3. Security (OWASP): injection, broken auth, sensitive data exposure, XSS, CSRF, insecure deserialization, vulnerable components
4. Codebase consistency: existing patterns, naming conventions, architectural style

Only report genuine issues. Call submit_review with all findings (empty array if none).`;

const SUBMIT_REVIEW_TOOL: Anthropic.Tool = {
  name: 'submit_review',
  description: 'Submit the complete structured code review result',
  input_schema: {
    type: 'object',
    properties: {
      comments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            file:           { type: 'string', description: 'File path relative to repository root' },
            line:           { type: ['integer', 'null'], description: 'Line number in the new version, or null for file-level comments' },
            description:    { type: 'string', description: 'Description of the issue found' },
            classification: {
              type: 'string',
              enum: ['bloquant', 'modéré', 'esthétique'],
              description: 'Severity classification',
            },
          },
          required: ['file', 'line', 'description', 'classification'],
        },
      },
    },
    required: ['comments'],
  },
};

async function analyzeWithClaude(
  client: Anthropic,
  model: string,
  mrContext: MrContext,
): Promise<ReviewComment[]> {
  const formattedDiff = formatDiff(mrContext.diff);
  const descriptionSection = mrContext.description ? `\n\nDescription: ${mrContext.description}` : '';

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: REVIEW_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [SUBMIT_REVIEW_TOOL],
    tool_choice: { type: 'tool', name: 'submit_review' },
    messages: [
      {
        role: 'user',
        content: `## MR: ${mrContext.title}${descriptionSection}

## Diff

${formattedDiff}`,
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
  log.info('Review agent starting', {
    mrIid: input.mrIid,
    projectId: input.projectId,
    issueIid: input.issueIid,
    branchName: input.branchName,
  });

  const { mcpGitlabUrl, anthropicModel } = reviewConfig();

  const [diff, metadata] = await Promise.all([
    readMrDiff(mcpGitlabUrl, input.projectId, input.mrIid),
    readMrMetadata(mcpGitlabUrl, input.projectId, input.mrIid),
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
  const comments = await analyzeWithClaude(client, anthropicModel, mrContext);

  await publishComments(mcpGitlabUrl, input.projectId, input.mrIid, comments);
  await createBacklogIssues(mcpGitlabUrl, input.projectId, metadata.webUrl, comments);

  log.info('Review completed', {
    mrIid: input.mrIid,
    total: comments.length,
    bloquant: comments.filter((c) => c.classification === 'bloquant').length,
  });

  return { comments };
}
