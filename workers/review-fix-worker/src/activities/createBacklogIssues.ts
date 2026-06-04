import { log } from '@temporalio/activity';
import { callMcpTool } from '@factory/worker-shared';

export interface CreateBacklogIssuesInput {
  projectId: number;
  mrIid: number;
}

export interface CreateBacklogIssuesOutput {
  created: number;
  skipped: number;
}

const MODERE_PREFIX = '[MODÉRÉ]';
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
  web_url?: string;
  comments: MrNote[];
}

interface GitLabIssue {
  title: string;
}

function backlogConfig(): { mcpGitlabUrl: string } {
  return {
    mcpGitlabUrl: process.env.MCP_GITLAB_URL ?? 'http://mcp-gitlab:3000/mcp', // NOSONAR
  };
}

function computeFileRef(file: string | null, line: number | null): string {
  if (file === null) return 'general';
  if (line === null) return file;
  return `${file}:${line}`;
}

function buildIssueTitle(file: string | null, line: number | null, description: string): string {
  const fileRef = computeFileRef(file, line);
  const rawTitle = `[Backlog] ${fileRef} — ${description}`;
  return rawTitle.length > 200 ? rawTitle.slice(0, 200) : rawTitle;
}

async function fetchExistingBacklogTitles(
  mcpGitlabUrl: string,
  projectId: number,
): Promise<Set<string>> {
  const titles = new Set<string>();
  let page = 1;
  while (true) {
    const text = await callMcpTool(WORKER_NAME, mcpGitlabUrl, 'gitlab_list_issues', {
      project_id: String(projectId),
      labels: 'backlog',
      page,
    });
    const issues = JSON.parse(text || '[]') as GitLabIssue[];
    if (issues.length === 0) break;
    for (const issue of issues) titles.add(issue.title);
    page++;
  }
  return titles;
}

export async function createBacklogIssues(
  input: CreateBacklogIssuesInput,
): Promise<CreateBacklogIssuesOutput> {
  log.info('Creating backlog issues for moderate feedbacks', {
    mrIid: input.mrIid,
    projectId: input.projectId,
  });

  const { mcpGitlabUrl } = backlogConfig();

  const mrText = await callMcpTool(WORKER_NAME, mcpGitlabUrl, 'gitlab_get_mr', {
    project_id: String(input.projectId),
    mr_iid: input.mrIid,
  });
  const mr = JSON.parse(mrText || '{}') as MrResponse;
  const mrWebUrl = mr.web_url ?? '';
  const moderateNotes = (mr.comments ?? []).filter((n) => n.body.startsWith(MODERE_PREFIX));

  log.info('Moderate comments found', { count: moderateNotes.length, mrIid: input.mrIid });

  if (moderateNotes.length === 0) return { created: 0, skipped: 0 };

  const existingTitles = await fetchExistingBacklogTitles(mcpGitlabUrl, input.projectId);

  let created = 0;
  let skipped = 0;

  for (const note of moderateNotes) {
    const file = note.position?.new_path ?? note.position?.old_path ?? null;
    const line = note.position?.new_line ?? note.position?.old_line ?? null;
    const description = note.body.slice(MODERE_PREFIX.length).trim();

    const fileRef = computeFileRef(file, line);
    const expectedTitle = buildIssueTitle(file, line, description);

    if (existingTitles.has(expectedTitle)) {
      log.info('Skipping duplicate backlog issue', { title: expectedTitle });
      skipped++;
      continue;
    }

    try {
      const issueDescription = `${description}\n\n**MR :** ${mrWebUrl}\n**Fichier :** \`${fileRef}\``;
      await callMcpTool(WORKER_NAME, mcpGitlabUrl, 'gitlab_create_issue', {
        project_id: String(input.projectId),
        title: expectedTitle,
        description: issueDescription,
        labels: 'backlog',
      });
      log.info('Backlog issue created', { title: expectedTitle });
      created++;
    } catch (error) {
      log.warn('Failed to create backlog issue', { title: expectedTitle, error });
      skipped++;
    }
  }

  log.info('Backlog issues creation done', { created, skipped, mrIid: input.mrIid });
  return { created, skipped };
}
