import { describe, it, expect } from 'vitest';
import { promptHash, scoreStructure, scoreMentionsFiles, scoreCriteriaHit } from './metrics.js';

describe('promptHash', () => {
  it('returns an 8-char hex string', () => {
    const hash = promptHash('hello world');
    expect(hash).toHaveLength(8);
    expect(/^[0-9a-f]{8}$/.test(hash)).toBe(true);
  });

  it('is deterministic', () => {
    expect(promptHash('test')).toBe(promptHash('test'));
  });

  it('produces different hashes for different inputs', () => {
    expect(promptHash('abc')).not.toBe(promptHash('xyz'));
  });
});

describe('scoreStructure', () => {
  it('returns true for numbered list', () => {
    expect(scoreStructure('1. Do something\n2. Do more')).toBe(true);
  });

  it('returns true for bullet list with dash', () => {
    expect(scoreStructure('- item one\n- item two')).toBe(true);
  });

  it('returns true for asterisk list', () => {
    expect(scoreStructure('* item one')).toBe(true);
  });

  it('returns false for plain paragraph', () => {
    expect(scoreStructure('Just plain text without list markers')).toBe(false);
  });
});

describe('scoreMentionsFiles', () => {
  it('returns true for .ts extension', () => {
    expect(scoreMentionsFiles('see src/utils.ts for details')).toBe(true);
  });

  it('returns true for .json extension', () => {
    expect(scoreMentionsFiles('update package.json')).toBe(true);
  });

  it('returns true for .yml extension', () => {
    expect(scoreMentionsFiles('check docker-compose.yml')).toBe(true);
  });

  it('returns true for .md extension', () => {
    expect(scoreMentionsFiles('see README.md')).toBe(true);
  });

  it('returns false for plain text without file extensions', () => {
    expect(scoreMentionsFiles('no file references here')).toBe(false);
  });
});

describe('scoreCriteriaHit', () => {
  it('counts criteria whose words appear in output', () => {
    const output = 'The implementation handles authentication and authorization properly';
    const criteria = ['authentication flow', 'error handling'];
    expect(scoreCriteriaHit(output, criteria)).toBe(1);
  });

  it('returns 0 for no matches', () => {
    const output = 'some unrelated output';
    const criteria = ['authentication', 'authorization'];
    expect(scoreCriteriaHit(output, criteria)).toBe(0);
  });

  it('returns full count when all criteria match', () => {
    const output = 'handles authentication and authorization and validation';
    const criteria = ['authentication flow', 'authorization check', 'validation logic'];
    expect(scoreCriteriaHit(output, criteria)).toBe(3);
  });

  it('ignores words of 4 chars or fewer', () => {
    const output = 'some output here';
    const criteria = ['do it now'];
    expect(scoreCriteriaHit(output, criteria)).toBe(0);
  });

  it('returns 0 for empty criteria array', () => {
    expect(scoreCriteriaHit('any output', [])).toBe(0);
  });

  it('is case-insensitive', () => {
    const output = 'AUTHENTICATION is implemented';
    const criteria = ['authentication flow'];
    expect(scoreCriteriaHit(output, criteria)).toBe(1);
  });
});
