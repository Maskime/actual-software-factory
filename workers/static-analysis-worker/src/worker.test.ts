import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRun, mockShutdown, mockCreate, mockConnect, mockClose, mockHealth } = vi.hoisted(() => ({
  mockRun:      vi.fn().mockResolvedValue(undefined),
  mockShutdown: vi.fn(),
  mockCreate:   vi.fn(),
  mockConnect:  vi.fn(),
  mockClose:    vi.fn(),
  mockHealth:   vi.fn(),
}));

vi.mock('@temporalio/worker', () => ({
  Worker:           { create: mockCreate  },
  NativeConnection: { connect: mockConnect },
}));

vi.mock('@factory/worker-shared', () => ({
  createHealthServer: mockHealth,
}));

vi.mock('./activities/staticAnalysisAgent.js', () => ({
  runStaticAnalysisAgent: vi.fn(),
}));

vi.mock('./activities/verifyAndMerge.js', () => ({
  runVerifyAndMergeAgent: vi.fn(),
}));

import { startWorker } from './worker.js';

describe('startWorker', () => {
  beforeEach(() => {
    mockConnect.mockResolvedValue({});
    mockCreate.mockResolvedValue({ run: mockRun, shutdown: mockShutdown });
    mockHealth.mockReturnValue({ close: mockClose });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses default values when env vars are absent', async () => {
    await startWorker({});

    expect(mockHealth).toHaveBeenCalledWith(9094);
    expect(mockConnect).toHaveBeenCalledWith({ address: 'localhost:7233' });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      namespace: 'factory',
      taskQueue: 'static-analysis-agent',
    }));
    expect(mockRun).toHaveBeenCalled();
  });

  it('reads TEMPORAL_TASK_QUEUE, TEMPORAL_NAMESPACE, TEMPORAL_ADDRESS, HEALTH_PORT from env', async () => {
    await startWorker({
      TEMPORAL_TASK_QUEUE: 'custom-queue',
      TEMPORAL_NAMESPACE:  'custom-ns',
      TEMPORAL_ADDRESS:    'custom:7233',
      HEALTH_PORT:         '8080',
    });

    expect(mockHealth).toHaveBeenCalledWith(8080);
    expect(mockConnect).toHaveBeenCalledWith({ address: 'custom:7233' });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      namespace: 'custom-ns',
      taskQueue: 'custom-queue',
    }));
  });

  it('passes runStaticAnalysisAgent and runVerifyAndMergeAgent activities to Worker.create', async () => {
    await startWorker({});

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        activities: expect.objectContaining({
          runStaticAnalysisAgent: expect.any(Function),
          runVerifyAndMergeAgent: expect.any(Function),
        }),
      })
    );
  });

  it('registers SIGTERM and SIGINT handlers', async () => {
    const onSpy = vi.spyOn(process, 'on');
    await startWorker({});

    expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    onSpy.mockRestore();
  });
});
