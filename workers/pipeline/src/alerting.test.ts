import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted so they are available inside vi.mock() factory
// ---------------------------------------------------------------------------

const { mockConnect, MockClient, mockClose, mockList } = vi.hoisted(() => {
  const mockClose = vi.fn().mockResolvedValue(undefined);
  const mockList = vi.fn();
  const mockDescribe = vi.fn().mockResolvedValue({ typedSearchAttributes: { get: () => 'dev' } });
  const mockGetHandle = vi.fn().mockReturnValue({ describe: mockDescribe });
  const MockClient = vi.fn().mockImplementation(() => ({
    workflow: { list: mockList, getHandle: mockGetHandle },
  }));
  const mockConnect = vi.fn().mockResolvedValue({ close: mockClose });
  return { mockConnect, MockClient, mockClose, mockList, mockDescribe, mockGetHandle };
});

vi.mock('@temporalio/client', () => ({
  Connection: { connect: mockConnect },
  Client: MockClient,
}));

vi.mock('@temporalio/common', () => ({
  defineSearchAttributeKey: vi.fn().mockReturnValue('PipelineStage'),
}));

import { createAlertingMonitor } from './alerting.js';
import type { AlertingConfig } from './alerting.js';

// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<AlertingConfig> = {}): AlertingConfig {
  return {
    enabled: true,
    timeoutMs: 3_600_000, // 60 min
    webhookUrl: 'http://webhook.example.com/alert',
    checkIntervalMs: 600_000,
    address: 'localhost:7233',
    namespace: 'factory',
    ...overrides,
  };
}

function mockRunningWorkflow(workflowId: string, ageMs: number, runId = 'run-1') {
  return {
    workflowId,
    runId,
    type: 'pipelineWorkflow',
    startTime: new Date(Date.now() - ageMs),
  };
}

async function* makeAsyncIterable<T>(items: T[]) {
  for (const item of items) yield item;
}

// ---------------------------------------------------------------------------

