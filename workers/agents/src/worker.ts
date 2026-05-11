import { Worker, NativeConnection } from '@temporalio/worker';
import * as setupWorkspaceActivities from './activities/setupWorkspace.js';

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? 'factory-agents';
const NAMESPACE  = process.env.TEMPORAL_NAMESPACE  ?? 'factory';
const ADDRESS    = process.env.TEMPORAL_ADDRESS    ?? 'localhost:7233';

const connection = await NativeConnection.connect({ address: ADDRESS });

const worker = await Worker.create({
  connection,
  namespace: NAMESPACE,
  taskQueue: TASK_QUEUE,
  activities: { ...setupWorkspaceActivities },
});

process.on('SIGTERM', () => worker.shutdown());
process.on('SIGINT',  () => worker.shutdown());

process.stderr.write(
  `[agent-worker] Started (namespace="${NAMESPACE}", taskQueue="${TASK_QUEUE}", address="${ADDRESS}")\n`
);

await worker.run();
