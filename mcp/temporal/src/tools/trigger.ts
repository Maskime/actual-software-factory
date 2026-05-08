import { z } from "zod";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import type { TemporalClient } from "../temporal-client.js";

export const triggerPipelineSchema = z.object({
  issue_iid: z.number().int().positive().describe("GitLab issue IID"),
  project_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("GitLab project ID (defaults to GITLAB_PROJECT_ID env or 3)"),
});

export async function handleTriggerPipeline(
  tc: TemporalClient,
  params: z.infer<typeof triggerPipelineSchema>
) {
  const issueIid = params.issue_iid;
  const projectId = params.project_id ?? Number.parseInt(process.env.GITLAB_PROJECT_ID ?? "3", 10);
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? "factory-pipeline";
  const workflowId = `pipeline-issue-${issueIid}`;

  try {
    const handle = await tc.client.workflow.start("pipelineWorkflow", {
      taskQueue,
      workflowId,
      args: [{ issueIid, projectId }],
    });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            started: true,
            workflowId,
            runId: handle.firstExecutionRunId,
          }),
        },
      ],
    };
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ started: false, status: "already_running", workflowId }),
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error: {
              code: "TEMPORAL_ERROR",
              message: err instanceof Error ? err.message : String(err),
            },
          }),
        },
      ],
      isError: true as const,
    };
  }
}
