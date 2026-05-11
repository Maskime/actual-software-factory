import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { handleTriggerPipeline } from "./trigger.js";
import type { TemporalClient } from "../temporal-client.js";

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

describe("handleTriggerPipeline()", () => {
  beforeEach(() => {
    delete process.env.GITLAB_PROJECT_ID;
    delete process.env.TEMPORAL_TASK_QUEUE;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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
});
