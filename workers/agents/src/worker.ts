import { Worker, NativeConnection } from '@temporalio/worker';

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? 'factory-agents';
const NAMESPACE  = process.env.TEMPORAL_NAMESPACE  ?? 'factory';
const ADDRESS    = process.env.TEMPORAL_ADDRESS    ?? 'localhost:7233';

const connection = await NativeConnection.connect({ address: ADDRESS });

// No activities registered yet — they will be added in EPIC-05 through EPIC-09.
// Each epic will import and register its agent activities here.
const worker = await Worker.create({
  connection,
  namespace: NAMESPACE,
  taskQueue: TASK_QUEUE,
  activities: {},
});

process.on('SIGTERM', () => worker.shutdown());
process.on('SIGINT',  () => worker.shutdown());

process.stderr.write(
  `[agent-worker] Started (namespace="${NAMESPACE}", taskQueue="${TASK_QUEUE}", address="${ADDRESS}")\n`
);

await worker.run();
