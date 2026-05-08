import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ApplicationFailure } from '@temporalio/activity'
import { applyWorkflowLabel, closeIssue } from './gitlab.js'

const TOKEN = 'test-token'
const BASE_URL = 'http://test-gitlab/api/v4'

function mockFetch(status: number, ok: boolean) {
  return vi.fn().mockResolvedValue({ ok, status })
}

describe('applyWorkflowLabel', () => {
  beforeEach(() => {
    process.env.GITLAB_API_TOKEN = TOKEN
    process.env.GITLAB_API_URL = BASE_URL
  })

  afterEach(() => {
    delete process.env.GITLAB_API_TOKEN
    delete process.env.GITLAB_API_URL
    vi.unstubAllGlobals()
  })

  it('calls PUT with add_labels when no previousLabel', async () => {
    vi.stubGlobal('fetch', mockFetch(200, true))
    await applyWorkflowLabel(3, 42, 'workflow::dev')
    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/projects/3/issues/42`,
      expect.objectContaining({
        method: 'PUT',
        headers: { 'PRIVATE-TOKEN': TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ add_labels: 'workflow::dev' }),
      })
    )
  })

  it('includes remove_labels when previousLabel is provided', async () => {
    vi.stubGlobal('fetch', mockFetch(200, true))
    await applyWorkflowLabel(3, 42, 'workflow::review', 'workflow::dev')
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ add_labels: 'workflow::review', remove_labels: 'workflow::dev' }),
      })
    )
  })

  it('throws nonRetryable ApplicationFailure on 4xx', async () => {
    vi.stubGlobal('fetch', mockFetch(403, false))
    await expect(applyWorkflowLabel(3, 42, 'workflow::dev')).rejects.toSatisfy(
      (err: unknown) => err instanceof ApplicationFailure && err.nonRetryable === true
    )
  })

  it('throws retryable error on 5xx', async () => {
    vi.stubGlobal('fetch', mockFetch(503, false))
    await expect(applyWorkflowLabel(3, 42, 'workflow::dev')).rejects.toThrow('server error 503')
    await expect(applyWorkflowLabel(3, 42, 'workflow::dev')).rejects.not.toSatisfy(
      (err: unknown) => err instanceof ApplicationFailure
    )
  })

  it('throws nonRetryable when GITLAB_API_TOKEN is missing', async () => {
    delete process.env.GITLAB_API_TOKEN
    await expect(applyWorkflowLabel(3, 42, 'workflow::dev')).rejects.toSatisfy(
      (err: unknown) => err instanceof ApplicationFailure && err.nonRetryable === true
    )
  })
})

describe('closeIssue', () => {
  beforeEach(() => {
    process.env.GITLAB_API_TOKEN = TOKEN
    process.env.GITLAB_API_URL = BASE_URL
  })

  afterEach(() => {
    delete process.env.GITLAB_API_TOKEN
    delete process.env.GITLAB_API_URL
    vi.unstubAllGlobals()
  })

  it('calls PUT with state_event close and removes all workflow labels', async () => {
    vi.stubGlobal('fetch', mockFetch(200, true))
    await closeIssue(3, 42)
    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/projects/3/issues/42`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          state_event: 'close',
          remove_labels: 'workflow::dev,workflow::review,workflow::fix,workflow::sonarqube',
        }),
      })
    )
  })

  it('throws nonRetryable on 4xx', async () => {
    vi.stubGlobal('fetch', mockFetch(404, false))
    await expect(closeIssue(3, 42)).rejects.toSatisfy(
      (err: unknown) => err instanceof ApplicationFailure && err.nonRetryable === true
    )
  })
})
