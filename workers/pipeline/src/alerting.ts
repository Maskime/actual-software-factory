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

interface BlockedEntry {
  workflowId: string;
  runId: string;
  startTime: Date;
}

async function sendWebhook(url: string, payload: AlertPayload): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Webhook returned HTTP ${res.status}`);
}

async function fetchStage(client: Client, workflowId: string, runId: string): Promise<string | null> {
  try {
    const desc = await client.workflow.getHandle(workflowId, runId).describe();
    return desc.typedSearchAttributes?.get(pipelineStageKey) ?? null;
  } catch (err) {
    process.stderr.write(
      `[alerting] Could not describe workflow ${workflowId}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
}

async function alertOne(
  client: Client, webhookUrl: string, alerted: Set<string>,
  { workflowId, runId, startTime }: BlockedEntry, now: number,
): Promise<void> {
  const currentStage = await fetchStage(client, workflowId, runId);
  const elapsedMinutes = Math.floor((now - startTime.getTime()) / 60_000);
  try {
    await sendWebhook(webhookUrl, { workflowId, runId, currentStage, elapsedMinutes });
    alerted.add(workflowId);
    process.stderr.write(
      `[alerting] Alert sent for blocked workflow ${workflowId} (${elapsedMinutes}min, stage=${currentStage ?? 'unknown'})\n`,
    );
  } catch (err) {
    process.stderr.write(
      `[alerting] Failed to send webhook for ${workflowId}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

async function collectBlocked(
  client: Client, timeoutMs: number, alerted: Set<string>, now: number,
): Promise<{ blocked: BlockedEntry[]; runningIds: Set<string> }> {
  const runningIds = new Set<string>();
  const blocked: BlockedEntry[] = [];
  for await (const execution of client.workflow.list({
    query: 'ExecutionStatus = "Running" AND WorkflowType = "pipelineWorkflow"',
  })) {
    runningIds.add(execution.workflowId);
    if (now - execution.startTime.getTime() >= timeoutMs && !alerted.has(execution.workflowId)) {
      blocked.push({ workflowId: execution.workflowId, runId: execution.runId, startTime: execution.startTime });
    }
  }
  return { blocked, runningIds };
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

      const { blocked, runningIds } = await collectBlocked(client, config.timeoutMs, alerted, now);

      for (const id of alerted) {
        if (!runningIds.has(id)) alerted.delete(id);
      }

      for (const entry of blocked) {
        await alertOne(client, config.webhookUrl, alerted, entry, now);
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
