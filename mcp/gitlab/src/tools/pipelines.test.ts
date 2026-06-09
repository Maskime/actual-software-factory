import { vi, describe, it, expect, beforeEach } from "vitest";
import { GitLabApiError } from "../gitlab-client.js";
import type { GitLabClient } from "../gitlab-client.js";
import {
  handleListPipelines,
  handleGetPipeline,
  handleListPipelineJobs,
  handleGetJobLog,
  handleGetTestReport,
  handleRetryJob,
} from "./pipelines.js";

function makeMockClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  };
}

const basePipeline = {
  id: 101,
  iid: 1,
  ref: "main",
  sha: "abc123",
  status: "success",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:05:00Z",
  duration: 300,
  web_url: "http://gitlab/project/-/pipelines/101",
};

const baseJob = {
  id: 201,
  name: "test",
  stage: "test",
  status: "success",
  created_at: "2024-01-01T00:00:00Z",
  started_at: "2024-01-01T00:01:00Z",
  finished_at: "2024-01-01T00:02:00Z",
  duration: 60,
  web_url: "http://gitlab/project/-/jobs/201",
};

const baseTestReport = {
  total_count: 10,
  success_count: 8,
  failed_count: 1,
  error_count: 0,
  skipped_count: 1,
  total_time: 42.5,
  test_suites: [
    {
      name: "suite-a",
      total_count: 10,
      success_count: 8,
      failed_count: 1,
      error_count: 0,
      skipped_count: 1,
      total_time: 42.5,
    },
  ],
};

describe("handleListPipelines()", () => {
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    mockClient = makeMockClient();
  });

  it("returns pipeline list on success", async () => {
    mockClient.get.mockResolvedValue([basePipeline]);
    const result = await handleListPipelines(
      mockClient as unknown as GitLabClient,
      { project_id: "3" }
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(101);
    expect(parsed[0].ref).toBe("main");
    expect(parsed[0].status).toBe("success");
    expect(parsed[0].web_url).toBe("http://gitlab/project/-/pipelines/101");
  });

  it("passes ref and status filters as query params", async () => {
    mockClient.get.mockResolvedValue([]);
    await handleListPipelines(mockClient as unknown as GitLabClient, {
      project_id: "3",
      ref: "feature/52",
      status: "failed",
    });
    const params = mockClient.get.mock.calls[0][1];
    expect(params.ref).toBe("feature/52");
    expect(params.status).toBe("failed");
    expect(params.per_page).toBe(100);
  });

  it("passes page param when provided", async () => {
    mockClient.get.mockResolvedValue([]);
    await handleListPipelines(mockClient as unknown as GitLabClient, {
      project_id: "3",
      page: 2,
    });
    const params = mockClient.get.mock.calls[0][1];
    expect(params.page).toBe(2);
  });

  it("returns errorResponse on API error", async () => {
    mockClient.get.mockRejectedValue(
      new GitLabApiError("not found", 404, "GITLAB_NOT_FOUND")
    );
    const result = await handleListPipelines(
      mockClient as unknown as GitLabClient,
      { project_id: "999" }
    );
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe("GITLAB_NOT_FOUND");
  });
});

describe("handleGetPipeline()", () => {
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    mockClient = makeMockClient();
  });

  it("returns pipeline detail on success", async () => {
    mockClient.get.mockResolvedValue(basePipeline);
    const result = await handleGetPipeline(
      mockClient as unknown as GitLabClient,
      { project_id: "3", pipeline_id: 101 }
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe(101);
    expect(parsed.iid).toBe(1);
    expect(parsed.duration).toBe(300);
    expect(parsed.sha).toBe("abc123");
  });

  it("returns errorResponse on API error", async () => {
    mockClient.get.mockRejectedValue(
      new GitLabApiError("not found", 404, "GITLAB_NOT_FOUND")
    );
    const result = await handleGetPipeline(
      mockClient as unknown as GitLabClient,
      { project_id: "3", pipeline_id: 999 }
    );
    expect(result.isError).toBe(true);
  });
});

describe("handleListPipelineJobs()", () => {
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    mockClient = makeMockClient();
  });

  it("returns job list on success", async () => {
    mockClient.get.mockResolvedValue([baseJob]);
    const result = await handleListPipelineJobs(
      mockClient as unknown as GitLabClient,
      { project_id: "3", pipeline_id: 101 }
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(201);
    expect(parsed[0].name).toBe("test");
    expect(parsed[0].stage).toBe("test");
    expect(parsed[0].status).toBe("success");
    expect(parsed[0].duration).toBe(60);
  });

  it("calls the correct API path", async () => {
    mockClient.get.mockResolvedValue([]);
    await handleListPipelineJobs(mockClient as unknown as GitLabClient, {
      project_id: "3",
      pipeline_id: 101,
    });
    expect(mockClient.get.mock.calls[0][0]).toContain("/pipelines/101/jobs");
  });

  it("returns errorResponse on API error", async () => {
    mockClient.get.mockRejectedValue(
      new GitLabApiError("not found", 404, "GITLAB_NOT_FOUND")
    );
    const result = await handleListPipelineJobs(
      mockClient as unknown as GitLabClient,
      { project_id: "3", pipeline_id: 999 }
    );
    expect(result.isError).toBe(true);
  });
});

