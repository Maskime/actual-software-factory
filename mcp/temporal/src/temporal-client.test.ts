import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — hoisted so they are available inside vi.mock() factory
// ---------------------------------------------------------------------------

const { mockGetSystemInfo, mockConnect, MockClient, mockReadFileSync } = vi.hoisted(() => ({
  mockGetSystemInfo: vi.fn(),
  mockConnect: vi.fn(),
  MockClient: vi.fn(),
  mockReadFileSync: vi.fn(),
}))

vi.mock('@temporalio/client', () => ({
  Connection: { connect: mockConnect },
  Client: MockClient,
}))

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
}))

import { TemporalClient, TemporalConnectionError } from './temporal-client.js'

// ---------------------------------------------------------------------------

describe('TemporalClient — constructor', () => {
  afterEach(() => {
    delete process.env.TEMPORAL_ADDRESS
    delete process.env.TEMPORAL_NAMESPACE
  })

  it('uses defaults when env vars are absent', () => {
    const tc = new TemporalClient()
    expect(tc.address).toBe('localhost:7233')
    expect(tc.namespace).toBe('default')
  })

  it('reads address and namespace from env vars', () => {
    process.env.TEMPORAL_ADDRESS = 'temporal.internal:7233'
    process.env.TEMPORAL_NAMESPACE = 'factory-test'
    const tc = new TemporalClient()
    expect(tc.address).toBe('temporal.internal:7233')
    expect(tc.namespace).toBe('factory-test')
  })
})

// ---------------------------------------------------------------------------

describe('TemporalClient — buildConnectionOptions (via connect)', () => {
  beforeEach(() => {
    mockConnect.mockReset()
    MockClient.mockReset()
    mockReadFileSync.mockReset()
    delete process.env.TEMPORAL_API_KEY
    delete process.env.TEMPORAL_TLS_CERT_PATH
    delete process.env.TEMPORAL_TLS_KEY_PATH
    delete process.env.TEMPORAL_ADDRESS
  })

  it('connects without auth when no env vars set', async () => {
    mockConnect.mockResolvedValue({ workflowService: { getSystemInfo: mockGetSystemInfo } })
    MockClient.mockImplementation(function() { return {} })

    const tc = new TemporalClient()
    await tc.connect()

    expect(mockConnect).toHaveBeenCalledWith({ address: 'localhost:7233' })
  })

  it('connects with apiKey and tls:true when TEMPORAL_API_KEY is set', async () => {
    process.env.TEMPORAL_API_KEY = 'secret-key'
    mockConnect.mockResolvedValue({ workflowService: { getSystemInfo: mockGetSystemInfo } })
    MockClient.mockImplementation(function() { return {} })

    const tc = new TemporalClient()
    await tc.connect()

    expect(mockConnect).toHaveBeenCalledWith({
      address: 'localhost:7233',
      apiKey: 'secret-key',
      tls: true,
    })
  })

  it('connects with mTLS when cert+key paths are set', async () => {
    process.env.TEMPORAL_TLS_CERT_PATH = '/certs/client.crt'
    process.env.TEMPORAL_TLS_KEY_PATH = '/certs/client.key'
    mockReadFileSync
      .mockReturnValueOnce(Buffer.from('CERT'))
      .mockReturnValueOnce(Buffer.from('KEY'))
    mockConnect.mockResolvedValue({ workflowService: { getSystemInfo: mockGetSystemInfo } })
    MockClient.mockImplementation(function() { return {} })

    const tc = new TemporalClient()
    await tc.connect()

    expect(mockConnect).toHaveBeenCalledWith({
      address: 'localhost:7233',
      tls: { clientCertPair: { crt: Buffer.from('CERT'), key: Buffer.from('KEY') } },
    })
  })

  it('throws TemporalConnectionError when cert files cannot be read', async () => {
    process.env.TEMPORAL_TLS_CERT_PATH = '/bad/path.crt'
    process.env.TEMPORAL_TLS_KEY_PATH = '/bad/path.key'
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT') })

    const tc = new TemporalClient()
    await expect(tc.connect()).rejects.toThrow(TemporalConnectionError)
    await expect(tc.connect()).rejects.toThrow('Cannot read TLS certificates')
  })

  it('throws TemporalConnectionError when Connection.connect rejects', async () => {
    mockConnect.mockRejectedValue(new Error('connection refused'))

    const tc = new TemporalClient()
    await expect(tc.connect()).rejects.toThrow(TemporalConnectionError)
    await expect(tc.connect()).rejects.toThrow('Failed to connect to Temporal')
  })

  it('wraps non-Error thrown values in TemporalConnectionError', async () => {
    mockConnect.mockRejectedValue('timeout')

    const tc = new TemporalClient()
    await expect(tc.connect()).rejects.toThrow(TemporalConnectionError)
    await expect(tc.connect()).rejects.toThrow('timeout')
  })
})

// ---------------------------------------------------------------------------

describe('TemporalClient — validateConnection', () => {
  beforeEach(() => {
    mockConnect.mockReset()
    mockGetSystemInfo.mockReset()
    MockClient.mockReset()
    delete process.env.TEMPORAL_API_KEY
    delete process.env.TEMPORAL_TLS_CERT_PATH
    delete process.env.TEMPORAL_TLS_KEY_PATH
  })

  async function connectedClient(): Promise<TemporalClient> {
    const connection = { workflowService: { getSystemInfo: mockGetSystemInfo } }
    mockConnect.mockResolvedValue(connection)
    MockClient.mockImplementation(function() { return {} })
    const tc = new TemporalClient()
    await tc.connect()
    return tc
  }

  it('resolves when getSystemInfo succeeds', async () => {
    const tc = await connectedClient()
    mockGetSystemInfo.mockResolvedValue({})
    await expect(tc.validateConnection()).resolves.toBeUndefined()
  })

  it('throws TemporalConnectionError when getSystemInfo rejects', async () => {
    const tc = await connectedClient()
    mockGetSystemInfo.mockRejectedValue(new Error('deadline exceeded'))
    await expect(tc.validateConnection()).rejects.toThrow(TemporalConnectionError)
    await expect(tc.validateConnection()).rejects.toThrow('Temporal connection validation failed')
  })

  it('wraps non-Error thrown values', async () => {
    const tc = await connectedClient()
    mockGetSystemInfo.mockRejectedValue('network error')
    await expect(tc.validateConnection()).rejects.toThrow(TemporalConnectionError)
    await expect(tc.validateConnection()).rejects.toThrow('network error')
  })
})
