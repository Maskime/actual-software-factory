import { GitLabApiError, type ToolResult } from "../gitlab-client.js";

export function projectPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function errorResponse(err: unknown): ToolResult & { isError: true } {
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