describe("handleGetJobLog()", () => {
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    mockClient = makeMockClient();
  });

  it("returns full log when under max_bytes", async () => {
    const logText = "Running tests...\nAll passed.";
    mockClient.get.mockResolvedValue(logText);
    const result = await handleGetJobLog(
      mockClient as unknown as GitLabClient,
      { project_id: "3", job_id: 201 }
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.log).toBe(logText);
    expect(parsed.truncated).toBe(false);
    expect(parsed.total_bytes).toBe(Buffer.byteLength(logText, "utf8"));
  });

  it("truncates log when over max_bytes", async () => {
    const logText = "a".repeat(1000);
    mockClient.get.mockResolvedValue(logText);
    const result = await handleGetJobLog(
      mockClient as unknown as GitLabClient,
      { project_id: "3", job_id: 201, max_bytes: 100 }
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.log).toHaveLength(100);
    expect(parsed.truncated).toBe(true);
    expect(parsed.total_bytes).toBe(1000);
  });

  it("uses default max_bytes of 50000", async () => {
    const logText = "x".repeat(60_000);
    mockClient.get.mockResolvedValue(logText);
    const result = await handleGetJobLog(
      mockClient as unknown as GitLabClient,
      { project_id: "3", job_id: 201 }
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.log).toHaveLength(50_000);
    expect(parsed.truncated).toBe(true);
  });

  it("returns errorResponse on API error", async () => {
    mockClient.get.mockRejectedValue(
      new GitLabApiError("not found", 404, "GITLAB_NOT_FOUND")
    );
    const result = await handleGetJobLog(
      mockClient as unknown as GitLabClient,
      { project_id: "3", job_id: 999 }
    );
    expect(result.isError).toBe(true);
  });
});

describe("handleGetTestReport()", () => {
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    mockClient = makeMockClient();
  });

  it("returns test report on success", async () => {
    mockClient.get.mockResolvedValue(baseTestReport);
    const result = await handleGetTestReport(
      mockClient as unknown as GitLabClient,
      { project_id: "3", pipeline_id: 101 }
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total_count).toBe(10);
    expect(parsed.success_count).toBe(8);
    expect(parsed.failed_count).toBe(1);
    expect(parsed.skipped_count).toBe(1);
    expect(parsed.total_time).toBe(42.5);
  });

  it("includes test_suites in response", async () => {
    mockClient.get.mockResolvedValue(baseTestReport);
    const result = await handleGetTestReport(
      mockClient as unknown as GitLabClient,
      { project_id: "3", pipeline_id: 101 }
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.test_suites).toHaveLength(1);
    expect(parsed.test_suites[0].name).toBe("suite-a");
    expect(parsed.test_suites[0].failed_count).toBe(1);
  });

  it("returns errorResponse when pipeline has no test report (404)", async () => {
    mockClient.get.mockRejectedValue(
      new GitLabApiError("not found", 404, "GITLAB_NOT_FOUND")
    );
    const result = await handleGetTestReport(
      mockClient as unknown as GitLabClient,
      { project_id: "3", pipeline_id: 101 }
    );
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.statusCode).toBe(404);
  });

  it("calls the correct API path", async () => {
    mockClient.get.mockResolvedValue(baseTestReport);
    await handleGetTestReport(mockClient as unknown as GitLabClient, {
      project_id: "3",
      pipeline_id: 101,
    });
    expect(mockClient.get.mock.calls[0][0]).toContain("/pipelines/101/test_report");
  });
});

describe("handleRetryJob()", () => {
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    mockClient = makeMockClient();
  });

  const retryJobResponse = {
    id: 202,
    status: "pending",
    name: "test",
    web_url: "http://gitlab/project/-/jobs/202",
  };

  it("returns retried job info on success", async () => {
    mockClient.post.mockResolvedValue(retryJobResponse);
    const result = await handleRetryJob(
      mockClient as unknown as GitLabClient,
      { project_id: "3", job_id: 201 }
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe(202);
    expect(parsed.status).toBe("pending");
    expect(parsed.name).toBe("test");
    expect(parsed.web_url).toBe("http://gitlab/project/-/jobs/202");
  });

  it("calls the correct API path", async () => {
    mockClient.post.mockResolvedValue(retryJobResponse);
    await handleRetryJob(mockClient as unknown as GitLabClient, {
      project_id: "3",
      job_id: 201,
    });
    expect(mockClient.post.mock.calls[0][0]).toContain("/jobs/201/retry");
  });

  it("returns errorResponse when job is not found (404)", async () => {
    mockClient.post.mockRejectedValue(
      new GitLabApiError("not found", 404, "GITLAB_NOT_FOUND")
    );
    const result = await handleRetryJob(
      mockClient as unknown as GitLabClient,
      { project_id: "3", job_id: 999 }
    );
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.code).toBe("GITLAB_NOT_FOUND");
  });

  it("returns errorResponse when job is not retryable (403)", async () => {
    mockClient.post.mockRejectedValue(
      new GitLabApiError("forbidden", 403, "GITLAB_AUTH_ERROR")
    );
    const result = await handleRetryJob(
      mockClient as unknown as GitLabClient,
      { project_id: "3", job_id: 201 }
    );
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error.statusCode).toBe(403);
  });
});
