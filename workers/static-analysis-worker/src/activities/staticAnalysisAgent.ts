import { ApplicationFailure, log } from '@temporalio/activity';
import { callMcpTool } from '@factory/worker-shared';

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
}

export interface StaticAnalysisResult {
  bloquant: SonarIssue[];
  modéré: SonarIssue[];
  hasBlockingIssues: boolean;
}

function staticAnalysisConfig(): { projectKey: string; mcpSonarqubeUrl: string } {
  const projectKey = process.env.SONARQUBE_PROJECT_KEY;
  if (!projectKey) {
    throw ApplicationFailure.nonRetryable('SONARQUBE_PROJECT_KEY is not set', 'MissingConfigError');
  }
  return {
    projectKey,
    mcpSonarqubeUrl: process.env.MCP_SONARQUBE_INTERNAL_URL ?? 'http://mcp-sonarqube:3000/mcp', // NOSONAR
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

async function fetchSonarIssues(
  mcpUrl: string,
  projectKey: string,
  branchName: string,
): Promise<SonarIssue[]> {
  const [issuesText, hotspotsText] = await Promise.all([
    callMcpTool('static-analysis-worker', mcpUrl, 'search_sonar_issues_in_projects', {
      projectKey,
      branch: branchName,
    }),
    callMcpTool('static-analysis-worker', mcpUrl, 'search_security_hotspots', {
      projectKey,
      branch: branchName,
    }),
  ]);
  return [...parseIssueList(issuesText), ...parseHotspotList(hotspotsText)];
}

export async function runStaticAnalysisAgent(input: StaticAnalysisInput): Promise<StaticAnalysisResult> {
  const { projectKey, mcpSonarqubeUrl } = staticAnalysisConfig();
  log.info('Static analysis agent starting', { mrIid: input.mrIid, branchName: input.branchName });

  const allIssues = await fetchSonarIssues(mcpSonarqubeUrl, projectKey, input.branchName);
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

  return { bloquant, modéré, hasBlockingIssues: bloquant.length > 0 };
}
