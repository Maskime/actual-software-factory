import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TemporalClient } from "./temporal-client.js";
import {
  sendSignalSchema,
  handleSendSignal,
  getWorkflowStatusSchema,
  handleGetWorkflowStatus,
  listWorkflowsSchema,
  handleListWorkflows,
} from "./tools/workflows.js";
import { triggerPipelineSchema, handleTriggerPipeline } from "./tools/trigger.js";

export function buildMcpServer(tc: TemporalClient): McpServer {
  const server = new McpServer({
    name: "mcp-temporal",
    version: "0.1.0",
  });

  server.tool(
    "temporal_send_signal",
    "Send a named signal to a running Temporal workflow. Optionally include a JSON object payload. Returns a confirmation or a structured error if the workflow does not exist.",
    sendSignalSchema.shape,
    (params) => handleSendSignal(tc, params)
  );

  server.tool(
    "temporal_get_workflow_status",
    "Return the execution status of a Temporal workflow (Running, Completed, Failed, TimedOut, Cancelled, Terminated, ContinuedAsNew). For Completed workflows, also returns the workflow result (up to 5-second fetch timeout).",
    getWorkflowStatusSchema.shape,
    (params) => handleGetWorkflowStatus(tc, params)
  );

  server.tool(
    "temporal_list_workflows",
    "List workflow executions in the configured Temporal namespace. Supports filtering by execution status and workflow type. Returns up to page_size results (default 20, max 100).",
    listWorkflowsSchema.shape,
    (params) => handleListWorkflows(tc, params)
  );

  server.tool(
    "temporal_trigger_pipeline",
    "Start a factory pipeline workflow for a GitLab issue. Before starting, checks the issue labels and state on GitLab: returns already_in_pipeline if a workflow::* label is present, issue_closed if the issue is closed, or GITLAB_UNREACHABLE if the GitLab API is unavailable. Idempotent: a second call for the same running workflow returns already_running.",
    triggerPipelineSchema.shape,
    (params) => handleTriggerPipeline(tc, params)
  );

  return server;
}
