import { z } from "zod";
import { type GitLabClient, type ToolResult, GitLabApiError } from "../gitlab-client.js";

interface GitLabBranch {
  name: string;
  commit: { id: string; short_id: string; title: string };
  protected: boolean;
}

interface GitLabCommit {
  id: string;
  short_id: string;
  title: string;
  author_name: string;
  created_at: string;
}

interface GitLabFile {
  file_name: string;
  file_path: string;
  size: number;
  encoding: string;
  content: string;
  ref: string;
}

interface GitLabTreeEntry {
  id: string;
  name: string;
  type: "blob" | "tree";
  path: string;
  mode: string;
}

export function projectPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function errorResponse(err: unknown) {
  if (err instanceof GitLabApiError) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: {
              code: err.code,
              statusCode: err.statusCode,
              message: err.message,
            },
          }),
        },
      ],
      isError: true as const,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

// gitlab_create_branch

export const createBranchSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  branch: z.string().min(1).describe("Name of the new branch to create"),
  ref: z
    .string()
    .min(1)
    .describe("Source ref to create the branch from: branch name, tag, or commit SHA"),
});

export async function handleCreateBranch(
  client: GitLabClient,
  params: z.infer<typeof createBranchSchema>
): Promise<ToolResult> {
  try {
    const branch = await client.post<GitLabBranch>(
      `${projectPath(params.project_id)}/repository/branches`,
      { branch: params.branch, ref: params.ref }
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ name: branch.name, sha: branch.commit.id }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_list_branches

export const listBranchesSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  search: z.string().optional().describe("Filter branches by name (partial match)"),
  page: z.number().int().positive().optional().describe("Page number for pagination (default: 1)"),
});

export async function handleListBranches(
  client: GitLabClient,
  params: z.infer<typeof listBranchesSchema>
): Promise<ToolResult> {
  try {
    const queryParams: Record<string, unknown> = { per_page: 100 };
    if (params.search !== undefined) queryParams.search = params.search;
    if (params.page !== undefined) queryParams.page = params.page;

    const branches = await client.get<GitLabBranch[]>(
      `${projectPath(params.project_id)}/repository/branches`,
      queryParams
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            branches.map((b) => ({
              name: b.name,
              sha: b.commit.id,
              protected: b.protected,
            }))
          ),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_commit_files

const fileActionSchema = z.object({
  action: z
    .enum(["create", "update", "delete", "move"])
    .describe(
      "Action to perform: 'create' (new file), 'update' (modify existing), 'delete' (remove), 'move' (rename/relocate)"
    ),
  file_path: z
    .string()
    .min(1)
    .describe("Destination path of the file in the repository"),
  content: z
    .string()
    .optional()
    .describe(
      "File content as plain text. Required for 'create' and 'update'. Optional for 'move' (keeps existing content if omitted)."
    ),
  previous_path: z
    .string()
    .optional()
    .describe("Original file path. Required when action is 'move'."),
});

export const commitFilesSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  branch: z.string().min(1).describe("Target branch name (must already exist)"),
  commit_message: z.string().min(1).describe("Commit message"),
  actions: z
    .array(fileActionSchema)
    .min(1)
    .describe("One or more file actions to include in the commit"),
});

export async function handleCommitFiles(
  client: GitLabClient,
  params: z.infer<typeof commitFilesSchema>
): Promise<ToolResult> {
  for (const a of params.actions) {
    if ((a.action === "create" || a.action === "update") && a.content === undefined) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: {
                code: "INVALID_PARAMS",
                message: `Action '${a.action}' on '${a.file_path}' requires a 'content' value`,
              },
            }),
          },
        ],
        isError: true as const,
      };
    }
    if (a.action === "move" && a.previous_path === undefined) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: {
                code: "INVALID_PARAMS",
                message: `Action 'move' on '${a.file_path}' requires 'previous_path'`,
              },
            }),
          },
        ],
        isError: true as const,
      };
    }
  }

  try {
    const apiActions = params.actions.map((a) => {
      const entry: Record<string, unknown> = {
        action: a.action,
        file_path: a.file_path,
      };
      if (a.content !== undefined) {
        entry.content = Buffer.from(a.content).toString("base64");
        entry.encoding = "base64";
      }
      if (a.previous_path !== undefined) {
        entry.previous_path = a.previous_path;
      }
      return entry;
    });

    const commit = await client.post<GitLabCommit>(
      `${projectPath(params.project_id)}/repository/commits`,
      {
        branch: params.branch,
        commit_message: params.commit_message,
        actions: apiActions,
      }
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            sha: commit.id,
            short_sha: commit.short_id,
            title: commit.title,
            author: commit.author_name,
            created_at: commit.created_at,
          }),
        },
      ],
    };
  } catch (err) {
    if (err instanceof GitLabApiError && err.statusCode === 400) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: {
                code: "GITLAB_COMMIT_ERROR",
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

// gitlab_get_file

export const getFileSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  file_path: z
    .string()
    .min(1)
    .describe("Path to the file within the repository (e.g. src/index.ts)"),
  ref: z
    .string()
    .min(1)
    .describe("Branch name, tag, or commit SHA to read the file from"),
});

export async function handleGetFile(
  client: GitLabClient,
  params: z.infer<typeof getFileSchema>
): Promise<ToolResult> {
  try {
    const encodedFilePath = encodeURIComponent(params.file_path);
    const file = await client.get<GitLabFile>(
      `${projectPath(params.project_id)}/repository/files/${encodedFilePath}`,
      { ref: params.ref }
    );
    const content = Buffer.from(file.content, "base64").toString("utf-8");
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            file_name: file.file_name,
            file_path: file.file_path,
            size: file.size,
            content,
            ref: file.ref,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_delete_branch

export const deleteBranchSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  branch: z.string().min(1).describe("Name of the branch to delete"),
});

export async function handleDeleteBranch(
  client: GitLabClient,
  params: z.infer<typeof deleteBranchSchema>
): Promise<ToolResult> {
  try {
    await client.delete<void>(
      `${projectPath(params.project_id)}/repository/branches/${encodeURIComponent(params.branch)}`
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ deleted: true, branch: params.branch }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_get_repository_tree

export const getRepositoryTreeSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  path: z
    .string()
    .optional()
    .describe("Directory path to list (default: repository root)"),
  ref: z
    .string()
    .optional()
    .describe(
      "Branch name, tag, or commit SHA to read the tree from (default: repository default branch)"
    ),
  recursive: z
    .boolean()
    .optional()
    .describe("Include all subdirectory contents recursively (default: false)"),
});

export async function handleGetRepositoryTree(
  client: GitLabClient,
  params: z.infer<typeof getRepositoryTreeSchema>
): Promise<ToolResult> {
  try {
    const queryParams: Record<string, unknown> = { per_page: 100 };
    if (params.path !== undefined) queryParams.path = params.path;
    if (params.ref !== undefined) queryParams.ref = params.ref;
    if (params.recursive !== undefined) queryParams.recursive = params.recursive;

    const tree = await client.get<GitLabTreeEntry[]>(
      `${projectPath(params.project_id)}/repository/tree`,
      queryParams
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            tree.map((e) => ({
              id: e.id,
              name: e.name,
              type: e.type,
              path: e.path,
              mode: e.mode,
            }))
          ),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}