describe('createAlertingMonitor — disabled', () => {
  it('returns close() immediately without opening a Temporal connection', () => {
    const monitor = createAlertingMonitor(makeConfig({ enabled: false }));
    monitor.close();
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

describe('createAlertingMonitor — check loop', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    vi.clearAllMocks();
    mockConnect.mockResolvedValue({ close: mockClose });
    (MockClient as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      workflow: {
        list: mockList,
        getHandle: vi.fn().mockReturnValue({
          describe: vi.fn().mockResolvedValue({
            typedSearchAttributes: { get: () => 'dev' },
          }),
        }),
      },
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends webhook for a workflow beyond the threshold', async () => {
    const wf = mockRunningWorkflow('pipeline-issue-42', 4_000_000); // ~66min > 60min
    mockList.mockReturnValue(makeAsyncIterable([wf]));

    const monitor = createAlertingMonitor(makeConfig());
    await vi.runOnlyPendingTimersAsync();
    monitor.close();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://webhook.example.com/alert');
    const body = JSON.parse(opts.body as string);
    expect(body.workflowId).toBe('pipeline-issue-42');
    expect(body.runId).toBe('run-1');
    expect(body.currentStage).toBe('dev');
    expect(body.elapsedMinutes).toBeGreaterThanOrEqual(66);
  });

  it('does not send webhook for a workflow below the threshold', async () => {
    const wf = mockRunningWorkflow('pipeline-issue-10', 1_000_000); // ~16min < 60min
    mockList.mockReturnValue(makeAsyncIterable([wf]));

    const monitor = createAlertingMonitor(makeConfig());
    await vi.runOnlyPendingTimersAsync();
    monitor.close();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not send a second webhook for an already-alerted workflow', async () => {
    const wf = mockRunningWorkflow('pipeline-issue-42', 4_000_000);

    const config = makeConfig();
    const monitor = createAlertingMonitor(config);

    // First tick → alert sent
    mockList.mockReturnValue(makeAsyncIterable([wf]));
    await vi.runOnlyPendingTimersAsync();
    expect(mockFetch).toHaveBeenCalledOnce();

    // Second tick → same workflow still Running, already alerted
    mockList.mockReturnValue(makeAsyncIterable([wf]));
    await vi.runOnlyPendingTimersAsync();
    expect(mockFetch).toHaveBeenCalledOnce(); // still only once

    monitor.close();
  });

  it('purges alerted Set for workflows no longer Running', async () => {
    const wf = mockRunningWorkflow('pipeline-issue-42', 4_000_000);

    const config = makeConfig();
    const monitor = createAlertingMonitor(config);

    // First tick → alerted
    mockList.mockReturnValue(makeAsyncIterable([wf]));
    await vi.runOnlyPendingTimersAsync();
    expect(mockFetch).toHaveBeenCalledOnce();

    // Second tick → workflow no longer Running (purge should happen)
    mockList.mockReturnValue(makeAsyncIterable([]));
    await vi.runOnlyPendingTimersAsync();

    // Third tick → workflow Running again beyond threshold
    const wf2 = mockRunningWorkflow('pipeline-issue-42', 4_000_000);
    mockList.mockReturnValue(makeAsyncIterable([wf2]));
    await vi.runOnlyPendingTimersAsync();
    expect(mockFetch).toHaveBeenCalledTimes(2); // alert re-sent after purge

    monitor.close();
  });

  it('logs webhook error without crashing the check loop', async () => {
    const wf = mockRunningWorkflow('pipeline-issue-99', 4_000_000);
    mockList.mockReturnValue(makeAsyncIterable([wf]));
    mockFetch.mockResolvedValue({ ok: false, status: 500 });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const monitor = createAlertingMonitor(makeConfig());
    await vi.runOnlyPendingTimersAsync();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[alerting] Failed to send webhook'));

    // Second tick still runs (loop not crashed)
    mockList.mockReturnValue(makeAsyncIterable([]));
    await vi.runOnlyPendingTimersAsync();

    monitor.close();
    stderrSpy.mockRestore();
  });

  it('still alerts a workflow with null stage when describe() fails, and continues with others', async () => {
    const wf1 = mockRunningWorkflow('pipeline-issue-1', 4_000_000);
    const wf2 = mockRunningWorkflow('pipeline-issue-2', 4_000_000);
    mockList.mockReturnValue(makeAsyncIterable([wf1, wf2]));

    let callCount = 0;
    (MockClient as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      workflow: {
        list: mockList,
        getHandle: vi.fn().mockImplementation(() => ({
          describe: callCount++ === 0
            ? vi.fn().mockRejectedValue(new Error('not found'))
            : vi.fn().mockResolvedValue({ typedSearchAttributes: { get: () => 'review' } }),
        })),
      },
    }));

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const monitor = createAlertingMonitor(makeConfig());
    await vi.runOnlyPendingTimersAsync();

    // Both workflows alerted: wf1 with null stage, wf2 with 'review'
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('[alerting] Could not describe workflow pipeline-issue-1'),
    );
    const body1 = JSON.parse((mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body1.currentStage).toBeNull();
    const body2 = JSON.parse((mockFetch.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(body2.currentStage).toBe('review');

    monitor.close();
    stderrSpy.mockRestore();
  });

  it('logs Temporal listing error without crashing', async () => {
    mockList.mockImplementation(() => {
      throw new Error('gRPC unavailable');
    });

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const monitor = createAlertingMonitor(makeConfig());
    await vi.runOnlyPendingTimersAsync();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[alerting] Check failed'));
    expect(mockFetch).not.toHaveBeenCalled();

    monitor.close();
    stderrSpy.mockRestore();
  });

  it('close() stops the timer and closes the Temporal connection', async () => {
    const wf = mockRunningWorkflow('pipeline-issue-42', 4_000_000);
    mockList.mockReturnValue(makeAsyncIterable([wf]));

    const monitor = createAlertingMonitor(makeConfig());
    await vi.runOnlyPendingTimersAsync(); // first tick triggers connection

    monitor.close();
    expect(mockClose).toHaveBeenCalled();

    // No more ticks after close
    mockFetch.mockClear();
    await vi.runOnlyPendingTimersAsync();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
