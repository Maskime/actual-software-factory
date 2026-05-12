import { describe, it, expect } from 'vitest'
import {
  runDevAgent, runReviewAgent, runFixReviewAgent,
  runStaticAnalysisAgent, runFixStaticAgent, runMergeAgent,
} from './agents.js'
import type { PipelineInput, ReviewAgentInput } from '../types.js'

const input: PipelineInput = { issueIid: 1, projectId: 3 }
const reviewInput: ReviewAgentInput = { issueIid: 1, projectId: 3, mrIid: 10, branchName: 'feature/1-test' }

describe('agent stubs', () => {
  it('runDevAgent rejects (stub not yet implemented)', async () => {
    await expect(runDevAgent(input)).rejects.toThrow('Not implemented')
  })
  it('runReviewAgent resolves to undefined', async () => {
    await expect(runReviewAgent(reviewInput)).resolves.toBeUndefined()
  })
  it('runFixReviewAgent resolves to undefined', async () => {
    await expect(runFixReviewAgent(input)).resolves.toBeUndefined()
  })
  it('runStaticAnalysisAgent resolves to undefined', async () => {
    await expect(runStaticAnalysisAgent(input)).resolves.toBeUndefined()
  })
  it('runFixStaticAgent resolves to undefined', async () => {
    await expect(runFixStaticAgent(input)).resolves.toBeUndefined()
  })
  it('runMergeAgent resolves to undefined', async () => {
    await expect(runMergeAgent(input)).resolves.toBeUndefined()
  })
})
