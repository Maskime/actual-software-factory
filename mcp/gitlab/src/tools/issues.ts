import { z } from "zod";
import { type GitLabClient, type ToolResult } from "../gitlab-client.js";
import { projectPath, errorResponse } from "./utils.js";
import { uploadFileRaw } from "./uploads.js";

interface GitLabIssue {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: "opened" | "closed";
  labels: string[];
  assignees: Array<{ id: number; username: string; name: string }>;
  web_url: string;
}

// gitlab_get_issue

export const getIssueSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  issue_iid: z.number().int().positive().describe("Issue IID (project-scoped integer ID)"),
});

export async function handleGetIssue(
  client: GitLabClient,
  params: z.infer<typeof getIssueSchema>
): Promise<ToolResult> {
  try {
    const issue = await client.get<GitLabIssue>(
      `${projectPath(params.project_id)}/issues/${params.issue_iid}`
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            iid: issue.iid,
            title: issue.title,
            description: issue.description,
            labels: issue.labels,
            assignees: issue.assignees,
            state: issue.state,
            web_url: issue.web_url,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_list_issues

export const listIssuesSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  state: z
    .enum(["opened", "closed", "all"])
    .optional()
    .describe("Filter by issue state (default: opened)"),
  labels: z
    .string()
    .optional()
    .describe("Comma-separated list of label names to filter by"),
  assignee_username: z
    .string()
    .optional()
    .describe("Filter issues assigned to this username"),
  page: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Page number for pagination (default: 1)"),
});

export async function handleListIssues(
  client: GitLabClient,
  params: z.infer<typeof listIssuesSchema>
): Promise<ToolResult> {
  try {
    const queryParams: Record<string, unknown> = { per_page: 100 };
    if (params.state !== undefined) queryParams.state = params.state;
    if (params.labels !== undefined) queryParams.labels = params.labels;
    if (params.assignee_username !== undefined)
      queryParams.assignee_username = params.assignee_username;
    if (params.page !== undefined) queryParams.page = params.page;

    const issues = await client.get<GitLabIssue[]>(
      `${projectPath(params.project_id)}/issues`,
      queryParams
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            issues.map((i) => ({
              iid: i.iid,
              title: i.title,
              description: i.description,
              labels: i.labels,
              assignees: i.assignees,
              state: i.state,
              web_url: i.web_url,
            }))
          ),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_create_issue

export const createIssueSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  title: z.string().min(1).describe("Issue title"),
  description: z.string().optional().describe("Issue description (Markdown)"),
  labels: z
    .string()
    .optional()
    .describe("Comma-separated list of label names to apply"),
  attachments: z
    .array(z.string())
    .optional()
    .describe(
      "Local file paths to attach (uploaded via GitLab and appended to the description as Markdown)"
    ),
});

export async function handleCreateIssue(
  client: GitLabClient,
  params: z.infer<typeof createIssueSchema>
): Promise<ToolResult> {
  try {
    let description = params.description;

    if (params.attachments && params.attachments.length > 0) {
      const snippets = await Promise.all(
        params.attachments.map((file_path) =>
          uploadFileRaw(client, { project_id: params.project_id, file_path })
        )
      );
      const attachmentMarkdown = snippets.map((s) => s.markdown).join("\n");
      description = description
        ? `${description}\n\n${attachmentMarkdown}`
        : attachmentMarkdown;
    }

    const body: Record<string, unknown> = { title: params.title };
    if (description !== undefined) body.description = description;
    if (params.labels !== undefined) body.labels = params.labels;

    const issue = await client.post<GitLabIssue>(
      `${projectPath(params.project_id)}/issues`,
      body
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            iid: issue.iid,
            id: issue.id,
            web_url: issue.web_url,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_update_issue

export const updateIssueSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  issue_iid: z.number().int().positive().describe("Issue IID to update"),
  title: z.string().optional().describe("New title"),
  description: z.string().optional().describe("New description (Markdown)"),
  labels: z
    .string()
    .optional()
    .describe("Comma-separated list of labels (replaces existing labels)"),
  state_event: z
    .enum(["close", "reopen"])
    .optional()
    .describe("Transition the issue state: close or reopen"),
});

export async function handleUpdateIssue(
  client: GitLabClient,
  params: z.infer<typeof updateIssueSchema>
): Promise<ToolResult> {
  try {
    const body: Record<string, unknown> = {};
    if (params.title !== undefined) body.title = params.title;
    if (params.description !== undefined) body.description = params.description;
    if (params.labels !== undefined) body.labels = params.labels;
    if (params.state_event !== undefined) body.state_event = params.state_event;

    const issue = await client.put<GitLabIssue>(
      `${projectPath(params.project_id)}/issues/${params.issue_iid}`,
      body
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            iid: issue.iid,
            title: issue.title,
            description: issue.description,
            labels: issue.labels,
            assignees: issue.assignees,
            state: issue.state,
            web_url: issue.web_url,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_close_issue

export const closeIssueSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  issue_iid: z.number().int().positive().describe("Issue IID to close"),
});

export async function handleCloseIssue(
  client: GitLabClient,
  params: z.infer<typeof closeIssueSchema>
): Promise<ToolResult> {
  try {
    const issue = await client.put<GitLabIssue>(
      `${projectPath(params.project_id)}/issues/${params.issue_iid}`,
      { state_event: "close" }
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            closed: issue.state === "closed",
            state: issue.state,
            iid: issue.iid,
            web_url: issue.web_url,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_get_issue_comments

interface GitLabNote {
  id: number;
  body: string;
  author: { id: number; username: string; name: string };
  created_at: string;
  system: boolean;
}

export const getIssueCommentsSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  issue_iid: z.number().int().positive().describe("Issue IID (project-scoped integer ID)"),
  include_system_notes: z.boolean().optional()
    .describe("Include system-generated notes (default: false)"),
});

export async function handleGetIssueComments(
  client: GitLabClient,
  params: z.infer<typeof getIssueCommentsSchema>
): Promise<ToolResult> {
  try {
    const notes = await client.get<GitLabNote[]>(
      `${projectPath(params.project_id)}/issues/${params.issue_iid}/notes`,
      { per_page: 100, sort: "asc" }
    );
    const filtered = params.include_system_notes
      ? notes
      : notes.filter((n) => !n.system);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(
          filtered.map((n) => ({
            id: n.id,
            author: n.author.username,
            body: n.body,
            created_at: n.created_at,
          }))
        ),
      }],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_get_issue_links

interface GitLabLinkedIssue {
  iid: number;
  title: string;
  state: "opened" | "closed";
  web_url: string;
  link_type: "relates_to" | "blocks" | "is_blocked_by";
  issue_link_id: number;
}

export const getIssueLinksSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  issue_iid: z.number().int().positive().describe("Issue IID to get links for"),
});

export async function handleGetIssueLinks(
  client: GitLabClient,
  params: z.infer<typeof getIssueLinksSchema>
): Promise<ToolResult> {
  try {
    const links = await client.get<GitLabLinkedIssue[]>(
      `${projectPath(params.project_id)}/issues/${params.issue_iid}/links`
    );
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(
          links.map((l) => ({
            source_iid: params.issue_iid,
            target_iid: l.iid,
            link_type: l.link_type,
            title: l.title,
            state: l.state,
            web_url: l.web_url,
          }))
        ),
      }],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_create_issue_link

interface GitLabIssueLink {
  source_issue: { iid: number; web_url: string };
  target_issue: { iid: number; web_url: string };
  link_type: string;
}

export const createIssueLinkSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  issue_iid: z.number().int().positive().describe("Source issue IID"),
  target_project_id: z.string().describe("Target project ID (can be same as project_id)"),
  target_issue_iid: z.number().int().positive().describe("Target issue IID to link to"),
  link_type: z
    .enum(["relates_to", "blocks", "is_blocked_by"])
    .optional()
    .describe("Link type (default: relates_to)"),
});

export async function handleCreateIssueLink(
  client: GitLabClient,
  params: z.infer<typeof createIssueLinkSchema>
): Promise<ToolResult> {
  try {
    const body: Record<string, unknown> = {
      target_project_id: params.target_project_id,
      target_issue_iid: params.target_issue_iid,
    };
    if (params.link_type !== undefined) body.link_type = params.link_type;

    const link = await client.post<GitLabIssueLink>(
      `${projectPath(params.project_id)}/issues/${params.issue_iid}/links`,
      body
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            source_issue_iid: link.source_issue.iid,
            target_issue_iid: link.target_issue.iid,
            link_type: link.link_type,
            source_url: link.source_issue.web_url,
            target_url: link.target_issue.web_url,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}
