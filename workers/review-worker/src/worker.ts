import { Worker, NativeConnection } from '@temporalio/worker';
import { createHealthServer } from '@factory/worker-shared';
import * as reviewCodeActivities from './activities/reviewCode.js';

export async function startWorker(env: Record<string, string | undefined> = process.env): Promise<void> {
  const taskQueue  = env.TEMPORAL_TASK_QUEUE ?? 'review-agent';
  const namespace  = env.TEMPORAL_NAMESPACE  ?? 'factory';
  const address    = env.TEMPORAL_ADDRESS    ?? 'localhost:7233';
  const healthPort = Number.parseInt(env.HEALTH_PORT ?? '9092', 10);

  const healthServer = createHealthServer(healthPort);
  const connection   = await NativeConnection.connect({ address });

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    activities: { ...reviewCodeActivities },
  });

  process.on('SIGTERM', () => { healthServer.close(); worker.shutdown(); });
  process.on('SIGINT',  () => { healthServer.close(); worker.shutdown(); });

  process.stderr.write(
    `[review-worker] Started (namespace="${namespace}", taskQueue="${taskQueue}", address="${address}")\n`
  );

  await worker.run();
}

// Auto-start uniquement hors contexte de test (Vitest positionne process.env.VITEST)
if (!process.env.VITEST) {
  await startWorker();
}
