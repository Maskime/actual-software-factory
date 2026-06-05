import { describe, it, expect } from 'vitest'
import { runStaticAnalysisAgent, runFixStaticAgent } from './staticAnalysisAgent.js'
import type { ReviewAgentInput } from '../types.js'

const input: ReviewAgentInput = { issueIid: 1, projectId: 3, mrIid: 10, branchName: 'feature/1-test' }

describe('runStaticAnalysisAgent proxy stub', () => {
  it('resolves with empty StaticAnalysisResult (dispatched to static-analysis-agent queue at runtime)', async () => {
    const result = await runStaticAnalysisAgent(input)
    expect(result).toEqual({ bloquant: [], modéré: [], hasBlockingIssues: false })
  })
})

describe('runFixStaticAgent proxy stub', () => {
  it('resolves to undefined (dispatched to static-analysis-agent queue at runtime)', async () => {
    await expect(runFixStaticAgent(input)).resolves.toBeUndefined()
  })
})
