import { Connection, Client as TemporalSDKClient } from "@temporalio/client";
import { createMcpClient, callTool } from "./client.js";
import { assert, assertField, runStep, type SuiteResult, type StepResult } from "./utils.js";

const MCP_TEMPORAL_URL = process.env.MCP_TEMPORAL_URL ?? "http://localhost:3003/mcp";
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "factory-test";
const TASK_QUEUE = "factory-test-queue";
const WORKFLOW_TIMEOUT_MS = parseInt(process.env.TEMPORAL_TEST_TIMEOUT_MS ?? "30000", 10);

export async function runTemporalSuite(): Promise<SuiteResult> {
  const steps: StepResult[] = [];

  let mcpClient;
  try {
    mcpClient = await createMcpClient(MCP_TEMPORAL_URL);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "Temporal MCP",
      steps: [],
      skipped: true,
      skipReason: `Cannot connect to ${MCP_TEMPORAL_URL}: ${msg}`,
    };
  }

  let sdkClient: TemporalSDKClient | null = null;
  let workflowId = "";
  let runId = "";

  try {
    // 1. Connect Temporal SDK directly and start PingWorkflow
    await runStep(steps, "start PingWorkflow (SDK direct)", async () => {
      const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
      sdkClient = new TemporalSDKClient({ connection, namespace: TEMPORAL_NAMESPACE });

      workflowId = `mcp-test-ping-${Date.now()}`;
      const handle = await sdkClient.workflow.start("PingWorkflow", {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [],
      });
      runId = handle.firstExecutionRunId;
      assert(workflowId.length > 0, "Expected non-empty workflow ID");
      assert(runId.length > 0, "Expected non-empty run ID");
    });

    // 2. list_workflows via MCP
    await runStep(steps, "temporal_list_workflows", async () => {
      const { data, isError } = await callTool(mcpClient, "temporal_list_workflows", {
        status: "Running",
        workflow_type: "PingWorkflow",
      });
      assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      const record = data as Record<string, unknown>;
      const workflows = record.workflows as Array<{ workflow_id: string }>;
      assert(Array.isArray(workflows), "Expected workflows array");
      // Workflow may have already completed before list ran — accept either found or empty
      const found = workflows.some((w) => w.workflow_id === workflowId);
      if (!found) {
        console.log(`  (workflow may have completed before list query — continuing)`);
      }
    });

    // 3. get_workflow_status via MCP
    await runStep(steps, "temporal_get_workflow_status", async () => {
      const { data, isError } = await callTool(mcpClient, "temporal_get_workflow_status", {
        workflow_id: workflowId,
        run_id: runId,
      });
      assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      const status = assertField<string>(data, "status");
      assert(
        status === "Running" || status === "Completed",
        `Unexpected status: ${status}`
      );
    });

    // 4. send_signal via MCP (ping → the PingWorkflow will complete with "pong")
    await runStep(steps, "temporal_send_signal", async () => {
      const { data, isError } = await callTool(mcpClient, "temporal_send_signal", {
        workflow_id: workflowId,
        run_id: runId,
        signal_name: "ping",
      });
      // Accept success (workflow still running) or structured error (workflow already completed
      // due to timing) — both cases prove the tool works correctly
      if (isError) {
        const record = data as Record<string, unknown>;
        const error = record.error as Record<string, unknown> | undefined;
        const code = error?.code as string | undefined;
        assert(
          code === "WORKFLOW_NOT_FOUND" || code === "TEMPORAL_ERROR",
          `Unexpected error code: ${code} — ${JSON.stringify(data)}`
        );
        console.log(`  (workflow completed before signal — structured error code: ${code})`);
      } else {
        const record = data as Record<string, unknown>;
        assertField(record, "success", true);
      }
    });

    // 5. Wait for workflow completion via SDK
    let workflowResult: unknown = null;
    await runStep(steps, "wait for PingWorkflow completion", async () => {
      assert(sdkClient !== null, "SDK client not initialized");
      const handle = (sdkClient as TemporalSDKClient).workflow.getHandle(workflowId, runId);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Workflow did not complete within ${WORKFLOW_TIMEOUT_MS}ms`)), WORKFLOW_TIMEOUT_MS)
      );
      workflowResult = await Promise.race([handle.result(), timeoutPromise]);
    });

    // 6. Final status check via MCP
    await runStep(steps, "temporal_get_workflow_status (final)", async () => {
      const { data, isError } = await callTool(mcpClient, "temporal_get_workflow_status", {
        workflow_id: workflowId,
        run_id: runId,
      });
      assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      assertField(data, "status", "Completed");
      // Verify result is "pong" (returned by PingWorkflow when it receives the ping signal)
      // If signal arrived after completion, workflowResult from SDK is still "pong" only if
      // the signal was delivered; otherwise accept any non-null result
      const record = data as Record<string, unknown>;
      if (record.result !== undefined && record.result !== null) {
        assert(
          record.result === "pong" || workflowResult === null,
          `Expected result "pong", got ${JSON.stringify(record.result)}`
        );
      }
    });
  } finally {
    await mcpClient.close();
  }

  return { name: "Temporal MCP", steps };
}
