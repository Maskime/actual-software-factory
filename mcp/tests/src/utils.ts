export type StepResult = {
  name: string;
  passed: boolean;
  error?: string;
  skipped?: boolean;
};

export type SuiteResult = {
  name: string;
  steps: StepResult[];
  skipped?: boolean;
  skipReason?: string;
};

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function assertField<T>(
  obj: unknown,
  field: string,
  expected?: T
): T {
  const record = obj as Record<string, unknown>;
  if (!(field in record)) throw new Error(`Missing field "${field}" in response`);
  if (expected !== undefined && record[field] !== expected) {
    throw new Error(`Field "${field}": expected ${JSON.stringify(expected)}, got ${JSON.stringify(record[field])}`);
  }
  return record[field] as T;
}

export function printSuiteResult(suite: SuiteResult): void {
  console.log(`\n[${suite.name}]`);
  if (suite.skipped) {
    console.log(`  ⚠ SKIPPED — ${suite.skipReason ?? ""}`);
    return;
  }
  for (const step of suite.steps) {
    if (step.skipped) {
      console.log(`  ⚠ ${step.name} — skipped`);
    } else if (step.passed) {
      console.log(`  ✓ ${step.name}`);
    } else {
      console.log(`  ✗ ${step.name} — ${step.error ?? "unknown error"}`);
    }
  }
  const passed = suite.steps.filter((s) => s.passed).length;
  const failed = suite.steps.filter((s) => !s.passed && !s.skipped).length;
  const skipped = suite.steps.filter((s) => s.skipped).length;
  const parts = [`${passed} passed`, `${failed} failed`];
  if (skipped > 0) parts.push(`${skipped} skipped`);
  console.log(`  Summary: ${parts.join(", ")}`);
}

export function printGlobalSummary(suites: SuiteResult[]): void {
  console.log("\n" + "=".repeat(50));
  let totalPassed = 0;
  let totalFailed = 0;
  for (const suite of suites) {
    if (suite.skipped) continue;
    totalPassed += suite.steps.filter((s) => s.passed).length;
    totalFailed += suite.steps.filter((s) => !s.passed && !s.skipped).length;
  }
  console.log(`=== Global: ${totalPassed} passed, ${totalFailed} failed ===`);
  console.log("=".repeat(50));
}

export async function runStep(
  steps: StepResult[],
  name: string,
  fn: () => Promise<void>
): Promise<boolean> {
  try {
    await fn();
    steps.push({ name, passed: true });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ name, passed: false, error: msg });
    return false;
  }
}
