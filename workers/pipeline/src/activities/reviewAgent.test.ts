import { describe, it, expect } from 'vitest'
import { reviewCode } from './reviewAgent.js'
import type { ReviewAgentInput } from '../types.js'

const input: ReviewAgentInput = { issueIid: 1, projectId: 3, mrIid: 10, branchName: 'feature/1-test' }

describe('reviewCode proxy stub', () => {
  it('resolves to empty ReviewAgentOutput (type stub — dispatched to review-agent queue at runtime)', async () => {
    await expect(reviewCode(input)).resolves.toEqual({ comments: [] })
  })
})
