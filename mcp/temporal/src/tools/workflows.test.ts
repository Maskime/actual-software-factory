import { vi, describe, it, expect, beforeEach } from 'vitest'
import { WorkflowNotFoundError } from '@temporalio/client'
import {
  handleSendSignal,
  handleGetWorkflowStatus,
  handleListWorkflows,
} from './workflows.js'
import type { TemporalClient } from '../temporal-client.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text)
}

function makeHandle(overrides: Record<string, unknown> = {}) {
  return {
    signal: vi.fn().mockResolvedValue(undefined),
    describe: vi.fn(),
    result: vi.fn(),
    ...overrides,
  }
}

function makeClient(handle: ReturnType<typeof makeHandle>): TemporalClient {
  return {
    client: {
      workflow: {
        getHandle: vi.fn().mockReturnValue(handle),
        list: vi.fn(),
      },
    },
  } as unknown as TemporalClient
}

// ---------------------------------------------------------------------------
// handleSendSignal
// ---------------------------------------------------------------------------

describe('handleSendSignal()', () => {
  it('sends signal without payload and returns success', async () => {
    const handle = makeHandle()
    const tc = makeClient(handle)

    const result = await handleSendSignal(tc, {
      workflow_id: 'wf-1',
      signal_name: 'approve',
    })

    expect(handle.signal).toHaveBeenCalledWith('approve')
    expect(parse(result).success).toBe(true)
    expect(parse(result).workflow_id).toBe('wf-1')
  })

  it('sends signal with payload when provided', async () => {
    const handle = makeHandle()
    const tc = makeClient(handle)

    await handleSendSignal(tc, {
      workflow_id: 'wf-1',
      signal_name: 'update',
      payload: { key: 'value' },
    })

    expect(handle.signal).toHaveBeenCalledWith('update', { key: 'value' })
  })

  it('returns WORKFLOW_NOT_FOUND error on WorkflowNotFoundError', async () => {
    const handle = makeHandle({
      signal: vi.fn().mockRejectedValue(new WorkflowNotFoundError('not found', 'wf-99', undefined)),
    })
    const tc = makeClient(handle)

    const result = await handleSendSignal(tc, { workflow_id: 'wf-99', signal_name: 'approve' })

    expect('isError' in result && result.isError).toBe(true)
    expect(parse(result).error.code).toBe('WORKFLOW_NOT_FOUND')
  })

  it('returns TEMPORAL_ERROR on generic Error', async () => {
    const handle = makeHandle({
      signal: vi.fn().mockRejectedValue(new Error('server error')),
    })
    const tc = makeClient(handle)

    const result = await handleSendSignal(tc, { workflow_id: 'wf-1', signal_name: 'go' })

    expect('isError' in result && result.isError).toBe(true)
    expect(parse(result).error.code).toBe('TEMPORAL_ERROR')
    expect(parse(result).error.message).toBe('server error')
  })

  it('converts non-Error thrown values to string', async () => {
    const handle = makeHandle({
      signal: vi.fn().mockRejectedValue('raw string error'),
    })
    const tc = makeClient(handle)

    const result = await handleSendSignal(tc, { workflow_id: 'wf-1', signal_name: 'go' })

    expect('isError' in result && result.isError).toBe(true)
    expect(parse(result).error.message).toBe('raw string error')
  })
})

// ---------------------------------------------------------------------------
// handleGetWorkflowStatus
// ---------------------------------------------------------------------------

describe('handleGetWorkflowStatus()', () => {
  const baseDescription = {
    workflowId: 'wf-1',
    runId: 'run-1',
    type: 'MyWorkflow',
    status: 1, // Running
    startTime: new Date('2024-01-01T00:00:00Z'),
    closeTime: undefined,
  }

  it('returns status for a running workflow', async () => {
    const handle = makeHandle({ describe: vi.fn().mockResolvedValue(baseDescription) })
    const tc = makeClient(handle)

    const result = await handleGetWorkflowStatus(tc, { workflow_id: 'wf-1' })
    const data = parse(result)

    expect(data.status).toBe('Running')
    expect(data.workflow_id).toBe('wf-1')
    expect(data.close_time).toBeNull()
  })

  it('includes result for a completed workflow', async () => {
    const completedDesc = { ...baseDescription, status: 2, closeTime: new Date('2024-01-02T00:00:00Z') }
    const handle = makeHandle({
      describe: vi.fn().mockResolvedValue(completedDesc),
      result: vi.fn().mockResolvedValue({ output: 'done' }),
    })
    const tc = makeClient(handle)

    const result = await handleGetWorkflowStatus(tc, { workflow_id: 'wf-1' })
    const data = parse(result)

    expect(data.status).toBe('Completed')
    expect(data.result).toEqual({ output: 'done' })
    expect(data.close_time).not.toBeNull()
  })

  it('returns null result when result() rejects for completed workflow', async () => {
    const completedDesc = { ...baseDescription, status: 2, closeTime: new Date() }
    const handle = makeHandle({
      describe: vi.fn().mockResolvedValue(completedDesc),
      result: vi.fn().mockRejectedValue(new Error('result unavailable')),
    })
    const tc = makeClient(handle)

    const result = await handleGetWorkflowStatus(tc, { workflow_id: 'wf-1' })
    expect(parse(result).result).toBeNull()
  })

  it('returns WORKFLOW_NOT_FOUND when describe throws WorkflowNotFoundError', async () => {
    const handle = makeHandle({
      describe: vi.fn().mockRejectedValue(new WorkflowNotFoundError('not found', 'wf-x', undefined)),
    })
    const tc = makeClient(handle)

    const result = await handleGetWorkflowStatus(tc, { workflow_id: 'wf-x' })
    expect('isError' in result && result.isError).toBe(true)
    expect(parse(result).error.code).toBe('WORKFLOW_NOT_FOUND')
  })

  it('maps unknown status to "Unknown"', async () => {
    const handle = makeHandle({
      describe: vi.fn().mockResolvedValue({ ...baseDescription, status: 999 }),
    })
    const tc = makeClient(handle)

    const result = await handleGetWorkflowStatus(tc, { workflow_id: 'wf-1' })
    expect(parse(result).status).toBe('Unknown')
  })
})

