import { fixCode, type FixCodeInput } from './fixCode.js';
import { createBacklogIssues } from './createBacklogIssues.js';

// Champs attendus : issueIid, projectId, mrIid, branchName
export type RunFixReviewAgentInput = FixCodeInput;

export async function runFixReviewAgent(input: RunFixReviewAgentInput): Promise<void> {
  // 1) inscrire les feedbacks modérés non encore au backlog (dé-dup interne)
  await createBacklogIssues({ projectId: input.projectId, mrIid: input.mrIid });
  // 2) corriger les bloquants + émettre le signal review-fix-completed (fait dans fixCode)
  await fixCode(input);
}
