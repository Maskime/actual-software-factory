import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type GitLabClient } from "./gitlab-client.js";
import { checkAuthSchema, handleCheckAuth } from "./tools/health.js";
import { createEpicSchema, handleCreateEpic } from "./tools/epics.js";
import {
  getIssueSchema,
  handleGetIssue,
  listIssuesSchema,
  handleListIssues,
  createIssueSchema,
  handleCreateIssue,
  updateIssueSchema,
  handleUpdateIssue,
  closeIssueSchema,
  handleCloseIssue,
  createIssueLinkSchema,
  handleCreateIssueLink,
  getIssueCommentsSchema,
  handleGetIssueComments,
} from "./tools/issues.js";
import { uploadFileSchema, handleUploadFile } from "./tools/uploads.js";
import {
  createMrSchema,
  handleCreateMr,
  getMrSchema,
  handleGetMr,
  getMrDiffSchema,
  handleGetMrDiff,
  addMrCommentSchema,
  handleAddMrComment,
  addMrInlineCommentSchema,
  handleAddMrInlineComment,
  mergeMrSchema,
  handleMergeMr,
} from "./tools/merge_requests.js";
import {
  createBranchSchema,
  handleCreateBranch,
  listBranchesSchema,
  handleListBranches,
  deleteBranchSchema,
  handleDeleteBranch,
  commitFilesSchema,
  handleCommitFiles,
  getFileSchema,
  handleGetFile,
  getRepositoryTreeSchema,
  handleGetRepositoryTree,
} from "./tools/branches.js";
import {
  listPipelinesSchema,
  handleListPipelines,
  getPipelineSchema,
  handleGetPipeline,
  listPipelineJobsSchema,
  handleListPipelineJobs,
  getJobLogSchema,
  handleGetJobLog,
  getTestReportSchema,
  handleGetTestReport,
} from "./tools/pipelines.js";
import {
  listProjectsSchema,
  handleListProjects,
  getProjectSchema,
  handleGetProject,
  createProjectSchema,
  handleCreateProject,
} from "./tools/projects.js";

