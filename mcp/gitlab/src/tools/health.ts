import { z } from "zod";
import { type GitLabClient, type ToolResult } from "../gitlab-client.js";

export const checkAuthSchema = z.object({});

export async function handleCheckAuth(client: GitLabClient): Promise<ToolResult> {
  try {
    const user = await client.validateAuth();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ authenticated: true, user }),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: message }],
      isError: true,
    };
  }
}
