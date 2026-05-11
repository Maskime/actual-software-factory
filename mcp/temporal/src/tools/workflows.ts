import { z } from "zod";
import { WorkflowNotFoundError } from "@temporalio/client";
import { defineSearchAttributeKey } from "@temporalio/common";
import type { TemporalClient } from "../temporal-client.js";

// Temporal WorkflowExecutionStatus proto numeric values
const STATUS_LABELS: Record<number, string> = {
  0: "Unspecified",
  1: "Running",
  2: "Completed",
  3: "Failed",
  4: "Cancelled",
  5: "Terminated",
  6: "ContinuedAsNew",
  7: "TimedOut",
};

function statusLabel(status: unknown): string {
  return STATUS_LABELS[Number(status)] ?? "Unknown";
}

function errorResponse(err: unknown) {
  let code = "TEMPORAL_ERROR";
  let message: string;

  if (err instanceof WorkflowNotFoundError) {
    code = "WORKFLOW_NOT_FOUND";
    message = err.message;
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }],
    isError: true as const,
  };
}

const pipelineStageKey = defineSearchAttributeKey("PipelineStage", "KEYWORD");

// ---------------------------------------------------------------------------
// temporal_send_signal
// ---------------------------------------------------------------------------

export const sendSignalSchema = z.object({
  workflow_id: z.string().min(1).describe("Target workflow ID"),
  signal_name: z.string().min(1).describe("Name of the signal to send"),
  run_id: z.string().optional().describe("Optional run ID to target a specific execution"),
  payload: z.record(z.unknown()).optional().describe("Optional signal payload as a JSON object"),
});

export async function handleSendSignal(
  tc: TemporalClient,
  params: z.infer<typeof sendSignalSchema>
) {
  try {
    const handle = tc.client.workflow.getHandle(params.workflow_id, params.run_id);
    if (params.payload !== undefined) {
      await handle.signal(params.signal_name, params.payload);
    } else {
      await handle.signal(params.signal_name);
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            workflow_id: params.workflow_id,
            signal_name: params.signal_name,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// temporal_get_workflow_status
// ---------------------------------------------------------------------------

export const getWorkflowStatusSchema = z.object({
  workflow_id: z.string().min(1).describe("Workflow ID to query"),
  run_id: z.string().optional().describe("Optional run ID to target a specific execution"),
});

const RESULT_TIMEOUT_MS = 5_000;

export async function handleGetWorkflowStatus(
  tc: TemporalClient,
  params: z.infer<typeof getWorkflowStatusSchema>
) {
  try {
    const handle = tc.client.workflow.getHandle(params.workflow_id, params.run_id);
    const description = await handle.describe();
    const currentStatus = statusLabel(description.status);

    const response: Record<string, unknown> = {
      workflow_id: description.workflowId,
      run_id: description.runId,
      workflow_type: description.type,
      status: currentStatus,
      start_time: description.startTime.toISOString(),
      close_time: description.closeTime?.toISOString() ?? null,
      pipeline_stage: description.typedSearchAttributes?.get(pipelineStageKey) ?? null,
    };

    // For completed workflows, try to retrieve the result with a safety timeout
    if (Number(description.status) === 2) {
      const resultPromise = handle.result().catch(() => null);
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), RESULT_TIMEOUT_MS)
      );
      response.result = await Promise.race([resultPromise, timeoutPromise]);
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(response) }],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// temporal_list_workflows
// ---------------------------------------------------------------------------

export const listWorkflowsSchema = z.object({
  status: z
    .enum(["Running", "Completed", "Failed", "TimedOut", "Cancelled", "Terminated", "ContinuedAsNew"])
    .optional()
    .describe("Filter by execution status"),
  workflow_type: z
    .string()
    .optional()
    .describe("Filter by workflow type name (exact match)"),
  issue_iid: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Filter by GitLab issue IID (requires GitLabIssueIid custom search attribute)"),
  page_size: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum results to return (default: 20, max: 100)"),
});

export async function handleListWorkflows(
  tc: TemporalClient,
  params: z.infer<typeof listWorkflowsSchema>
) {
  try {
    const queryParts: string[] = [];

    if (params.status !== undefined) {
      queryParts.push(`ExecutionStatus = "${params.status}"`);
    }

    if (params.workflow_type !== undefined) {
      // Remove quotes to prevent Temporal Visibility query injection
      const safeType = params.workflow_type.replace(/"/g, "");
      queryParts.push(`WorkflowType = "${safeType}"`);
    }

    if (params.issue_iid !== undefined) {
      // z.number().int().positive() guarantees a safe positive integer — no injection risk
      queryParts.push(`GitLabIssueIid = ${params.issue_iid}`);
    }

    const query = queryParts.length > 0 ? queryParts.join(" AND ") : undefined;
    const maxResults = params.page_size ?? 20;
    const results: Array<Record<string, unknown>> = [];

    for await (const execution of tc.client.workflow.list({ query })) {
      results.push({
        workflow_id: execution.workflowId,
        run_id: execution.runId,
        workflow_type: execution.type,
        status: statusLabel(execution.status),
        start_time: execution.startTime.toISOString(),
        close_time: execution.closeTime?.toISOString() ?? null,
      });
      if (results.length >= maxResults) break;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ workflows: results, count: results.length }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}
