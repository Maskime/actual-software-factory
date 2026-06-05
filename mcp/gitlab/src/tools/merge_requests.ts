import { z } from "zod";
import { type GitLabClient, type ToolResult, GitLabApiError } from "../gitlab-client.js";
import { projectPath, errorResponse } from "./utils.js";

interface GitLabMR {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: "opened" | "closed" | "merged" | "locked";
  source_branch: string;
  target_branch: string;
  labels: string[];
  changes_count: string | null;
  merge_status: string;
  detailed_merge_status: string;
  web_url: string;
  diff_refs: {
    base_sha: string;
    head_sha: string;
    start_sha: string;
  } | null;
  merge_commit_sha: string | null;
}

interface GitLabNotePosition {
  new_path?: string;
  old_path?: string;
  new_line?: number | null;
  old_line?: number | null;
}

interface GitLabNote {
  id: number;
  body: string;
  system: boolean;
  created_at: string;
  author: { id: number; username: string; name: string };
  position?: GitLabNotePosition | null;
}

interface GitLabChanges {
  changes: Array<{
    old_path: string;
    new_path: string;
    diff: string;
    new_file: boolean;
    renamed_file: boolean;
    deleted_file: boolean;
  }>;
}

interface GitLabDiscussion {
  id: string;
  notes: Array<{ id: number; body: string }>;
}

// gitlab_create_mr

export const createMrSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  source_branch: z.string().min(1).describe("Source branch name"),
  target_branch: z.string().min(1).describe("Target branch name (e.g. main)"),
  title: z.string().min(1).describe("MR title"),
  description: z.string().optional().describe("MR description (Markdown)"),
});

export async function handleCreateMr(
  client: GitLabClient,
  params: z.infer<typeof createMrSchema>
): Promise<ToolResult> {
  try {
    const body: Record<string, unknown> = {
      source_branch: params.source_branch,
      target_branch: params.target_branch,
      title: params.title,
    };
    if (params.description !== undefined) body.description = params.description;

    const mr = await client.post<GitLabMR>(
      `${projectPath(params.project_id)}/merge_requests`,
      body
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ iid: mr.iid, web_url: mr.web_url }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_get_mr

export const getMrSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  mr_iid: z
    .number()
    .int()
    .positive()
    .describe("MR IID (project-scoped integer ID)"),
});

export async function handleGetMr(
  client: GitLabClient,
  params: z.infer<typeof getMrSchema>
): Promise<ToolResult> {
  try {
    const basePath = `${projectPath(params.project_id)}/merge_requests/${params.mr_iid}`;
    const [mr, notes] = await Promise.all([
      client.get<GitLabMR>(basePath),
      client.get<GitLabNote[]>(`${basePath}/notes`, { per_page: 100, sort: "asc" }),
    ]);

    const comments = notes
      .filter((n) => !n.system)
      .map((n) => ({
        id: n.id,
        body: n.body,
        author: n.author,
        created_at: n.created_at,
        position: n.position ?? null,
      }));

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            iid: mr.iid,
            title: mr.title,
            state: mr.state,
            labels: mr.labels,
            changes_count: mr.changes_count,
            merge_status: mr.merge_status,
            web_url: mr.web_url,
            comments,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_get_mr_diff

export const getMrDiffSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  mr_iid: z.number().int().positive().describe("MR IID"),
});

export async function handleGetMrDiff(
  client: GitLabClient,
  params: z.infer<typeof getMrDiffSchema>
): Promise<ToolResult> {
  try {
    const result = await client.get<GitLabChanges>(
      `${projectPath(params.project_id)}/merge_requests/${params.mr_iid}/changes`
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            result.changes.map((c) => ({
              old_path: c.old_path,
              new_path: c.new_path,
              diff: c.diff,
              new_file: c.new_file,
              renamed_file: c.renamed_file,
              deleted_file: c.deleted_file,
            }))
          ),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_add_mr_comment

export const addMrCommentSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  mr_iid: z.number().int().positive().describe("MR IID"),
  body: z.string().min(1).describe("Comment text (Markdown)"),
});

export async function handleAddMrComment(
  client: GitLabClient,
  params: z.infer<typeof addMrCommentSchema>
): Promise<ToolResult> {
  try {
    const note = await client.post<GitLabNote>(
      `${projectPath(params.project_id)}/merge_requests/${params.mr_iid}/notes`,
      { body: params.body }
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            id: note.id,
            body: note.body,
            author: note.author,
            created_at: note.created_at,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_add_mr_inline_comment

export const addMrInlineCommentSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  mr_iid: z.number().int().positive().describe("MR IID"),
  body: z.string().min(1).describe("Comment text (Markdown)"),
  file_path: z
    .string()
    .min(1)
    .describe(
      "Path of the file to comment on (new path for added/modified files, old path for deleted files)"
    ),
  new_line: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Line number in the new version of the file (for added or context lines)"),
  old_line: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Line number in the old version of the file (for deleted or context lines). At least one of new_line or old_line is required."
    ),
});

