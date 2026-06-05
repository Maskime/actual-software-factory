import { ApplicationFailure, activityInfo, log } from '@temporalio/activity';
import { callMcpTool, metricLog, type AuditContext } from '@factory/worker-shared';

export interface StaticAnalysisInput {
  issueIid: number;
  projectId: number;
  mrIid: number;
  branchName: string;
}

export interface SonarIssue {
  key: string;
  type: string;
  severity: string;
  message: string;
  component: string;
  line?: number;
  vulnerabilityProbability?: string;
  rule?: string;
}

export interface StaticAnalysisResult {
  bloquant: SonarIssue[];
  modéré: SonarIssue[];
  hasBlockingIssues: boolean;
}

function staticAnalysisConfig(): { projectKey: string; mcpSonarqubeUrl: string; mcpGitlabUrl: string } {
  const projectKey = process.env.SONARQUBE_PROJECT_KEY;
  if (!projectKey) {
    throw ApplicationFailure.nonRetryable('SONARQUBE_PROJECT_KEY is not set', 'MissingConfigError');
  }
  return {
    projectKey,
    mcpSonarqubeUrl: process.env.MCP_SONARQUBE_INTERNAL_URL ?? 'http://mcp-sonarqube:3000/mcp', // NOSONAR
    mcpGitlabUrl:    process.env.MCP_GITLAB_INTERNAL_URL    ?? 'http://mcp-gitlab:3000/mcp',    // NOSONAR
  };
}

// Bloquant = bugs, vulnérabilités, et hotspots à probabilité HIGH.
// HIGH est le seul niveau considéré bloquant car MEDIUM/LOW sont à risque acceptable
// et ne bloquent pas le merge dans la politique de qualité du projet.
export function classifyIssue(issue: SonarIssue): 'bloquant' | 'modéré' {
  if (issue.type === 'BUG' || issue.type === 'VULNERABILITY') return 'bloquant';
  if (issue.type === 'SECURITY_HOTSPOT' && issue.vulnerabilityProbability === 'HIGH') return 'bloquant';
  return 'modéré';
}

interface RawSonarIssue {
  key?: string;
  type?: string;
  severity?: string;
  message?: string;
  component?: string;
  line?: number;
  rule?: string;
}

interface RawHotspot {
  key?: string;
  component?: string;
  line?: number;
  message?: string;
  vulnerabilityProbability?: string;
  textRange?: { startLine?: number };
}

interface SonarIssuesResponse {
  issues?: RawSonarIssue[];
}

interface HotspotsResponse {
  hotspots?: RawHotspot[];
}

function parseIssueList(text: string): SonarIssue[] {
  try {
    const parsed = JSON.parse(text || '{}') as SonarIssuesResponse;
    const items = Array.isArray(parsed.issues) ? parsed.issues : [];
    return items.map((i) => ({
      key:       i.key      ?? '',
      type:      i.type     ?? 'CODE_SMELL',
      severity:  i.severity ?? 'INFO',
      message:   i.message  ?? '',
      component: i.component ?? '',
      line:      i.line,
      rule:      i.rule,
    }));
  } catch {
    log.warn('Failed to parse SonarQube issues response', { text: text.slice(0, 200) });
    return [];
  }
}

function parseHotspotList(text: string): SonarIssue[] {
  try {
    const parsed = JSON.parse(text || '{}') as HotspotsResponse;
    const items = Array.isArray(parsed.hotspots) ? parsed.hotspots : [];
    return items.map((h) => ({
      key:                    h.key      ?? '',
      type:                   'SECURITY_HOTSPOT',
      severity:               'MAJOR',
      message:                h.message  ?? '',
      component:              h.component ?? '',
      line:                   h.line ?? h.textRange?.startLine,
      vulnerabilityProbability: h.vulnerabilityProbability,
    }));
  } catch {
    log.warn('Failed to parse SonarQube hotspots response', { text: text.slice(0, 200) });
    return [];
  }
}

function extractFilePath(component: string): string {
  const colonIdx = component.indexOf(':');
  return colonIdx >= 0 ? component.slice(colonIdx + 1) : component;
}

function buildBacklogIssueTitle(issue: SonarIssue): string {
  const rule = issue.rule ?? issue.type;
  const filePath = extractFilePath(issue.component);
  return `[SonarQube] ${rule} — ${filePath}`;
}

function buildBacklogIssueDescription(issue: SonarIssue): string {
  const rule = issue.rule ?? issue.type;
  const filePath = extractFilePath(issue.component);
  const lineRef = issue.line === undefined ? 'N/A' : String(issue.line);
  return [
    `**Règle** : ${rule}`,
    `**Fichier** : ${filePath}`,
    `**Ligne** : ${lineRef}`,
    `**Message** : ${issue.message}`,
    `**Sévérité** : ${issue.severity}`,
  ].join('\n');
}