export function buildMcpServer(client: GitLabClient): McpServer {
  const server = new McpServer({
    name: "mcp-gitlab",
    version: "0.1.0",
  });

  server.tool(
    "gitlab_create_epic",
    "Create a GitLab epic as an issue prefixed with [EPIC]. Uses the qualification-interface label by default. Returns the epic IID, global ID, title, and URL.",
    createEpicSchema.shape,
    (params) => handleCreateEpic(client, params)
  );

  server.tool(
    "gitlab_check_auth",
    "Verify GitLab authentication and return the authenticated user info",
    checkAuthSchema.shape,
    () => handleCheckAuth(client)
  );

  server.tool(
    "gitlab_get_issue",
    "Retrieve a GitLab issue by its project-scoped IID. Returns title, description, labels, assignees, state, and URL.",
    getIssueSchema.shape,
    (params) => handleGetIssue(client, params)
  );

  server.tool(
    "gitlab_list_issues",
    "List issues in a GitLab project. Supports filtering by state (opened/closed/all), labels (comma-separated), and assignee username. Returns up to 100 issues per page.",
    listIssuesSchema.shape,
    (params) => handleListIssues(client, params)
  );

  server.tool(
    "gitlab_create_issue",
    "Create a new issue in a GitLab project. Returns the created issue IID, global ID, and URL.",
    createIssueSchema.shape,
    (params) => handleCreateIssue(client, params)
  );

  server.tool(
    "gitlab_update_issue",
    "Update an existing GitLab issue. Modifiable fields: title, description, labels (comma-separated, replaces all), state_event (close/reopen). Only provided fields are updated.",
    updateIssueSchema.shape,
    (params) => handleUpdateIssue(client, params)
  );

  server.tool(
    "gitlab_close_issue",
    "Close an open GitLab issue. Returns a confirmation with the final state and URL.",
    closeIssueSchema.shape,
    (params) => handleCloseIssue(client, params)
  );

  server.tool(
    "gitlab_create_issue_link",
    "Create a link between two GitLab issues. Supported link types: relates_to (default), blocks, is_blocked_by. Links are visible in the 'Linked issues' section of each issue. Returns source/target IIDs, link type, and URLs.",
    createIssueLinkSchema.shape,
    (params) => handleCreateIssueLink(client, params)
  );

  server.tool(
    "gitlab_get_issue_comments",
    "Get the comments (human notes) of a GitLab issue. System notes are excluded by default. Returns id, author username, body, and created_at for each comment. Limited to 100 comments per call.",
    getIssueCommentsSchema.shape,
    (params) => handleGetIssueComments(client, params)
  );

  server.tool(
    "gitlab_upload_file",
    "Upload a file to a GitLab project and return its URL and Markdown-ready snippet. " +
      "Accepts either a local file path (file_path) or base64-encoded content (file_content_base64 + filename). " +
      "The returned markdown can be embedded in any GitLab Markdown field: issue description, comment, wiki page.",
    uploadFileSchema.shape,
    (params) => handleUploadFile(client, params)
  );

  server.tool(
    "gitlab_create_mr",
    "Create a GitLab Merge Request from a source branch to a target branch. Returns the MR IID and URL.",
    createMrSchema.shape,
    (params) => handleCreateMr(client, params)
  );

  server.tool(
    "gitlab_get_mr",
    "Get the status, diff summary, labels, and comments of a GitLab Merge Request by its project-scoped IID.",
    getMrSchema.shape,
    (params) => handleGetMr(client, params)
  );

  server.tool(
    "gitlab_get_mr_diff",
    "Get the full file diff (modified files and line-level changes) of a GitLab Merge Request.",
    getMrDiffSchema.shape,
    (params) => handleGetMrDiff(client, params)
  );

  server.tool(
    "gitlab_add_mr_comment",
    "Post a general comment on a GitLab Merge Request. Returns the created note ID and metadata.",
    addMrCommentSchema.shape,
    (params) => handleAddMrComment(client, params)
  );

  server.tool(
    "gitlab_add_mr_inline_comment",
    "Post an inline comment on a specific line of a GitLab Merge Request diff. Requires at least new_line or old_line.",
    addMrInlineCommentSchema.shape,
    (params) => handleAddMrInlineComment(client, params)
  );

  server.tool(
    "gitlab_merge_mr",
    "Merge a GitLab Merge Request. Fails with a structured error if unresolved discussions or failed pipelines block the merge. Supports merge_when_pipeline_succeeds for async merging.",
    mergeMrSchema.shape,
    (params) => handleMergeMr(client, params)
  );

  server.tool(
    "gitlab_create_branch",
    "Create a new branch in a GitLab project from a given ref (branch name, tag, or commit SHA). Returns the new branch name and its head commit SHA.",
    createBranchSchema.shape,
    (params) => handleCreateBranch(client, params)
  );

  server.tool(
    "gitlab_delete_branch",
    "Delete a branch from a GitLab project. Deleting a branch also closes any open Merge Requests targeting that branch. Returns a confirmation.",
    deleteBranchSchema.shape,
    (params) => handleDeleteBranch(client, params)
  );

  server.tool(
    "gitlab_list_branches",
    "List branches of a GitLab project with their head commit SHA. Supports name filtering and pagination (up to 100 per page).",
    listBranchesSchema.shape,
    (params) => handleListBranches(client, params)
  );

  server.tool(
    "gitlab_commit_files",
    "Create a commit on an existing branch with one or more file actions (create, update, delete, move). Content is provided as plain text and encoded automatically. Requires write_repository scope on the GitLab token. Fails with a structured error if the branch does not exist or a conflict is detected.",
    commitFilesSchema.shape,
    (params) => handleCommitFiles(client, params)
  );

  server.tool(
    "gitlab_get_file",
    "Retrieve the content of a file from a GitLab repository for a given ref (branch name, tag, or commit SHA). Content is returned as plain UTF-8 text.",
    getFileSchema.shape,
    (params) => handleGetFile(client, params)
  );

  server.tool(
    "gitlab_get_repository_tree",
    "List the contents of a directory in a GitLab repository for a given ref. Returns file and subdirectory entries with their paths and types. Supports recursive listing.",
    getRepositoryTreeSchema.shape,
    (params) => handleGetRepositoryTree(client, params)
  );

  server.tool(
    "gitlab_list_pipelines",
    "List CI/CD pipelines for a GitLab project. Supports filtering by branch/tag (ref) and status. Returns up to 100 pipelines per page.",
    listPipelinesSchema.shape,
    (params) => handleListPipelines(client, params)
  );

  server.tool(
    "gitlab_get_pipeline",
    "Get the details of a GitLab CI/CD pipeline by its ID. Returns status, ref, SHA, duration, and URL.",
    getPipelineSchema.shape,
    (params) => handleGetPipeline(client, params)
  );

  server.tool(
    "gitlab_list_pipeline_jobs",
    "List the jobs of a GitLab CI/CD pipeline. Returns each job's name, stage, status, duration, and URL.",
    listPipelineJobsSchema.shape,
    (params) => handleListPipelineJobs(client, params)
  );

  server.tool(
    "gitlab_get_job_log",
    "Get the stdout log of a GitLab CI/CD job. Logs exceeding max_bytes are truncated; the response includes a truncated flag and total byte count.",
    getJobLogSchema.shape,
    (params) => handleGetJobLog(client, params)
  );

  server.tool(
    "gitlab_get_test_report",
    "Get the test report of a GitLab CI/CD pipeline. Returns total, success, failed, error, and skipped test counts plus per-suite breakdown. Returns a structured error if no test report exists for the pipeline.",
    getTestReportSchema.shape,
    (params) => handleGetTestReport(client, params)
  );

  server.tool(
    "gitlab_list_projects",
    "List GitLab projects accessible to the authenticated user. Supports filtering by membership, search term, and visibility. Returns up to 100 projects per page.",
    listProjectsSchema.shape,
    (params) => handleListProjects(client, params)
  );

  server.tool(
    "gitlab_get_project",
    "Get the details of a GitLab project by its numeric ID or URL-encoded namespace/path (e.g. 'root/my-project'). Returns name, namespace, visibility, URLs, default branch, and creation date.",
    getProjectSchema.shape,
    (params) => handleGetProject(client, params)
  );

  server.tool(
    "gitlab_create_project",
    "Create a new GitLab project. Accepts an optional namespace_id to place the project in a group. Visibility defaults to private. Returns the created project ID, name, path, and URLs.",
    createProjectSchema.shape,
    (params) => handleCreateProject(client, params)
  );

  return server;
}
