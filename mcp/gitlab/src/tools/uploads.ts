import { promises as fs } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import { type GitLabClient, type ToolResult } from "../gitlab-client.js";
import { projectPath, errorResponse } from "./utils.js";

interface GitLabUploadResponse {
  alt: string;
  url: string;
  full_path: string;
  markdown: string;
}

export const uploadFileSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  file_path: z.string().optional().describe("Local path to the file to upload"),
  file_content_base64: z
    .string()
    .optional()
    .describe("File content encoded in base64"),
  filename: z
    .string()
    .optional()
    .describe("File name (required when file_content_base64 is provided)"),
});

export async function uploadFileRaw(
  client: GitLabClient,
  params: {
    project_id: string;
    file_path?: string;
    file_content_base64?: string;
    filename?: string;
  }
): Promise<{ url: string; markdown: string; full_path: string }> {
  const hasPath = params.file_path !== undefined;
  const hasBase64 = params.file_content_base64 !== undefined;

  if (!hasPath && !hasBase64) {
    throw new Error("Either file_path or file_content_base64 must be provided");
  }
  if (hasPath && hasBase64) {
    throw new Error("Provide either file_path or file_content_base64, not both");
  }
  if (hasBase64 && !params.filename) {
    throw new Error("filename is required when file_content_base64 is provided");
  }

  let buffer: Buffer;
  let filename: string;

  if (hasPath) {
    buffer = await fs.readFile(params.file_path as string);
    filename = params.filename ?? basename(params.file_path as string);
  } else {
    buffer = Buffer.from(params.file_content_base64 as string, "base64");
    filename = params.filename as string;
  }

  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(buffer)]), filename);

  const result = await client.postMultipart<GitLabUploadResponse>(
    `${projectPath(params.project_id)}/uploads`,
    formData
  );

  return { url: result.url, markdown: result.markdown, full_path: result.full_path };
}

export async function handleUploadFile(
  client: GitLabClient,
  params: z.infer<typeof uploadFileSchema>
): Promise<ToolResult> {
  try {
    const result = await uploadFileRaw(client, params);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}
