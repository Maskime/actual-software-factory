export interface GitLabIssueInfo {
  labels: string[];
  state: string;
}

export type GitLabIssueFetcher = (projectId: number, issueIid: number) => Promise<GitLabIssueInfo>;

export async function fetchGitLabIssue(
  apiUrl: string,
  token: string,
  projectId: number,
  issueIid: number
): Promise<GitLabIssueInfo> {
  const url = `${apiUrl}/projects/${projectId}/issues/${issueIid}`;
  // PRIVATE-TOKEN: PAT authentication, consistent with pipeline/agent workers
  const res = await fetch(url, { headers: { "PRIVATE-TOKEN": token } });
  if (!res.ok) throw new Error(`GitLab API ${res.status}: ${res.statusText}`);
  const { labels, state } = await res.json() as { labels: string[]; state: string };
  return { labels, state };
}
