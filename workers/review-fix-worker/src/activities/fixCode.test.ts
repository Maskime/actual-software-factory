import { describe, it, expect } from 'vitest';
import { ApplicationFailure } from '@temporalio/activity';
import { fixCode } from './fixCode.js';

describe('fixCode', () => {
  it('throws a non-retryable ApplicationFailure', () => {
    expect(() => fixCode()).toThrow(ApplicationFailure);
  });

  it('throws with nonRetryable flag set', () => {
    try {
      fixCode();
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationFailure);
      expect((err as ApplicationFailure).nonRetryable).toBe(true);
    }
  });
});
