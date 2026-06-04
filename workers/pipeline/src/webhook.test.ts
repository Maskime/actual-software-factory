import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { AddressInfo } from 'node:net'

// ---------------------------------------------------------------------------
// Mocks — hoisted so they are available inside vi.mock() factory
// ---------------------------------------------------------------------------

const { mockConnect, MockClient, mockClose } = vi.hoisted(() => {
  const mockClose = vi.fn().mockResolvedValue(undefined)
  const mockSignal = vi.fn().mockResolvedValue(undefined)
  const mockGetHandle = vi.fn().mockReturnValue({ signal: mockSignal })
  const MockClient = vi.fn().mockImplementation(() => ({
    workflow: { getHandle: mockGetHandle },
  }))
  const mockConnect = vi.fn().mockResolvedValue({ close: mockClose })
  return { mockConnect, MockClient, mockClose, mockSignal, mockGetHandle }
})

vi.mock('@temporalio/client', () => ({
  Connection: { connect: mockConnect },
  Client: MockClient,
  WorkflowNotFoundError: class WorkflowNotFoundError extends Error {
    constructor(message?: string) { super(message); this.name = 'WorkflowNotFoundError'; }
  },
}))

import { createWebhookServer, extractIssueIid } from './webhook.js'
import { WorkflowNotFoundError } from '@temporalio/client'

// ---------------------------------------------------------------------------

