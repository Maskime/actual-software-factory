import { log } from '@temporalio/activity';

export interface ReviewCodeInput {
  mrIid: number;
  projectId: number;
  issueIid: number;
  branchName: string;
}

export async function reviewCode(input: ReviewCodeInput): Promise<void> {
  log.info('Review agent starting', {
    mrIid: input.mrIid,
    projectId: input.projectId,
    issueIid: input.issueIid,
    branchName: input.branchName,
  });
  // Review logic implemented in subsequent EPIC-06 user stories
}
