import { ApplicationFailure } from '@temporalio/activity';

const ALL_WORKFLOW_LABELS = 'workflow::dev,workflow::review,workflow::fix,workflow::sonarqube';

function gitlabConfig(): { baseUrl: string; token: string } {
  const baseUrl = process.env.GITLAB_API_URL ?? 'http://gitlab/api/v4';
  const token = process.env.GITLAB_API_TOKEN;
  if (!token) throw ApplicationFailure.nonRetryable('GITLAB_API_TOKEN is not set');
  return { baseUrl, token };
}

async function gitlabPut(
  url: string,
  token: string,
  body: Record<string, string>
): Promise<void> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status >= 400 && res.status < 500) {
    throw ApplicationFailure.nonRetryable(
      `GitLab API client error ${res.status} on PUT ${url}`
    );
  }
  if (!res.ok) {
    throw new Error(`GitLab API server error ${res.status} on PUT ${url}`);
  }
}

export async function applyWorkflowLabel(
  projectId: number,
  issueIid: number,
  newLabel: string,
  previousLabel?: string
): Promise<void> {
  const { baseUrl, token } = gitlabConfig();
  const url = `${baseUrl}/projects/${projectId}/issues/${issueIid}`;
  const body: Record<string, string> = { add_labels: newLabel };
  if (previousLabel) body.remove_labels = previousLabel;
  await gitlabPut(url, token, body);
}

export async function closeIssue(projectId: number, issueIid: number): Promise<void> {
  const { baseUrl, token } = gitlabConfig();
  const url = `${baseUrl}/projects/${projectId}/issues/${issueIid}`;
  await gitlabPut(url, token, {
    state_event: 'close',
    remove_labels: ALL_WORKFLOW_LABELS,
  });
}
