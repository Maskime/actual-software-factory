import { z } from "zod";
import { type GitLabClient, type ToolResult } from "../gitlab-client.js";
import { projectPath, errorResponse } from "./utils.js";

interface GitLabIssue {
  id: number;
  iid: number;
  title: string;
  web_url: string;
}

export const createEpicSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  title: z.string().min(1).describe("Epic title (will be prefixed with [EPIC])"),
  description: z.string().optional().describe("Epic description (Markdown)"),
  labels: z
    .string()
    .optional()
    .default("qualification-interface")
    .describe("Comma-separated label names (default: qualification-interface)"),
});

export async function handleCreateEpic(
  client: GitLabClient,
  params: z.infer<typeof createEpicSchema>
): Promise<ToolResult> {
  try {
    const body: Record<string, unknown> = {
      title: `[EPIC] ${params.title}`,
      labels: params.labels ?? "qualification-interface",
    };
    if (params.description !== undefined) body.description = params.description;

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
            title: issue.title,
            web_url: issue.web_url,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}
