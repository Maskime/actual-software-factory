import { describe, it, expect } from 'vitest'
import { runStaticAnalysisAgent } from './staticAnalysisAgent.js'
import type { PipelineInput } from '../types.js'

const input: PipelineInput = { issueIid: 1, projectId: 3 }

describe('runStaticAnalysisAgent proxy stub', () => {
  it('resolves to undefined (type stub — dispatched to static-analysis-agent queue at runtime)', async () => {
    await expect(runStaticAnalysisAgent(input)).resolves.toBeUndefined()
  })
})
