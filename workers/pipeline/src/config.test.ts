import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { gitlabActivityOptions, agentActivityOptions, reviewAgentActivityOptions, staticAnalysisActivityOptions, humanInTheLoopConfig, suspendNotificationConfig } from './config.js'

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

const REVIEW_KEYS         = ['REVIEW_AGENT_TASK_QUEUE'] as const
const STATIC_ANALYSIS_KEYS = ['STATIC_ANALYSIS_TASK_QUEUE'] as const

const HITL_KEYS    = ['HUMAN_IN_THE_LOOP', 'HUMAN_IN_THE_LOOP_TIMEOUT'] as const
const SUSPEND_KEYS = ['SUSPEND_NOTIFICATION'] as const

function clearEnv() {
  for (const k of [...GITLAB_KEYS, ...AGENT_KEYS, ...REVIEW_KEYS, ...STATIC_ANALYSIS_KEYS, ...HITL_KEYS, ...SUSPEND_KEYS]) delete process.env[k]
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

describe('reviewAgentActivityOptions', () => {
  beforeEach(clearEnv)
  afterEach(clearEnv)

  it('dispatches to review-agent task queue by default', () => {
    expect(reviewAgentActivityOptions().taskQueue).toBe('review-agent')
  })

  it('overrides taskQueue via REVIEW_AGENT_TASK_QUEUE env var', () => {
    process.env.REVIEW_AGENT_TASK_QUEUE = 'custom-review-queue'
    expect(reviewAgentActivityOptions().taskQueue).toBe('custom-review-queue')
  })

  it('returns default scheduleToCloseTimeout of 4 hours', () => {
    expect(reviewAgentActivityOptions().scheduleToCloseTimeout).toBe('4 hours')
  })

  it('returns default maximumAttempts of 3', () => {
    expect(reviewAgentActivityOptions().retry?.maximumAttempts).toBe(3)
  })

  it('includes MaxIterationsError in nonRetryableErrorTypes', () => {
    expect(reviewAgentActivityOptions().retry?.nonRetryableErrorTypes).toContain('MaxIterationsError')
  })

  it('includes MissingConfigError in nonRetryableErrorTypes', () => {
    expect(reviewAgentActivityOptions().retry?.nonRetryableErrorTypes).toContain('MissingConfigError')
  })

  it('includes EmptyDiffError in nonRetryableErrorTypes', () => {
    expect(reviewAgentActivityOptions().retry?.nonRetryableErrorTypes).toContain('EmptyDiffError')
  })
})

describe('staticAnalysisActivityOptions', () => {
  beforeEach(clearEnv)
  afterEach(clearEnv)

  it('dispatches to static-analysis-agent task queue by default', () => {
    expect(staticAnalysisActivityOptions().taskQueue).toBe('static-analysis-agent')
  })

  it('overrides taskQueue via STATIC_ANALYSIS_TASK_QUEUE env var', () => {
    process.env.STATIC_ANALYSIS_TASK_QUEUE = 'custom-static-queue'
    expect(staticAnalysisActivityOptions().taskQueue).toBe('custom-static-queue')
  })

  it('returns default scheduleToCloseTimeout of 4 hours', () => {
    expect(staticAnalysisActivityOptions().scheduleToCloseTimeout).toBe('4 hours')
  })

  it('returns default maximumAttempts of 3', () => {
    expect(staticAnalysisActivityOptions().retry?.maximumAttempts).toBe(3)
  })

  it('includes MaxIterationsError in nonRetryableErrorTypes', () => {
    expect(staticAnalysisActivityOptions().retry?.nonRetryableErrorTypes).toContain('MaxIterationsError')
  })

  it('includes MissingConfigError in nonRetryableErrorTypes', () => {
    expect(staticAnalysisActivityOptions().retry?.nonRetryableErrorTypes).toContain('MissingConfigError')
  })
})

describe('humanInTheLoopConfig', () => {
  beforeEach(clearEnv)
  afterEach(clearEnv)

  it('returns enabled=false by default', () => {
    expect(humanInTheLoopConfig().enabled).toBe(false)
  })

  it('returns timeout of 24 hours by default', () => {
    expect(humanInTheLoopConfig().timeout).toBe('24 hours')
  })

  it('returns enabled=true when HUMAN_IN_THE_LOOP=true', () => {
    process.env.HUMAN_IN_THE_LOOP = 'true'
    expect(humanInTheLoopConfig().enabled).toBe(true)
  })

  it('returns enabled=false when HUMAN_IN_THE_LOOP=false', () => {
    process.env.HUMAN_IN_THE_LOOP = 'false'
    expect(humanInTheLoopConfig().enabled).toBe(false)
  })

  it('overrides timeout via env var', () => {
    process.env.HUMAN_IN_THE_LOOP_TIMEOUT = '1 hour'
    expect(humanInTheLoopConfig().timeout).toBe('1 hour')
  })
})

describe('suspendNotificationConfig', () => {
  beforeEach(clearEnv)
  afterEach(clearEnv)

  it('returns enabled=true by default', () => {
    expect(suspendNotificationConfig().enabled).toBe(true)
  })

  it('returns enabled=false when SUSPEND_NOTIFICATION=false', () => {
    process.env.SUSPEND_NOTIFICATION = 'false'
    expect(suspendNotificationConfig().enabled).toBe(false)
  })

  it('returns enabled=true when SUSPEND_NOTIFICATION=true', () => {
    process.env.SUSPEND_NOTIFICATION = 'true'
    expect(suspendNotificationConfig().enabled).toBe(true)
  })
})
