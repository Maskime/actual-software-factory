import { describe, it, expect } from 'vitest'
import {
  runDevAgent, runMergeAgent,
} from './agents.js'
import type { PipelineInput } from '../types.js'

const input: PipelineInput = { issueIid: 1, projectId: 3 }

describe('agent stubs', () => {
  it('runDevAgent rejects (stub not yet implemented)', async () => {
    await expect(runDevAgent(input)).rejects.toThrow('Not implemented')
  })
  it('runMergeAgent resolves to undefined', async () => {
    await expect(runMergeAgent(input)).resolves.toBeUndefined()
  })
})
