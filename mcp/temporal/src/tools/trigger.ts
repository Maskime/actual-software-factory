import { z } from "zod";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import type { TemporalClient } from "../temporal-client.js";
import { type GitLabIssueFetcher, fetchGitLabIssue } from "../gitlab-client.js";

export const triggerPipelineSchema = z.object({
  issue_iid: z.number().int().positive().describe("GitLab issue IID"),
  project_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("GitLab project ID (defaults to GITLAB_PROJECT_ID env or 3)"),
});

function mcpJson(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

function mcpError(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }],
    isError: true as const,
  };
}

function buildDefaultFetcher(): GitLabIssueFetcher | undefined {
  const apiUrl = process.env.GITLAB_API_URL;
  const token = process.env.GITLAB_API_TOKEN;
  if (!apiUrl || !token) {
    process.stderr.write(
      "[mcp-temporal] GITLAB_API_URL / GITLAB_API_TOKEN absent — garde anti-doublon désactivée\n"
    );
    return undefined;
  }
  return (projectId, issueIid) => fetchGitLabIssue(apiUrl, token, projectId, issueIid);
}

export async function handleTriggerPipeline(
  tc: TemporalClient,
  params: z.infer<typeof triggerPipelineSchema>,
  gitlabFetcher?: GitLabIssueFetcher
) {
  const issueIid = params.issue_iid;
  const projectId = params.project_id ?? Number.parseInt(process.env.GITLAB_PROJECT_ID ?? "3", 10);
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? "factory-pipeline";
  const workflowId = `pipeline-issue-${issueIid}`;

  const fetcher = gitlabFetcher ?? buildDefaultFetcher();
  if (fetcher) {
    try {
      const issue = await fetcher(projectId, issueIid);
      const workflowLabel = issue.labels.find((l) => l.startsWith("workflow::"));
      if (workflowLabel) {
        return mcpJson({ started: false, status: "already_in_pipeline", currentLabel: workflowLabel });
      }
      if (issue.state === "closed") {
        return mcpJson({ started: false, status: "issue_closed" });
      }
    } catch (err) {
      return mcpError("GITLAB_UNREACHABLE", err instanceof Error ? err.message : String(err));
    }
  }

  try {
    const handle = await tc.client.workflow.start("pipelineWorkflow", {
      taskQueue,
      workflowId,
      args: [{ issueIid, projectId }],
      memo: { issueIid, projectId },
    });
    return mcpJson({ started: true, workflowId, runId: handle.firstExecutionRunId });
  } catch (err) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) {
      return mcpJson({ started: false, status: "already_running", workflowId });
    }
    return mcpError("TEMPORAL_ERROR", err instanceof Error ? err.message : String(err));
  }
}
