import { Worker, NativeConnection } from '@temporalio/worker';
import { createHealthServer } from '@factory/worker-shared';
import { fileURLToPath } from 'node:url';
import webpack from 'webpack';
import * as gitlabActivities from './activities/gitlab.js';

const TASK_QUEUE   = process.env.TEMPORAL_TASK_QUEUE ?? 'factory-pipeline';
const NAMESPACE    = process.env.TEMPORAL_NAMESPACE  ?? 'factory';
const ADDRESS      = process.env.TEMPORAL_ADDRESS    ?? 'localhost:7233';
const HEALTH_PORT  = Number.parseInt(process.env.HEALTH_PORT ?? '9091', 10);

const healthServer = createHealthServer(HEALTH_PORT);

// Activity config env vars are read here (worker process) and injected as
// compile-time string constants into the workflow bundle via DefinePlugin,
// so config.ts can use them regardless of workflow sandbox process access.
const WORKFLOW_ENV_DEFAULTS: Record<string, string> = {
  GITLAB_ACTIVITY_SCHEDULE_TO_CLOSE_TIMEOUT: '10 minutes',
  GITLAB_ACTIVITY_START_TO_CLOSE_TIMEOUT:    '30 seconds',
  GITLAB_ACTIVITY_MAX_ATTEMPTS:              '5',
  GITLAB_ACTIVITY_INITIAL_INTERVAL:          '5s',
  GITLAB_ACTIVITY_BACKOFF_COEFFICIENT:       '2',
  AGENT_TASK_QUEUE:                           'factory-agents',
  AGENT_ACTIVITY_SCHEDULE_TO_CLOSE_TIMEOUT:  '4 hours',
  AGENT_ACTIVITY_START_TO_CLOSE_TIMEOUT:     '60 minutes',
  AGENT_ACTIVITY_HEARTBEAT_TIMEOUT:          '2 minutes',
  AGENT_ACTIVITY_MAX_ATTEMPTS:               '3',
  AGENT_ACTIVITY_INITIAL_INTERVAL:           '30s',
  AGENT_ACTIVITY_BACKOFF_COEFFICIENT:        '2',
  HUMAN_IN_THE_LOOP:                         'false',
  HUMAN_IN_THE_LOOP_TIMEOUT:                 '24 hours',
  SUSPEND_NOTIFICATION:                      'true',
};

const workflowDefines = Object.fromEntries(
  Object.entries(WORKFLOW_ENV_DEFAULTS).map(([key, defaultValue]) => [
    `process.env.${key}`,
    JSON.stringify(process.env[key] ?? defaultValue),
  ])
);

const connection = await NativeConnection.connect({ address: ADDRESS });

const worker = await Worker.create({
  connection,
  namespace: NAMESPACE,
  workflowsPath: fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './workflow.ts' : './workflow.js', import.meta.url)),
  activities: { ...gitlabActivities },
  taskQueue: TASK_QUEUE,
  bundlerOptions: {
    webpackConfigHook(config) {
      config.plugins = [...(config.plugins ?? []), new webpack.DefinePlugin(workflowDefines)];
      return config;
    },
  },
});

process.on('SIGTERM', () => { healthServer.close(); worker.shutdown(); });
process.on('SIGINT',  () => { healthServer.close(); worker.shutdown(); });

process.stderr.write(
  `[pipeline-worker] Started (namespace="${NAMESPACE}", taskQueue="${TASK_QUEUE}", address="${ADDRESS}")\n`
);

await worker.run();
