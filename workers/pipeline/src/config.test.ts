import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { gitlabActivityOptions, agentActivityOptions } from './config.js'

const GITLAB_KEYS = [
  'GITLAB_ACTIVITY_SCHEDULE_TO_CLOSE_TIMEOUT',
  'GITLAB_ACTIVITY_START_TO_CLOSE_TIMEOUT',
  'GITLAB_ACTIVITY_MAX_ATTEMPTS',
  'GITLAB_ACTIVITY_INITIAL_INTERVAL',
  'GITLAB_ACTIVITY_BACKOFF_COEFFICIENT',
] as const

const AGENT_KEYS = [
  'AGENT_ACTIVITY_SCHEDULE_TO_CLOSE_TIMEOUT',
  'AGENT_ACTIVITY_START_TO_CLOSE_TIMEOUT',
  'AGENT_ACTIVITY_MAX_ATTEMPTS',
  'AGENT_ACTIVITY_INITIAL_INTERVAL',
  'AGENT_ACTIVITY_BACKOFF_COEFFICIENT',
] as const

function clearEnv() {
  for (const k of [...GITLAB_KEYS, ...AGENT_KEYS]) delete process.env[k]
}

describe('gitlabActivityOptions', () => {
  beforeEach(clearEnv)
  afterEach(clearEnv)

  it('returns default scheduleToCloseTimeout of 10 minutes', () => {
    expect(gitlabActivityOptions().scheduleToCloseTimeout).toBe('10 minutes')
  })

  it('returns default startToCloseTimeout of 30 seconds', () => {
    expect(gitlabActivityOptions().startToCloseTimeout).toBe('30 seconds')
  })

  it('returns default maximumAttempts of 5', () => {
    expect(gitlabActivityOptions().retry?.maximumAttempts).toBe(5)
  })

  it('returns default initialInterval of 5s', () => {
    expect(gitlabActivityOptions().retry?.initialInterval).toBe('5s')
  })

  it('returns default backoffCoefficient of 2', () => {
    expect(gitlabActivityOptions().retry?.backoffCoefficient).toBe(2)
  })

  it('includes GitLabClientError in nonRetryableErrorTypes', () => {
    expect(gitlabActivityOptions().retry?.nonRetryableErrorTypes).toContain('GitLabClientError')
  })

  it('overrides scheduleToCloseTimeout via env var', () => {
    process.env.GITLAB_ACTIVITY_SCHEDULE_TO_CLOSE_TIMEOUT = '15 minutes'
    expect(gitlabActivityOptions().scheduleToCloseTimeout).toBe('15 minutes')
  })

  it('overrides maximumAttempts via env var', () => {
    process.env.GITLAB_ACTIVITY_MAX_ATTEMPTS = '10'
    expect(gitlabActivityOptions().retry?.maximumAttempts).toBe(10)
  })

  it('overrides backoffCoefficient via env var', () => {
    process.env.GITLAB_ACTIVITY_BACKOFF_COEFFICIENT = '3'
    expect(gitlabActivityOptions().retry?.backoffCoefficient).toBe(3)
  })
})

describe('agentActivityOptions', () => {
  beforeEach(clearEnv)
  afterEach(clearEnv)

  it('returns default scheduleToCloseTimeout of 4 hours', () => {
    expect(agentActivityOptions().scheduleToCloseTimeout).toBe('4 hours')
  })

  it('returns default startToCloseTimeout of 60 minutes', () => {
    expect(agentActivityOptions().startToCloseTimeout).toBe('60 minutes')
  })

  it('returns default maximumAttempts of 3', () => {
    expect(agentActivityOptions().retry?.maximumAttempts).toBe(3)
  })

  it('returns default backoffCoefficient of 2', () => {
    expect(agentActivityOptions().retry?.backoffCoefficient).toBe(2)
  })

  it('overrides scheduleToCloseTimeout via env var', () => {
    process.env.AGENT_ACTIVITY_SCHEDULE_TO_CLOSE_TIMEOUT = '8 hours'
    expect(agentActivityOptions().scheduleToCloseTimeout).toBe('8 hours')
  })

  it('overrides maximumAttempts via env var', () => {
    process.env.AGENT_ACTIVITY_MAX_ATTEMPTS = '5'
    expect(agentActivityOptions().retry?.maximumAttempts).toBe(5)
  })
})
