import { createMcpClient, callTool, listTools } from "./client.js";
import { assert, runStep, type SuiteResult, type StepResult } from "./utils.js";

const MCP_SONARQUBE_URL = process.env.MCP_SONARQUBE_URL ?? "http://localhost:3002/mcp";
const PROJECT_KEY = process.env.SONARQUBE_TEST_PROJECT_KEY ?? "factory-test";

export async function runSonarQubeSuite(): Promise<SuiteResult> {
  const steps: StepResult[] = [];

  let client;
  try {
    client = await createMcpClient(MCP_SONARQUBE_URL);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: "SonarQube MCP",
      steps: [],
      skipped: true,
      skipReason: `Cannot connect to ${MCP_SONARQUBE_URL}: ${msg}`,
    };
  }

  let discoveredTools: string[] = [];

  try {
    // 1. Discover tools
    await runStep(steps, "list available tools", async () => {
      discoveredTools = await listTools(client);
      assert(discoveredTools.length > 0, "No tools found on MCP SonarQube server");
      console.log(`  (discovered: ${discoveredTools.join(", ")})`);
    });

    // 2. Issues tool (any tool whose name contains "issue")
    const issueTool = discoveredTools.find((t) => t.toLowerCase().includes("issue"));
    if (issueTool) {
      await runStep(steps, issueTool, async () => {
        const { data, isError } = await callTool(client, issueTool, {
          projectKey: PROJECT_KEY,
        });
        assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      });
    } else {
      steps.push({ name: "issues tool", passed: false, skipped: true });
    }

    // 3. Quality gate tool (any tool whose name contains "gate")
    const gateTool = discoveredTools.find((t) => t.toLowerCase().includes("gate"));
    if (gateTool) {
      await runStep(steps, gateTool, async () => {
        const { data, isError } = await callTool(client, gateTool, {
          projectKey: PROJECT_KEY,
        });
        assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      });
    } else {
      steps.push({ name: "quality gate tool", passed: false, skipped: true });
    }

    // 4. Measures / metrics tool (any tool whose name contains "measure" or "metric")
    const measureTool = discoveredTools.find(
      (t) => t.toLowerCase().includes("measure") || t.toLowerCase().includes("metric")
    );
    if (measureTool) {
      await runStep(steps, measureTool, async () => {
        const { data, isError } = await callTool(client, measureTool, {
          projectKey: PROJECT_KEY,
        });
        assert(!isError, `Tool returned error: ${JSON.stringify(data)}`);
      });
    } else {
      steps.push({ name: "measures tool", passed: false, skipped: true });
    }
  } finally {
    await client.close();
  }

  return { name: "SonarQube MCP", steps };
}
