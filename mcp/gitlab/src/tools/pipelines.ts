import { z } from "zod";
import { type GitLabClient, type ToolResult } from "../gitlab-client.js";
import { projectPath, errorResponse } from "./utils.js";

interface GitLabPipeline {
  id: number;
  iid: number;
  ref: string;
  sha: string;
  status: string;
  created_at: string;
  updated_at: string;
  duration: number | null;
  web_url: string;
}

interface GitLabJob {
  id: number;
  name: string;
  stage: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration: number | null;
  web_url: string;
}

interface GitLabTestSuite {
  name: string;
  total_count: number;
  success_count: number;
  failed_count: number;
  error_count: number;
  skipped_count: number;
  total_time: number;
}

interface GitLabTestReport {
  total_count: number;
  success_count: number;
  failed_count: number;
  error_count: number;
  skipped_count: number;
  total_time: number;
  test_suites: GitLabTestSuite[];
}

// gitlab_list_pipelines

export const listPipelinesSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  ref: z.string().optional().describe("Filter by branch name or tag"),
  status: z
    .enum([
      "created",
      "waiting_for_resource",
      "preparing",
      "pending",
      "running",
      "success",
      "failed",
      "canceled",
      "skipped",
      "manual",
      "scheduled",
    ])
    .optional()
    .describe("Filter by pipeline status"),
  page: z.number().int().positive().optional().describe("Page number for pagination (default: 1)"),
});

export async function handleListPipelines(
  client: GitLabClient,
  params: z.infer<typeof listPipelinesSchema>
): Promise<ToolResult> {
  try {
    const queryParams: Record<string, unknown> = { per_page: 100 };
    if (params.ref !== undefined) queryParams.ref = params.ref;
    if (params.status !== undefined) queryParams.status = params.status;
    if (params.page !== undefined) queryParams.page = params.page;

    const pipelines = await client.get<GitLabPipeline[]>(
      `${projectPath(params.project_id)}/pipelines`,
      queryParams
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            pipelines.map((p) => ({
              id: p.id,
              iid: p.iid,
              ref: p.ref,
              sha: p.sha,
              status: p.status,
              web_url: p.web_url,
            }))
          ),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_get_pipeline

export const getPipelineSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  pipeline_id: z.number().int().positive().describe("Pipeline ID"),
});

export async function handleGetPipeline(
  client: GitLabClient,
  params: z.infer<typeof getPipelineSchema>
): Promise<ToolResult> {
  try {
    const pipeline = await client.get<GitLabPipeline>(
      `${projectPath(params.project_id)}/pipelines/${params.pipeline_id}`
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            id: pipeline.id,
            iid: pipeline.iid,
            ref: pipeline.ref,
            sha: pipeline.sha,
            status: pipeline.status,
            duration: pipeline.duration,
            web_url: pipeline.web_url,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_list_pipeline_jobs

export const listPipelineJobsSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  pipeline_id: z.number().int().positive().describe("Pipeline ID"),
});

export async function handleListPipelineJobs(
  client: GitLabClient,
  params: z.infer<typeof listPipelineJobsSchema>
): Promise<ToolResult> {
  try {
    const jobs = await client.get<GitLabJob[]>(
      `${projectPath(params.project_id)}/pipelines/${params.pipeline_id}/jobs`
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            jobs.map((j) => ({
              id: j.id,
              name: j.name,
              stage: j.stage,
              status: j.status,
              duration: j.duration,
              web_url: j.web_url,
            }))
          ),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_get_job_log

const DEFAULT_MAX_BYTES = 50_000;

export const getJobLogSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  job_id: z.number().int().positive().describe("Job ID"),
  max_bytes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(`Maximum log size in bytes to return (default: ${DEFAULT_MAX_BYTES}). Larger logs are truncated.`),
});

export async function handleGetJobLog(
  client: GitLabClient,
  params: z.infer<typeof getJobLogSchema>
): Promise<ToolResult> {
  try {
    const raw = await client.get<string>(
      `${projectPath(params.project_id)}/jobs/${params.job_id}/trace`
    );
    const log = typeof raw === "string" ? raw : JSON.stringify(raw);
    const limit = params.max_bytes ?? DEFAULT_MAX_BYTES;
    const totalBytes = Buffer.byteLength(log, "utf8");
    const truncated = totalBytes > limit;
    const output = truncated ? log.slice(0, limit) : log;
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            log: output,
            truncated,
            total_bytes: totalBytes,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_retry_job

interface GitLabRetryJobResponse {
  id: number;
  status: string;
  name: string;
  web_url: string;
}

export const retryJobSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  job_id: z.number().int().positive().describe("Job ID to retry"),
});

export async function handleRetryJob(
  client: GitLabClient,
  params: z.infer<typeof retryJobSchema>
): Promise<ToolResult> {
  try {
    const job = await client.post<GitLabRetryJobResponse>(
      `${projectPath(params.project_id)}/jobs/${params.job_id}/retry`
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            id: job.id,
            status: job.status,
            name: job.name,
            web_url: job.web_url,
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// gitlab_get_test_report

export const getTestReportSchema = z.object({
  project_id: z.string().describe("Project ID or URL-encoded namespace/project"),
  pipeline_id: z.number().int().positive().describe("Pipeline ID"),
});

export async function handleGetTestReport(
  client: GitLabClient,
  params: z.infer<typeof getTestReportSchema>
): Promise<ToolResult> {
  try {
    const report = await client.get<GitLabTestReport>(
      `${projectPath(params.project_id)}/pipelines/${params.pipeline_id}/test_report`
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            total_count: report.total_count,
            success_count: report.success_count,
            failed_count: report.failed_count,
            error_count: report.error_count,
            skipped_count: report.skipped_count,
            total_time: report.total_time,
            test_suites: report.test_suites.map((s) => ({
              name: s.name,
              total_count: s.total_count,
              success_count: s.success_count,
              failed_count: s.failed_count,
              error_count: s.error_count,
              skipped_count: s.skipped_count,
              total_time: s.total_time,
            })),
          }),
        },
      ],
    };
  } catch (err) {
    return errorResponse(err);
  }
}
