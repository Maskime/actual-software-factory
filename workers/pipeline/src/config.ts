import type { ActivityOptions } from '@temporalio/workflow';
import type { Duration } from '@temporalio/common';

// process.env references here are replaced at bundle time by webpack's DefinePlugin
// (configured in worker.ts), ensuring they are resolved in the worker process
// before the workflow sandbox is entered.

export function gitlabActivityOptions(): ActivityOptions {
  return {
    scheduleToCloseTimeout: process.env.GITLAB_ACTIVITY_SCHEDULE_TO_CLOSE_TIMEOUT ?? '10 minutes',
    startToCloseTimeout:    process.env.GITLAB_ACTIVITY_START_TO_CLOSE_TIMEOUT    ?? '30 seconds',
    retry: {
      maximumAttempts:        Number(process.env.GITLAB_ACTIVITY_MAX_ATTEMPTS          ?? '5'),
      initialInterval:        process.env.GITLAB_ACTIVITY_INITIAL_INTERVAL             ?? '5s',
      backoffCoefficient:     Number(process.env.GITLAB_ACTIVITY_BACKOFF_COEFFICIENT   ?? '2'),
      nonRetryableErrorTypes: ['GitLabClientError'],
    },
  };
}

export function agentActivityOptions(): ActivityOptions {
  return {
    taskQueue:              process.env.AGENT_TASK_QUEUE                         ?? 'factory-agents',
    scheduleToCloseTimeout: process.env.AGENT_ACTIVITY_SCHEDULE_TO_CLOSE_TIMEOUT ?? '4 hours',
    startToCloseTimeout:    process.env.AGENT_ACTIVITY_START_TO_CLOSE_TIMEOUT    ?? '60 minutes',
    heartbeatTimeout:       process.env.AGENT_ACTIVITY_HEARTBEAT_TIMEOUT         ?? '2 minutes',
    retry: {
      maximumAttempts:        Number(process.env.AGENT_ACTIVITY_MAX_ATTEMPTS         ?? '3'),
      initialInterval:        process.env.AGENT_ACTIVITY_INITIAL_INTERVAL            ?? '30s',
      backoffCoefficient:     Number(process.env.AGENT_ACTIVITY_BACKOFF_COEFFICIENT  ?? '2'),
      nonRetryableErrorTypes: ['EmptyImplementationError', 'VerificationError', 'MaxIterationsError', 'MrCreationError'],
    },
  };
}

export function humanInTheLoopConfig(): { enabled: boolean; timeout: Duration } {
  return {
    enabled: process.env.HUMAN_IN_THE_LOOP === 'true',
    timeout: (process.env.HUMAN_IN_THE_LOOP_TIMEOUT ?? '24 hours') as Duration,
  };
}

export function suspendNotificationConfig(): { enabled: boolean } {
  return { enabled: process.env.SUSPEND_NOTIFICATION !== 'false' };
}
