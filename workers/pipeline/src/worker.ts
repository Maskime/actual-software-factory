import { Worker, NativeConnection } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import * as gitlabActivities from './activities/gitlab.js';
import * as agentActivities from './activities/agents.js';

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? 'factory-pipeline';
const NAMESPACE  = process.env.TEMPORAL_NAMESPACE  ?? 'factory';
const ADDRESS    = process.env.TEMPORAL_ADDRESS    ?? 'localhost:7233';

const connection = await NativeConnection.connect({ address: ADDRESS });

const worker = await Worker.create({
  connection,
  namespace: NAMESPACE,
  workflowsPath: fileURLToPath(new URL('./workflow.js', import.meta.url)),
  activities: { ...gitlabActivities, ...agentActivities },
  taskQueue: TASK_QUEUE,
});

process.on('SIGTERM', () => worker.shutdown());
process.on('SIGINT',  () => worker.shutdown());

process.stderr.write(
  `[pipeline-worker] Started (namespace="${NAMESPACE}", taskQueue="${TASK_QUEUE}", address="${ADDRESS}")\n`
);

await worker.run();