interface RawGitLabIssue {
  title?: string;
}

async function fetchOpenBacklogTitles(
  mcpGitlabUrl: string,
  projectId: number,
  auditCtx?: AuditContext,
): Promise<Set<string>> {
  try {
    const text = await callMcpTool('static-analysis-worker', mcpGitlabUrl, 'gitlab_list_issues', {
      project_id: String(projectId),
      labels: 'backlog',
      state: 'opened',
    }, auditCtx);
    const items = JSON.parse(text || '[]') as RawGitLabIssue[];
    return new Set(Array.isArray(items) ? items.map((i) => i.title ?? '') : []);
  } catch {
    log.warn('Failed to fetch existing backlog issues — proceeding without dedup', { projectId });
    return new Set();
  }
}

export async function createBacklogIssues(
  mcpGitlabUrl: string,
  projectId: number,
  issues: SonarIssue[],
  auditCtx?: AuditContext,
): Promise<{ created: number; skipped: number }> {
  if (issues.length === 0) return { created: 0, skipped: 0 };

  const existingTitles = await fetchOpenBacklogTitles(mcpGitlabUrl, projectId, auditCtx);
  let created = 0;
  let skipped = 0;

  for (const issue of issues) {
    const title = buildBacklogIssueTitle(issue);
    if (existingTitles.has(title)) {
      skipped++;
      continue;
    }
    try {
      await callMcpTool('static-analysis-worker', mcpGitlabUrl, 'gitlab_create_issue', {
        project_id: String(projectId),
        title,
        description: buildBacklogIssueDescription(issue),
        labels: 'backlog',
      }, auditCtx);
      created++;
    } catch (err) {
      log.warn('Failed to create backlog issue — skipping', {
        title,
        error: err instanceof Error ? err.message : String(err),
      });
      skipped++;
    }
  }

  log.info('Backlog issues sync done', { projectId, created, skipped });
  return { created, skipped };
}

export async function fetchSonarIssues(
  mcpUrl: string,
  projectKey: string,
  branchName: string,
  auditCtx?: AuditContext,
): Promise<SonarIssue[]> {
  const [issuesText, hotspotsText] = await Promise.all([
    callMcpTool('static-analysis-worker', mcpUrl, 'search_sonar_issues_in_projects', {
      projectKey,
      branch: branchName,
    }, auditCtx),
    callMcpTool('static-analysis-worker', mcpUrl, 'search_security_hotspots', {
      projectKey,
      branch: branchName,
    }, auditCtx),
  ]);
  return [...parseIssueList(issuesText), ...parseHotspotList(hotspotsText)];
}

export async function runStaticAnalysisAgent(input: StaticAnalysisInput): Promise<StaticAnalysisResult> {
  const info = activityInfo();
  const auditCtx: AuditContext = {
    workflowId: info.workflowExecution?.workflowId ?? info.activityId,
    activityName: 'runStaticAnalysisAgent',
  };

  const startTime = Date.now();
  let analysisSucceeded = false;
  let metricBloquant = 0;
  let metricModere = 0;

  try {
  const { projectKey, mcpSonarqubeUrl, mcpGitlabUrl } = staticAnalysisConfig();
  log.info('Static analysis agent starting', { mrIid: input.mrIid, branchName: input.branchName });

  const allIssues = await fetchSonarIssues(mcpSonarqubeUrl, projectKey, input.branchName, auditCtx);
  const bloquant  = allIssues.filter((i) => classifyIssue(i) === 'bloquant');
  const modéré    = allIssues.filter((i) => classifyIssue(i) === 'modéré');

  log.info('Static analysis classification', {
    branchName:     input.branchName,
    bloquant:       bloquant.length,
    modéré:         modéré.length,
    blockingIssues: bloquant.map((i) => ({
      key:       i.key,
      type:      i.type,
      message:   i.message,
      component: i.component,
      line:      i.line,
    })),
  });

  try {
    await createBacklogIssues(mcpGitlabUrl, input.projectId, modéré, auditCtx);
  } catch (err) {
    log.warn('Backlog issue creation failed — analysis result unaffected', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  analysisSucceeded = true;
  metricBloquant = bloquant.length;
  metricModere = modéré.length;
  return { bloquant, modéré, hasBlockingIssues: bloquant.length > 0 };
  } finally {
    metricLog({
      type: 'metric',
      timestamp: new Date().toISOString(),
      workflowId: auditCtx.workflowId,
      stage: 'sonarqube',
      status: analysisSucceeded ? 'success' : 'failure',
      durationMs: Date.now() - startTime,
      bloquant: metricBloquant,
      modéré: metricModere,
    });
  }
}
