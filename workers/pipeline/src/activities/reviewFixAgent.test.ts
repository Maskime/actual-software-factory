import { describe, it, expect } from 'vitest'
import { runFixReviewAgent } from './reviewFixAgent.js'
import type { ReviewAgentInput } from '../types.js'

const input: ReviewAgentInput = { issueIid: 1, projectId: 3, mrIid: 10, branchName: 'feature/1-test' }

describe('runFixReviewAgent proxy stub', () => {
  it('resolves to undefined (type stub — dispatched to review-fix-queue at runtime)', async () => {
    await expect(runFixReviewAgent(input)).resolves.toBeUndefined()
  })
})