// ---------------------------------------------------------------------------
// handleListWorkflows
// ---------------------------------------------------------------------------

function makeListClient(executions: Array<Record<string, unknown>>): TemporalClient {
  async function* asyncGen() {
    for (const e of executions) yield e
  }

  return {
    client: {
      workflow: {
        list: vi.fn().mockReturnValue(asyncGen()),
      },
    },
  } as unknown as TemporalClient
}

const sampleExecution = {
  workflowId: 'wf-1',
  runId: 'run-1',
  type: 'MyWorkflow',
  status: 1,
  startTime: new Date('2024-01-01T00:00:00Z'),
  closeTime: undefined,
}

describe('handleListWorkflows()', () => {
  it('returns all executions when no filter provided', async () => {
    const tc = makeListClient([sampleExecution])
    const result = await handleListWorkflows(tc, {})
    const data = parse(result)

    expect(data.count).toBe(1)
    expect(data.workflows[0].workflow_id).toBe('wf-1')
    expect(data.workflows[0].status).toBe('Running')
    expect(data.workflows[0].close_time).toBeNull()
  })

  it('passes status filter as Temporal query', async () => {
    const listMock = vi.fn().mockReturnValue((async function* () {})())
    const tc = { client: { workflow: { list: listMock } } } as unknown as TemporalClient

    await handleListWorkflows(tc, { status: 'Completed' })
    expect(listMock).toHaveBeenCalledWith({ query: 'ExecutionStatus = "Completed"' })
  })

  it('passes workflow_type filter as Temporal query', async () => {
    const listMock = vi.fn().mockReturnValue((async function* () {})())
    const tc = { client: { workflow: { list: listMock } } } as unknown as TemporalClient

    await handleListWorkflows(tc, { workflow_type: 'DeployWorkflow' })
    expect(listMock).toHaveBeenCalledWith({ query: 'WorkflowType = "DeployWorkflow"' })
  })

  it('combines status and workflow_type filters with AND', async () => {
    const listMock = vi.fn().mockReturnValue((async function* () {})())
    const tc = { client: { workflow: { list: listMock } } } as unknown as TemporalClient

    await handleListWorkflows(tc, { status: 'Running', workflow_type: 'DeployWorkflow' })
    expect(listMock).toHaveBeenCalledWith({
      query: 'ExecutionStatus = "Running" AND WorkflowType = "DeployWorkflow"',
    })
  })

  it('strips quotes from workflow_type to prevent query injection', async () => {
    const listMock = vi.fn().mockReturnValue((async function* () {})())
    const tc = { client: { workflow: { list: listMock } } } as unknown as TemporalClient

    await handleListWorkflows(tc, { workflow_type: 'Bad"Type' })
    expect(listMock).toHaveBeenCalledWith({ query: 'WorkflowType = "BadType"' })
  })

  it('respects page_size and stops iteration early', async () => {
    const executions = Array.from({ length: 5 }, (_, i) => ({
      ...sampleExecution,
      workflowId: `wf-${i}`,
    }))
    const tc = makeListClient(executions)

    const result = await handleListWorkflows(tc, { page_size: 2 })
    expect(parse(result).count).toBe(2)
  })

  it('defaults page_size to 20', async () => {
    const executions = Array.from({ length: 25 }, (_, i) => ({
      ...sampleExecution,
      workflowId: `wf-${i}`,
    }))
    const tc = makeListClient(executions)

    const result = await handleListWorkflows(tc, {})
    expect(parse(result).count).toBe(20)
  })

  it('returns TEMPORAL_ERROR on list failure', async () => {
    async function* failingGen() {
      throw new Error('list failed')
    }
    const tc = {
      client: { workflow: { list: vi.fn().mockReturnValue(failingGen()) } },
    } as unknown as TemporalClient

    const result = await handleListWorkflows(tc, {})
    expect('isError' in result && result.isError).toBe(true)
    expect(parse(result).error.code).toBe('TEMPORAL_ERROR')
  })
})
