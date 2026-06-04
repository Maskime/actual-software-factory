import { createServer, type Server } from 'node:http';
import { Connection, Client, WorkflowNotFoundError } from '@temporalio/client';
import type { SonarqubeScanResult } from './types.js';

interface GitlabPipelinePayload {
  object_kind: string;
  object_attributes: { status: string; ref: string };
  project: { id: number };
}

export function extractIssueIid(branchName: string): number | null {
  const match = /^feature\/(\d+)(?:-|$)/.exec(branchName);
  return match ? Number.parseInt(match[1], 10) : null;
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
  });
}

export async function createWebhookServer(
  port: number,
  secret: string,
  namespace: string,
  address: string,
): Promise<{ server: Server; close: () => Promise<void> }> {
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });

  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/webhook/gitlab-ci') {
      res.writeHead(404).end();
      return;
    }

    if (secret) {
      const token = req.headers['x-gitlab-token'];
      if (token !== secret) {
        res.writeHead(401).end('Unauthorized');
        return;
      }
    }

    const body = await readBody(req);
    let payload: GitlabPipelinePayload;
    try {
      payload = JSON.parse(body) as GitlabPipelinePayload;
    } catch {
      res.writeHead(400).end('Invalid JSON');
      return;
    }

    if (payload.object_kind !== 'pipeline') {
      res.writeHead(200).end('Ignored');
      return;
    }

    const { status, ref: branchName } = payload.object_attributes;
    if (status !== 'success' && status !== 'failed') {
      res.writeHead(200).end('Ignored');
      return;
    }

    const issueIid = extractIssueIid(branchName);
    if (issueIid === null) {
      process.stderr.write(`[webhook] Branch "${branchName}" does not match feature/{issueIid} pattern — ignored\n`);
      res.writeHead(200).end('Ignored');
      return;
    }

    const workflowId = `pipeline-issue-${issueIid}`;
    const signal: SonarqubeScanResult = {
      status: status === 'success' ? 'passed' : 'failed',
      sonarqubePrKey: branchName,
    };

    try {
      const handle = client.workflow.getHandle(workflowId);
      await handle.signal('sonarqube-scan-completed', signal);
      process.stderr.write(`[webhook] Signal sonarqube-scan-completed(${signal.status}) → ${workflowId}\n`);
      res.writeHead(200).end('OK');
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) {
        process.stderr.write(`[webhook] Workflow ${workflowId} not found — ignored\n`);
        res.writeHead(200).end('Workflow not found');
        return;
      }
      process.stderr.write(`[webhook] Failed to signal ${workflowId}: ${err}\n`);
      res.writeHead(500).end('Internal Server Error');
    }
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));

  return {
    server,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await connection.close();
    },
  };
}
