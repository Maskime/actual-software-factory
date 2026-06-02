import { Worker, NativeConnection } from '@temporalio/worker';
import { createHealthServer } from '@factory/worker-shared';
import * as setupWorkspaceActivities from './activities/setupWorkspace.js';
import * as devAgentActivities from './activities/devAgent.js';

const TASK_QUEUE   = process.env.TEMPORAL_TASK_QUEUE ?? 'factory-agents';
const NAMESPACE    = process.env.TEMPORAL_NAMESPACE  ?? 'factory';
const ADDRESS      = process.env.TEMPORAL_ADDRESS    ?? 'localhost:7233';
const HEALTH_PORT  = Number.parseInt(process.env.HEALTH_PORT ?? '9090', 10);

const healthServer = createHealthServer(HEALTH_PORT);

const connection = await NativeConnection.connect({ address: ADDRESS });

const worker = await Worker.create({
  connection,
  namespace: NAMESPACE,
  taskQueue: TASK_QUEUE,
  activities: { ...setupWorkspaceActivities, ...devAgentActivities },
});

process.on('SIGTERM', () => { healthServer.close(); worker.shutdown(); });
process.on('SIGINT',  () => { healthServer.close(); worker.shutdown(); });

process.stderr.write(
  `[agent-worker] Started (namespace="${NAMESPACE}", taskQueue="${TASK_QUEUE}", address="${ADDRESS}")\n`
);

await worker.run();