export async function handleAddMrInlineComment(
  client: GitLabClient,
  params: z.infer<typeof addMrInlineCommentSchema>
): Promise<ToolResult> {
  if (params.new_line === undefined && params.old_line === undefined) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: {
              code: "INVALID_PARAMS",
              message: "At least one of new_line or old_line must be provided",
            },
          }),
        },
      ],
      isError: true as const,
    };
  }

  try {
    const mr = await client.get<GitLabMR>(
      `${projectPath(params.project_id)}/merge_requests/${params.mr_iid}`
    );

    if (!mr.diff_refs) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: {
                code: "GITLAB_NO_DIFF_REFS",
                message:
                  "This MR has no commits yet and cannot receive inline comments. Add a commit to the source branch first.",
              },
            }),
          },
        ],
        isError: true as const,
      };
    }

    const { base_sha, head_sha, start_sha } = mr.diff_refs;
    const position: Record<string, unknown> = {
      position_type: "text",
      base_sha,
      head_sha,
      start_sha,
      new_path: params.file_path,
      old_path: params.file_path,
    };
    if (params.new_line !== undefined) position.new_line = params.new_line;
    if (params.old_line !== undefined) position.old_line = params.old_line;

    const discussion = await client.post<GitLabDiscussion>(
      `${projectPath(params.project_id)}/merge_requests/${params.mr_iid}/discussions`,
      { body: params.body, position }
    );

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            discussion_id: discussion.id,
            note_id: discussion.notes[0]?.id,
            body: discussion.notes[0]?.body,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_merge_mr

export const mergeMrSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  mr_iid: z.number().int().positive().describe("MR IID"),
  merge_when_pipeline_succeeds: z
    .boolean()
    .optional()
    .describe(
      "If true, schedule the merge for when the pipeline succeeds instead of merging immediately (default: false)"
    ),
});

export async function handleMergeMr(
  client: GitLabClient,
  params: z.infer<typeof mergeMrSchema>
): Promise<ToolResult> {
  try {
    const body: Record<string, unknown> = {};
    if (params.merge_when_pipeline_succeeds === true) {
      body.merge_when_pipeline_succeeds = true;
    }

    const mr = await client.put<GitLabMR>(
      `${projectPath(params.project_id)}/merge_requests/${params.mr_iid}/merge`,
      body
    );

    if (mr.state === "merged") {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              iid: mr.iid,
              state: mr.state,
              merge_commit_sha: mr.merge_commit_sha,
              web_url: mr.web_url,
            }),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            iid: mr.iid,
            queued: true,
            state: mr.state,
            web_url: mr.web_url,
          }),
        },
      ],
    };
  } catch (err) {
    if (
      err instanceof GitLabApiError &&
      (err.statusCode === 405 || err.statusCode === 406)
    ) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: {
                code: "GITLAB_MERGE_BLOCKED",
                statusCode: err.statusCode,
                message: err.message,
              },
            }),
          },
        ],
        isError: true as const,
      };
    }
    return errorResponse(err);
  }
}

// gitlab_list_mrs

export const listMrsSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  state: z
    .enum(["opened", "closed", "merged", "all"])
    .optional()
    .describe("Filter by MR state (default: opened)"),
  source_branch: z.string().optional().describe("Filter by source branch name"),
  target_branch: z.string().optional().describe("Filter by target branch name"),
  labels: z
    .string()
    .optional()
    .describe("Comma-separated list of label names to filter by"),
  page: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Page number for pagination (default: 1)"),
});

export async function handleListMrs(
  client: GitLabClient,
  params: z.infer<typeof listMrsSchema>
): Promise<ToolResult> {
  try {
    const queryParams: Record<string, unknown> = { per_page: 100 };
    if (params.state !== undefined) queryParams.state = params.state;
    if (params.source_branch !== undefined) queryParams.source_branch = params.source_branch;
    if (params.target_branch !== undefined) queryParams.target_branch = params.target_branch;
    if (params.labels !== undefined) queryParams.labels = params.labels;
    if (params.page !== undefined) queryParams.page = params.page;

    const mrs = await client.get<GitLabMR[]>(
      `${projectPath(params.project_id)}/merge_requests`,
      queryParams
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            mrs.map((mr) => ({
              iid: mr.iid,
              title: mr.title,
              state: mr.state,
              source_branch: mr.source_branch,
              target_branch: mr.target_branch,
              labels: mr.labels,
              web_url: mr.web_url,
            }))
          ),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_close_mr

export const closeMrSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  mr_iid: z.number().int().positive().describe("MR IID (project-scoped integer ID)"),
});

export async function handleCloseMr(
  client: GitLabClient,
  params: z.infer<typeof closeMrSchema>
): Promise<ToolResult> {
  try {
    const mr = await client.put<GitLabMR>(
      `${projectPath(params.project_id)}/merge_requests/${params.mr_iid}`,
      { state_event: "close" }
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ iid: mr.iid, state: mr.state, web_url: mr.web_url }),
        },
      ],
    };
  } catch (err) {
    if (err instanceof GitLabApiError && err.statusCode === 405) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: {
                code: "GITLAB_MR_NOT_OPEN",
                statusCode: err.statusCode,
                message: err.message,
              },
            }),
          },
        ],
        isError: true as const,
      };
    }
    return errorResponse(err);
  }
}
