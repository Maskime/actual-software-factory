import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  process.env.GITLAB_API_URL = 'http://gitlab.test/api/v4';
  process.env.GITLAB_API_TOKEN = 'test-token';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GITLAB_API_URL;
  delete process.env.GITLAB_API_TOKEN;
});

import { fetchIssue, fetchMrDiffs } from './gitlab.js';

describe('fetchIssue', () => {
  it('returns issue data on success', async () => {
    const fakeIssue = { iid: 5, title: 'Test Issue', description: 'Do something' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fakeIssue),
    }));

    const result = await fetchIssue(3, 5);
    expect(result).toEqual(fakeIssue);
    expect(fetch).toHaveBeenCalledWith(
      'http://gitlab.test/api/v4/projects/3/issues/5',
      expect.objectContaining({ headers: expect.objectContaining({ 'PRIVATE-TOKEN': 'test-token' }) }),
    );
  });

  it('throws on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }));

    await expect(fetchIssue(3, 999)).rejects.toThrow('404');
  });

  it('throws when GITLAB_API_TOKEN is not set', async () => {
    delete process.env.GITLAB_API_TOKEN;
    await expect(fetchIssue(3, 1)).rejects.toThrow('GITLAB_API_TOKEN');
  });

  it('uses default base URL when GITLAB_API_URL is not set', async () => {
    delete process.env.GITLAB_API_URL;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ iid: 1, title: 'T', description: 'D' }),
    }));

    await fetchIssue(1, 1);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost/api/v4/projects/1/issues/1',
      expect.anything(),
    );
  });
});

describe('fetchMrDiffs', () => {
  it('returns diff data on success', async () => {
    const fakeDiffs = [{ new_path: 'src/foo.ts', old_path: 'src/foo.ts', diff: '@@ -1 +1 @@' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fakeDiffs),
    }));

    const result = await fetchMrDiffs(3, 42);
    expect(result).toEqual(fakeDiffs);
    expect(fetch).toHaveBeenCalledWith(
      'http://gitlab.test/api/v4/projects/3/merge_requests/42/diffs',
      expect.anything(),
    );
  });

  it('throws on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    }));

    await expect(fetchMrDiffs(3, 1)).rejects.toThrow('403');
  });
});