async function post(port: number, path: string, body: unknown, token?: string): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token !== undefined) headers['x-gitlab-token'] = token
  const res = await fetch(`http://localhost:${port}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  return { status: res.status, text: await res.text() }
}

const PIPELINE_PAYLOAD = (status: string, ref = 'feature/42-my-feature') => ({
  object_kind: 'pipeline',
  object_attributes: { status, ref },
  project: { id: 3 },
})

// ---------------------------------------------------------------------------

describe('extractIssueIid', () => {
  it('extracts issueIid from feature/{n}-slug', () => {
    expect(extractIssueIid('feature/42-my-feature')).toBe(42)
  })

  it('extracts issueIid from feature/{n} (no slug)', () => {
    expect(extractIssueIid('feature/7')).toBe(7)
  })

  it('returns null for main branch', () => {
    expect(extractIssueIid('main')).toBeNull()
  })

  it('returns null for feature branch without numeric id', () => {
    expect(extractIssueIid('feature/fix-typo')).toBeNull()
  })

  it('returns null for arbitrary strings', () => {
    expect(extractIssueIid('release/1.0')).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('createWebhookServer', () => {
  let close: () => Promise<void>
  let port: number

  beforeEach(async () => {
    vi.clearAllMocks()
    const mockSignal = vi.fn().mockResolvedValue(undefined)
    const mockGetHandle = vi.fn().mockReturnValue({ signal: mockSignal });
    (MockClient as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      workflow: { getHandle: mockGetHandle },
    }))
    mockConnect.mockResolvedValue({ close: mockClose })

    const server = await createWebhookServer(0, '', 'factory', 'localhost:7233')
    close = server.close
    port = (server.server.address() as AddressInfo).port
  })

  afterEach(async () => {
    await close()
  })

  it('returns 404 on non-webhook path', async () => {
    const { status } = await post(port, '/health', {})
    expect(status).toBe(404)
  })

  it('returns 400 on invalid JSON', async () => {
    const res = await fetch(`http://localhost:${port}/webhook/gitlab-ci`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })

  it('returns 200 Ignored for non-pipeline events', async () => {
    const { status, text } = await post(port, '/webhook/gitlab-ci', { object_kind: 'push', object_attributes: { status: 'success', ref: 'main' }, project: { id: 3 } })
    expect(status).toBe(200)
    expect(text).toBe('Ignored')
  })

  it('returns 200 Ignored for running status (non-terminal)', async () => {
    const { status, text } = await post(port, '/webhook/gitlab-ci', PIPELINE_PAYLOAD('running'))
    expect(status).toBe(200)
    expect(text).toBe('Ignored')
  })

  it('returns 200 Ignored for branch not matching feature/{issueIid} pattern', async () => {
    const { status, text } = await post(port, '/webhook/gitlab-ci', PIPELINE_PAYLOAD('success', 'main'))
    expect(status).toBe(200)
    expect(text).toBe('Ignored')
  })

  it('sends passed signal on success pipeline and returns 200', async () => {
    const mockSignal = vi.fn().mockResolvedValue(undefined);
    (MockClient as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      workflow: { getHandle: vi.fn().mockReturnValue({ signal: mockSignal }) },
    }))
    const srv = await createWebhookServer(0, '', 'factory', 'localhost:7233')
    const p = (srv.server.address() as AddressInfo).port
    const { status, text } = await post(p, '/webhook/gitlab-ci', PIPELINE_PAYLOAD('success'))
    expect(status).toBe(200)
    expect(text).toBe('OK')
    expect(mockSignal).toHaveBeenCalledWith('sonarqube-scan-completed', { status: 'passed', sonarqubePrKey: 'feature/42-my-feature' })
    await srv.close()
  })

  it('sends failed signal on failed pipeline and returns 200', async () => {
    const mockSignal = vi.fn().mockResolvedValue(undefined);
    (MockClient as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      workflow: { getHandle: vi.fn().mockReturnValue({ signal: mockSignal }) },
    }))
    const srv = await createWebhookServer(0, '', 'factory', 'localhost:7233')
    const p = (srv.server.address() as AddressInfo).port
    const { status, text } = await post(p, '/webhook/gitlab-ci', PIPELINE_PAYLOAD('failed'))
    expect(status).toBe(200)
    expect(text).toBe('OK')
    expect(mockSignal).toHaveBeenCalledWith('sonarqube-scan-completed', { status: 'failed', sonarqubePrKey: 'feature/42-my-feature' })
    await srv.close()
  })

  it('returns 200 when WorkflowNotFoundError is thrown', async () => {
    const mockSignal = vi.fn().mockRejectedValue(new WorkflowNotFoundError('not found', 'pipeline-issue-42', undefined));
    (MockClient as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      workflow: { getHandle: vi.fn().mockReturnValue({ signal: mockSignal }) },
    }))
    const srv = await createWebhookServer(0, '', 'factory', 'localhost:7233')
    const p = (srv.server.address() as AddressInfo).port
    const { status } = await post(p, '/webhook/gitlab-ci', PIPELINE_PAYLOAD('success'))
    expect(status).toBe(200)
    await srv.close()
  })

  it('returns 500 on unexpected Temporal error', async () => {
    const mockSignal = vi.fn().mockRejectedValue(new Error('gRPC connection failed'));
    (MockClient as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      workflow: { getHandle: vi.fn().mockReturnValue({ signal: mockSignal }) },
    }))
    const srv = await createWebhookServer(0, '', 'factory', 'localhost:7233')
    const p = (srv.server.address() as AddressInfo).port
    const { status } = await post(p, '/webhook/gitlab-ci', PIPELINE_PAYLOAD('success'))
    expect(status).toBe(500)
    await srv.close()
  })
})

// ---------------------------------------------------------------------------

describe('createWebhookServer — token validation', () => {
  it('returns 401 when secret is set and token header is missing', async () => {
    mockConnect.mockResolvedValue({ close: vi.fn().mockResolvedValue(undefined) });
    (MockClient as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      workflow: { getHandle: vi.fn() },
    }))
    const { server, close } = await createWebhookServer(0, 'my-secret', 'factory', 'localhost:7233')
    const port = (server.address() as AddressInfo).port
    const res = await fetch(`http://localhost:${port}/webhook/gitlab-ci`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(PIPELINE_PAYLOAD('success')),
    })
    expect(res.status).toBe(401)
    await close()
  })

  it('accepts request when token matches secret', async () => {
    const mockSignal = vi.fn().mockResolvedValue(undefined);
    (MockClient as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      workflow: { getHandle: vi.fn().mockReturnValue({ signal: mockSignal }) },
    }))
    const { server, close } = await createWebhookServer(0, 'my-secret', 'factory', 'localhost:7233')
    const port = (server.address() as AddressInfo).port
    const { status } = await post(port, '/webhook/gitlab-ci', PIPELINE_PAYLOAD('success'), 'my-secret')
    expect(status).toBe(200)
    await close()
  })
})
