import { z } from "zod";
import { type GitLabClient, type ToolResult } from "../gitlab-client.js";
import { projectPath, errorResponse } from "./utils.js";

interface GitLabProject {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  namespace: { id: number; name: string; path: string; kind: string };
  description: string | null;
  visibility: string;
  web_url: string;
  http_url_to_repo: string;
  default_branch: string | null;
  created_at: string;
}

// gitlab_list_projects

export const listProjectsSchema = z.object({
  membership: z
    .boolean()
    .optional()
    .describe("If true, return only projects the current user is a member of"),
  search: z
    .string()
    .optional()
    .describe("Filter projects by name or path (case-insensitive substring match)"),
  visibility: z
    .enum(["public", "internal", "private"])
    .optional()
    .describe("Filter by visibility level"),
  page: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Page number for pagination (default: 1)"),
});

export async function handleListProjects(
  client: GitLabClient,
  params: z.infer<typeof listProjectsSchema>
): Promise<ToolResult> {
  try {
    const queryParams: Record<string, unknown> = { per_page: 100 };
    if (params.membership !== undefined) queryParams.membership = params.membership;
    if (params.search !== undefined) queryParams.search = params.search;
    if (params.visibility !== undefined) queryParams.visibility = params.visibility;
    if (params.page !== undefined) queryParams.page = params.page;

    const projects = await client.get<GitLabProject[]>("/projects", queryParams);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            projects.map((p) => ({
              id: p.id,
              name: p.name,
              path_with_namespace: p.path_with_namespace,
              visibility: p.visibility,
              web_url: p.web_url,
              default_branch: p.default_branch,
            }))
          ),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_get_project

export const getProjectSchema = z.object({
  project_id: z
    .string()
    .describe("Project ID (numeric) or URL-encoded namespace/path (e.g. 'root/my-project')"),
});

export async function handleGetProject(
  client: GitLabClient,
  params: z.infer<typeof getProjectSchema>
): Promise<ToolResult> {
  try {
    const project = await client.get<GitLabProject>(projectPath(params.project_id));
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            id: project.id,
            name: project.name,
            path_with_namespace: project.path_with_namespace,
            namespace: project.namespace,
            description: project.description,
            visibility: project.visibility,
            web_url: project.web_url,
            http_url_to_repo: project.http_url_to_repo,
            default_branch: project.default_branch,
            created_at: project.created_at,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_create_project

export const createProjectSchema = z.object({
  name: z.string().min(1).describe("Project name"),
  namespace_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Numeric ID of the target namespace or group (defaults to the current user's namespace)"),
  visibility: z
    .enum(["public", "internal", "private"])
    .optional()
    .describe("Visibility level of the project (default: private)"),
  description: z.string().optional().describe("Project description"),
});

export async function handleCreateProject(
  client: GitLabClient,
  params: z.infer<typeof createProjectSchema>
): Promise<ToolResult> {
  try {
    const body: Record<string, unknown> = { name: params.name };
    if (params.namespace_id !== undefined) body.namespace_id = params.namespace_id;
    if (params.visibility !== undefined) body.visibility = params.visibility;
    if (params.description !== undefined) body.description = params.description;

    const project = await client.post<GitLabProject>("/projects", body);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            id: project.id,
            name: project.name,
            path_with_namespace: project.path_with_namespace,
            web_url: project.web_url,
            http_url_to_repo: project.http_url_to_repo,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}
