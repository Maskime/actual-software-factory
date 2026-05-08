import { vi, describe, it, expect, beforeEach } from "vitest";
import { GitLabApiError } from "../gitlab-client.js";
import type { GitLabClient } from "../gitlab-client.js";
import { uploadFileRaw, handleUploadFile } from "./uploads.js";

vi.mock("node:fs", () => ({
  promises: {
    readFile: vi.fn(),
  },
}));

import { promises as fs } from "node:fs";

const mockUploadResponse = {
  alt: "screenshot.png",
  url: "/uploads/abc123/screenshot.png",
  full_path: "/root/software-factory/uploads/abc123/screenshot.png",
  markdown: "![screenshot.png](/uploads/abc123/screenshot.png)",
};

function makeClient(postMultipartFn = vi.fn().mockResolvedValue(mockUploadResponse)): GitLabClient {
  return { postMultipart: postMultipartFn } as unknown as GitLabClient;
}

describe("uploadFileRaw()", () => {
  beforeEach(() => {
    vi.mocked(fs.readFile).mockClear();
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from("fake-image-data") as never);
  });

  it("reads file from disk when file_path is provided", async () => {
    const client = makeClient();
    const result = await uploadFileRaw(client, {
      project_id: "3",
      file_path: "/tmp/screenshot.png",
    });

    expect(fs.readFile).toHaveBeenCalledWith("/tmp/screenshot.png");
    expect(result.url).toBe(mockUploadResponse.url);
    expect(result.markdown).toBe(mockUploadResponse.markdown);
    expect(result.full_path).toBe(mockUploadResponse.full_path);
  });

  it("uses basename of file_path as filename", async () => {
    const mockPost = vi.fn().mockResolvedValue(mockUploadResponse);
    const client = makeClient(mockPost);
    await uploadFileRaw(client, { project_id: "3", file_path: "/some/path/myfile.jpg" });

    const [, formData] = mockPost.mock.calls[0] as [string, FormData];
    expect(formData.get("file")).toBeInstanceOf(Blob);
  });

  it("decodes base64 content when file_content_base64 + filename are provided", async () => {
    const client = makeClient();
    const base64Content = Buffer.from("hello world").toString("base64");
    const result = await uploadFileRaw(client, {
      project_id: "3",
      file_content_base64: base64Content,
      filename: "hello.txt",
    });

    expect(fs.readFile).not.toHaveBeenCalled();
    expect(result.url).toBe(mockUploadResponse.url);
  });

  it("throws when neither file_path nor file_content_base64 is provided", async () => {
    const client = makeClient();
    await expect(uploadFileRaw(client, { project_id: "3" })).rejects.toThrow(
      "Either file_path or file_content_base64 must be provided"
    );
  });

  it("throws when both file_path and file_content_base64 are provided", async () => {
    const client = makeClient();
    await expect(
      uploadFileRaw(client, {
        project_id: "3",
        file_path: "/tmp/file.png",
        file_content_base64: "abc",
      })
    ).rejects.toThrow("Provide either file_path or file_content_base64, not both");
  });

  it("throws when file_content_base64 is provided without filename", async () => {
    const client = makeClient();
    await expect(
      uploadFileRaw(client, { project_id: "3", file_content_base64: "abc" })
    ).rejects.toThrow("filename is required when file_content_base64 is provided");
  });

  it("calls the correct GitLab API endpoint", async () => {
    const mockPost = vi.fn().mockResolvedValue(mockUploadResponse);
    const client = makeClient(mockPost);
    await uploadFileRaw(client, { project_id: "3", file_path: "/tmp/f.png" });

    expect(mockPost.mock.calls[0][0]).toBe("/projects/3/uploads");
  });
});

describe("handleUploadFile()", () => {
  beforeEach(() => {
    vi.mocked(fs.readFile).mockClear();
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from("data") as never);
  });

  it("returns url, markdown and full_path on success", async () => {
    const client = makeClient();
    const result = await handleUploadFile(client, {
      project_id: "3",
      file_path: "/tmp/screenshot.png",
    });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.url).toBe(mockUploadResponse.url);
    expect(parsed.markdown).toBe(mockUploadResponse.markdown);
    expect(parsed.full_path).toBe(mockUploadResponse.full_path);
  });

  it("returns errorResponse on API error", async () => {
    const client = makeClient(
      vi.fn().mockRejectedValue(new GitLabApiError("forbidden", 403, "GITLAB_AUTH_ERROR"))
    );
    const result = await handleUploadFile(client, {
      project_id: "3",
      file_path: "/tmp/f.png",
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe("GITLAB_AUTH_ERROR");
  });

  it("returns errorResponse when validation fails (no source provided)", async () => {
    const client = makeClient();
    const result = await handleUploadFile(client, { project_id: "3" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Either file_path");
  });
});
