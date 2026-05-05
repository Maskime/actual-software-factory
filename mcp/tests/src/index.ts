import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { runGitLabSuite } from "./gitlab.js";
import { runSonarQubeSuite } from "./sonarqube.js";
import { runTemporalSuite } from "./temporal.js";
import { printSuiteResult, printGlobalSummary, type SuiteResult } from "./utils.js";

function loadDotEnv(): void {
  const dir = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(dir, "../../../infrastructure/.env");
  try {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const rawValue = trimmed.slice(eqIndex + 1).trim();
      // Strip surrounding quotes if present
      const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env file is optional — env vars may already be set by the shell
  }
}

async function main(): Promise<void> {
  loadDotEnv();

  console.log("\n=== MCP Round-Trip Tests ===");
  console.log(`  GitLab  : ${process.env.MCP_GITLAB_URL ?? "http://localhost:3001/mcp"}`);
  console.log(`  SonarQube: ${process.env.MCP_SONARQUBE_URL ?? "http://localhost:3002/mcp"}`);
  console.log(`  Temporal : ${process.env.MCP_TEMPORAL_URL ?? "http://localhost:3003/mcp"}`);

  const suites: SuiteResult[] = [];

  suites.push(await runGitLabSuite());
  suites.push(await runSonarQubeSuite());
  suites.push(await runTemporalSuite());

  for (const suite of suites) {
    printSuiteResult(suite);
  }

  printGlobalSummary(suites);

  const anyFailed = suites.some(
    (s) => !s.skipped && s.steps.some((step) => !step.passed && !step.skipped)
  );
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n[mcp-tests] Fatal error: ${msg}`);
  process.exit(1);
});
