import { ApplicationFailure } from '@temporalio/activity';

export function fixCode(): never {
  throw ApplicationFailure.nonRetryable('not yet implemented');
}
