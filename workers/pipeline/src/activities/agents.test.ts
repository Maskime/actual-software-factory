import { describe, it, expect } from 'vitest'
import {
  runDevAgent, runReviewAgent, runFixReviewAgent,
  runStaticAnalysisAgent, runFixStaticAgent, runMergeAgent,
} from './agents.js'
import type { PipelineInput } from '../types.js'

const input: PipelineInput = { issueIid: 1, projectId: 3 }

describe('agent stubs', () => {
  it('runDevAgent resolves to undefined', async () => {
    await expect(runDevAgent(input)).resolves.toBeUndefined()
  })
  it('runReviewAgent resolves to undefined', async () => {
    await expect(runReviewAgent(input)).resolves.toBeUndefined()
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
