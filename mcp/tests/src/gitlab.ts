import { createMcpClient, callTool } from "./client.js";
import { assert, assertField, runStep, type SuiteResult, type StepResult } from "./utils.js";

const MCP_GITLAB_URL = process.env.MCP_GITLAB_URL ?? "http://localhost:3001/mcp";
const PROJECT = process.env.GITLAB_TEST_PROJECT_PATH ?? "root/factory-test";

export async function runGitLabSuite(): Promise<SuiteResult> {
  const steps: StepResult[] = [];
  const tag = `mcp-test-${Date.now()}`;
  const branchName = tag;
  const filePath = `${tag}.txt`;
  const fileContent = `Round-trip test file created at ${new Date().toISOString()}`;

  let client;
  try {
    client = await createMcpClient(MCP_GITLAB_URL);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "GitLab MCP",
      steps: [],
      skipped: true,
      skipReason: `Cannot connect to ${MCP_GITLAB_URL}: ${msg}`,
    };
  }

  let issueIid = 0;
  let mrIid = 0;

  try {
    // 1. create issue
    await runStep(steps, "gitlab_create_issue", async () => {
      const { data, isError } = await callTool(client, "gitlab_create_issue", {
        project_id: PROJECT,
        title: tag,
        description: "MCP round-trip test issue",
      });
      assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      issueIid = assertField<number>(data, "iid");
      assert(issueIid > 0, `Expected positive iid, got ${issueIid}`);
    });

    // 2. get issue
    await runStep(steps, "gitlab_get_issue", async () => {
      const { data, isError } = await callTool(client, "gitlab_get_issue", {
        project_id: PROJECT,
        issue_iid: issueIid,
      });
      assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      assertField(data, "title", tag);
      assertField(data, "state", "opened");
    });

    // 3. update issue
    await runStep(steps, "gitlab_update_issue", async () => {
      const updatedTitle = `${tag}-updated`;
      const { data, isError } = await callTool(client, "gitlab_update_issue", {
        project_id: PROJECT,
        issue_iid: issueIid,
        title: updatedTitle,
      });
      assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      assertField(data, "title", updatedTitle);
    });

    // 4. create branch
    await runStep(steps, "gitlab_create_branch", async () => {
      const { data, isError } = await callTool(client, "gitlab_create_branch", {
        project_id: PROJECT,
        branch: branchName,
        ref: "main",
      });
      assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      assertField(data, "name", branchName);
      const sha = assertField<string>(data, "sha");
      assert(sha.length > 0, "Expected non-empty SHA");
    });

    // 5. commit file
    await runStep(steps, "gitlab_commit_files", async () => {
      const { data, isError } = await callTool(client, "gitlab_commit_files", {
        project_id: PROJECT,
        branch: branchName,
        commit_message: `chore: MCP round-trip test [${tag}]`,
        actions: [{ action: "create", file_path: filePath, content: fileContent }],
      });
      assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      const sha = assertField<string>(data, "sha");
      assert(sha.length > 0, "Expected non-empty commit SHA");
    });

    // 6. get file
    await runStep(steps, "gitlab_get_file", async () => {
      const { data, isError } = await callTool(client, "gitlab_get_file", {
        project_id: PROJECT,
        file_path: filePath,
        ref: branchName,
      });
      assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      assertField(data, "content", fileContent);
    });

    // 7. list repository tree
    await runStep(steps, "gitlab_get_repository_tree", async () => {
      const { data, isError } = await callTool(client, "gitlab_get_repository_tree", {
        project_id: PROJECT,
        ref: branchName,
      });
      assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      const entries = data as Array<{ path: string }>;
      assert(Array.isArray(entries), "Expected array response");
      assert(
        entries.some((e) => e.path === filePath),
        `File "${filePath}" not found in repository tree`
      );
    });

    // 8. create MR
    await runStep(steps, "gitlab_create_mr", async () => {
      const { data, isError } = await callTool(client, "gitlab_create_mr", {
        project_id: PROJECT,
        source_branch: branchName,
        target_branch: "main",
        title: `MCP round-trip test [${tag}]`,
        description: "Automated round-trip test MR",
      });
      assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      mrIid = assertField<number>(data, "iid");
      assert(mrIid > 0, `Expected positive MR iid, got ${mrIid}`);
    });

    // 9. add comment
    let commentBody = "";
    await runStep(steps, "gitlab_add_mr_comment", async () => {
      commentBody = `Round-trip test comment [${tag}]`;
      const { data, isError } = await callTool(client, "gitlab_add_mr_comment", {
        project_id: PROJECT,
        mr_iid: mrIid,
        body: commentBody,
      });
      assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      const id = assertField<number>(data, "id");
      assert(id > 0, "Expected positive note id");
    });

    // 10. get MR and verify comment
    await runStep(steps, "gitlab_get_mr", async () => {
      const { data, isError } = await callTool(client, "gitlab_get_mr", {
        project_id: PROJECT,
        mr_iid: mrIid,
      });
      assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      assertField(data, "iid", mrIid);
      const comments = (data as Record<string, unknown>).comments as Array<{ body: string }>;
      assert(Array.isArray(comments), "Expected comments array");
      assert(
        comments.some((c) => c.body === commentBody),
        `Comment "${commentBody}" not found in MR`
      );
    });

    // 11. get MR diff
    await runStep(steps, "gitlab_get_mr_diff", async () => {
      const { data, isError } = await callTool(client, "gitlab_get_mr_diff", {
        project_id: PROJECT,
        mr_iid: mrIid,
      });
      assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      const changes = data as Array<{ new_path: string }>;
      assert(Array.isArray(changes), "Expected array of changes");
      assert(
        changes.some((c) => c.new_path === filePath),
        `File "${filePath}" not found in MR diff`
      );
    });
  } finally {
    // Cleanup — always run even if a step failed
    await runStep(steps, "cleanup: gitlab_close_issue", async () => {
      if (issueIid === 0) return;
      const { isError } = await callTool(client, "gitlab_close_issue", {
        project_id: PROJECT,
        issue_iid: issueIid,
      });
      assert(!isError, "Failed to close issue");
    });

    // Deleting the branch auto-closes the MR in GitLab
    await runStep(steps, "cleanup: gitlab_delete_branch", async () => {
      const { isError, data } = await callTool(client, "gitlab_delete_branch", {
        project_id: PROJECT,
        branch: branchName,
      });
      assert(!isError, `Failed to delete branch: ${JSON.stringify(data)}`);
    });

    await client.close();
  }

  return { name: "GitLab MCP", steps };
}
