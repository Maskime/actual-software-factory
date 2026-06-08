import { Connection, Client } from '@temporalio/client';
import { defineSearchAttributeKey } from '@temporalio/common';

const pipelineStageKey = defineSearchAttributeKey('PipelineStage', 'KEYWORD');

export interface AlertingConfig {
  enabled: boolean;
  timeoutMs: number;
  webhookUrl: string;
  checkIntervalMs: number;
  address: string;
  namespace: string;
}

export interface AlertMonitor {
  close: () => void;
}

interface AlertPayload {
  workflowId: string;
  runId: string;
  currentStage: string | null;
  elapsedMinutes: number;
}

async function sendWebhook(url: string, payload: AlertPayload): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Webhook returned HTTP ${res.status}`);
}

export function createAlertingMonitor(config: AlertingConfig): AlertMonitor {
  if (!config.enabled) return { close: () => undefined };

  let timer: ReturnType<typeof setTimeout> | null = null;
  let connection: Connection | null = null;
  let closed = false;

  const alerted = new Set<string>();

  async function check(): Promise<void> {
    if (closed) return;

    try {
      if (!connection) {
        connection = await Connection.connect({ address: config.address });
      }
      const client = new Client({ connection, namespace: config.namespace });
      const now = Date.now();
      const runningIds = new Set<string>();

      type BlockedEntry = { workflowId: string; runId: string; startTime: Date };
      const blocked: BlockedEntry[] = [];

      for await (const execution of client.workflow.list({
        query: 'ExecutionStatus = "Running" AND WorkflowType = "pipelineWorkflow"',
      })) {
        runningIds.add(execution.workflowId);
        const elapsed = now - execution.startTime.getTime();
        if (elapsed >= config.timeoutMs && !alerted.has(execution.workflowId)) {
          blocked.push({ workflowId: execution.workflowId, runId: execution.runId, startTime: execution.startTime });
        }
      }

      // Prune alerted set: remove IDs no longer Running
      for (const id of alerted) {
        if (!runningIds.has(id)) alerted.delete(id);
      }

      for (const { workflowId, runId, startTime } of blocked) {
        let currentStage: string | null = null;
        try {
          const desc = await client.workflow.getHandle(workflowId, runId).describe();
          currentStage = desc.typedSearchAttributes?.get(pipelineStageKey) ?? null;
        } catch (descErr) {
          process.stderr.write(
            `[alerting] Could not describe workflow ${workflowId}: ${descErr instanceof Error ? descErr.message : String(descErr)}\n`,
          );
        }

        const elapsedMinutes = Math.floor((now - startTime.getTime()) / 60_000);
        try {
          await sendWebhook(config.webhookUrl, { workflowId, runId, currentStage, elapsedMinutes });
          alerted.add(workflowId);
          process.stderr.write(
            `[alerting] Alert sent for blocked workflow ${workflowId} (${elapsedMinutes}min, stage=${currentStage ?? 'unknown'})\n`,
          );
        } catch (webhookErr) {
          process.stderr.write(
            `[alerting] Failed to send webhook for ${workflowId}: ${webhookErr instanceof Error ? webhookErr.message : String(webhookErr)}\n`,
          );
        }
      }
    } catch (err) {
      process.stderr.write(
        `[alerting] Check failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }

    if (!closed) {
      timer = setTimeout(() => check(), config.checkIntervalMs);
    }
  }

  timer = setTimeout(() => check(), config.checkIntervalMs);

  return {
    close: () => {
      closed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      connection?.close().catch(() => undefined);
    },
  };
}
