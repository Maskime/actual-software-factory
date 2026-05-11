import { describe, it, expect } from 'vitest';
import { slugify } from './utils.js';

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips French accents', () => {
    expect(slugify('Commit et push de la branche')).toBe('commit-et-push-de-la-branche');
    expect(slugify('Implémentation éàü')).toBe('implementation-eau');
  });

  it('strips dashes from issue titles with em-dashes and special chars', () => {
    expect(slugify('US-4 \u2014 Commit et push')).toBe('us-4-commit-et-push');
  });

  it('returns empty string when all chars are non-alphanumeric', () => {
    expect(slugify('---')).toBe('');
    expect(slugify('!!!')).toBe('');
  });

  it('caps output at 50 characters without trailing hyphen', () => {
    const long = 'a'.repeat(60);
    expect(slugify(long).length).toBeLessThanOrEqual(50);
    const withHyphen = 'word '.repeat(15);
    const result = slugify(withHyphen);
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result.endsWith('-')).toBe(false);
  });

  it('collapses multiple consecutive separators into one hyphen', () => {
    expect(slugify('foo  --  bar')).toBe('foo-bar');
  });
});
