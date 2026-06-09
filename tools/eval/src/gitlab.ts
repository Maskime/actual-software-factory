function gitlabBase(): string {
  return (process.env.GITLAB_API_URL ?? 'http://localhost/api/v4').replace(/\/$/, '');
}

function headers(): Record<string, string> {
  const token = process.env.GITLAB_API_TOKEN;
  if (!token) throw new Error('GITLAB_API_TOKEN is not set');
  return { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${gitlabBase()}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`GitLab API ${path} → ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export interface GitLabIssue {
  iid: number;
  title: string;
  description: string;
}

export interface GitLabMrDiff {
  new_path: string;
  old_path: string;
  diff: string;
}

export function fetchIssue(projectId: number, iid: number): Promise<GitLabIssue> {
  return get<GitLabIssue>(`/projects/${projectId}/issues/${iid}`);
}

export function fetchMrDiffs(projectId: number, mrIid: number): Promise<GitLabMrDiff[]> {
  return get<GitLabMrDiff[]>(`/projects/${projectId}/merge_requests/${mrIid}/diffs`);
}
