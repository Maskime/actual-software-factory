import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { handleTriggerPipeline } from "./trigger.js";
import type { TemporalClient } from "../temporal-client.js";
import type { GitLabIssueFetcher, GitLabIssueInfo } from "../gitlab-client.js";

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function makeClient(startImpl: () => unknown): TemporalClient {
  return {
    client: {
      workflow: {
        start: vi.fn().mockImplementation(startImpl),
      },
    },
  } as unknown as TemporalClient;
}

function makeFetcher(info: GitLabIssueInfo): GitLabIssueFetcher {
  return vi.fn().mockResolvedValue(info);
}

function makeFailingFetcher(message: string): GitLabIssueFetcher {
  return vi.fn().mockRejectedValue(new Error(message));
}

const cleanIssue: GitLabIssueInfo = { labels: [], state: "opened" };

describe("handleTriggerPipeline()", () => {
  beforeEach(() => {
    delete process.env.GITLAB_PROJECT_ID;
    delete process.env.TEMPORAL_TASK_QUEUE;
    delete process.env.GITLAB_API_URL;
    delete process.env.GITLAB_API_TOKEN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- existing behaviour (no fetcher injected) ---

  it("starts a workflow and returns started: true with workflowId and runId", async () => {
    const tc = makeClient(() =>
      Promise.resolve({ firstExecutionRunId: "run-abc-123" })
    );

    const result = await handleTriggerPipeline(tc, { issue_iid: 5 });
    const data = parse(result);

    expect(data.started).toBe(true);
    expect(data.workflowId).toBe("pipeline-issue-5");
    expect(data.runId).toBe("run-abc-123");
    expect("isError" in result).toBe(false);
  });

  it("passes correct args to workflow.start", async () => {
    const startMock = vi.fn().mockResolvedValue({ firstExecutionRunId: "r1" });
    const tc = { client: { workflow: { start: startMock } } } as unknown as TemporalClient;

    await handleTriggerPipeline(tc, { issue_iid: 7, project_id: 42 });

    expect(startMock).toHaveBeenCalledWith("pipelineWorkflow", {
      taskQueue: "factory-pipeline",
      workflowId: "pipeline-issue-7",
      args: [{ issueIid: 7, projectId: 42 }],
      memo: { issueIid: 7, projectId: 42 },
    });
  });

  it("uses GITLAB_PROJECT_ID env when project_id is absent", async () => {
    process.env.GITLAB_PROJECT_ID = "99";
    const startMock = vi.fn().mockResolvedValue({ firstExecutionRunId: "r2" });
    const tc = { client: { workflow: { start: startMock } } } as unknown as TemporalClient;

    await handleTriggerPipeline(tc, { issue_iid: 3 });

    expect(startMock).toHaveBeenCalledWith(
      "pipelineWorkflow",
      expect.objectContaining({ args: [{ issueIid: 3, projectId: 99 }] })
    );
  });

  it("defaults project_id to 3 when neither param nor env is set", async () => {
    const startMock = vi.fn().mockResolvedValue({ firstExecutionRunId: "r3" });
    const tc = { client: { workflow: { start: startMock } } } as unknown as TemporalClient;

    await handleTriggerPipeline(tc, { issue_iid: 1 });

    expect(startMock).toHaveBeenCalledWith(
      "pipelineWorkflow",
      expect.objectContaining({ args: [{ issueIid: 1, projectId: 3 }] })
    );
  });

  it("uses TEMPORAL_TASK_QUEUE env when set", async () => {
    process.env.TEMPORAL_TASK_QUEUE = "custom-queue";
    const startMock = vi.fn().mockResolvedValue({ firstExecutionRunId: "r4" });
    const tc = { client: { workflow: { start: startMock } } } as unknown as TemporalClient;

    await handleTriggerPipeline(tc, { issue_iid: 2 });

    expect(startMock).toHaveBeenCalledWith(
      "pipelineWorkflow",
      expect.objectContaining({ taskQueue: "custom-queue" })
    );
  });

  it("returns started: false with already_running when workflow already exists", async () => {
    const tc = makeClient(() =>
      Promise.reject(
        new WorkflowExecutionAlreadyStartedError(
          "Workflow execution already started",
          "pipeline-issue-5",
          "pipelineWorkflow"
        )
      )
    );

    const result = await handleTriggerPipeline(tc, { issue_iid: 5 });
    const data = parse(result);

    expect(data.started).toBe(false);
    expect(data.status).toBe("already_running");
    expect(data.workflowId).toBe("pipeline-issue-5");
    expect("isError" in result).toBe(false);
  });

  it("returns TEMPORAL_ERROR on generic Temporal failure", async () => {
    const tc = makeClient(() => Promise.reject(new Error("server unreachable")));

    const result = await handleTriggerPipeline(tc, { issue_iid: 8 });
    const data = parse(result);

    expect("isError" in result && result.isError).toBe(true);
    expect(data.error.code).toBe("TEMPORAL_ERROR");
    expect(data.error.message).toBe("server unreachable");
  });

  it("converts non-Error thrown values to string", async () => {
    const tc = makeClient(() => Promise.reject("raw error string"));

    const result = await handleTriggerPipeline(tc, { issue_iid: 9 });
    const data = parse(result);

    expect("isError" in result && result.isError).toBe(true);
    expect(data.error.message).toBe("raw error string");
  });

  // --- GitLab guard (fetcher injected) ---

  it("returns already_in_pipeline when issue has workflow::dev label", async () => {
    const tc = makeClient(() => Promise.resolve({ firstExecutionRunId: "r" }));
    const fetcher = makeFetcher({ labels: ["workflow::dev"], state: "opened" });

    const result = await handleTriggerPipeline(tc, { issue_iid: 10 }, fetcher);
    const data = parse(result);

    expect(data.started).toBe(false);
    expect(data.status).toBe("already_in_pipeline");
    expect(data.currentLabel).toBe("workflow::dev");
    expect((tc.client.workflow.start as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("returns already_in_pipeline when issue has workflow::review label", async () => {
    const tc = makeClient(() => Promise.resolve({ firstExecutionRunId: "r" }));
    const fetcher = makeFetcher({ labels: ["workflow::review"], state: "opened" });

    const result = await handleTriggerPipeline(tc, { issue_iid: 11 }, fetcher);
    const data = parse(result);

    expect(data.started).toBe(false);
    expect(data.status).toBe("already_in_pipeline");
    expect(data.currentLabel).toBe("workflow::review");
  });

  it("returns issue_closed when issue state is closed", async () => {
    const tc = makeClient(() => Promise.resolve({ firstExecutionRunId: "r" }));
    const fetcher = makeFetcher({ labels: [], state: "closed" });

    const result = await handleTriggerPipeline(tc, { issue_iid: 12 }, fetcher);
    const data = parse(result);

    expect(data.started).toBe(false);
    expect(data.status).toBe("issue_closed");
    expect((tc.client.workflow.start as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("starts workflow normally when issue is open with no workflow:: label", async () => {
    const tc = makeClient(() => Promise.resolve({ firstExecutionRunId: "run-ok" }));
    const fetcher = makeFetcher(cleanIssue);

    const result = await handleTriggerPipeline(tc, { issue_iid: 13 }, fetcher);
    const data = parse(result);

    expect(data.started).toBe(true);
    expect(data.runId).toBe("run-ok");
  });

  it("returns GITLAB_UNREACHABLE when fetcher throws", async () => {
    const tc = makeClient(() => Promise.resolve({ firstExecutionRunId: "r" }));
    const fetcher = makeFailingFetcher("connection refused");

    const result = await handleTriggerPipeline(tc, { issue_iid: 14 }, fetcher);
    const data = parse(result);

    expect("isError" in result && result.isError).toBe(true);
    expect(data.error.code).toBe("GITLAB_UNREACHABLE");
    expect(data.error.message).toBe("connection refused");
    expect((tc.client.workflow.start as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("skips guard and starts workflow when gitlabFetcher is explicitly undefined", async () => {
    const tc = makeClient(() => Promise.resolve({ firstExecutionRunId: "r-skip" }));

    // env vars absent → buildDefaultFetcher returns undefined → guard skipped
    const result = await handleTriggerPipeline(tc, { issue_iid: 15 }, undefined);
    const data = parse(result);

    expect(data.started).toBe(true);
  });
});
