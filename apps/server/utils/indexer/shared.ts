import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export function parseToolResult<T>(result: Awaited<ReturnType<Client['callTool']>>): T {
  const content = result.content as Array<{ type: string; text: string }>
  if (result.isError) {
    throw new Error(content[0]?.text ?? 'Erreur MCP inconnue')
  }
  return JSON.parse(content[0]?.text ?? 'null') as T
}

export function connectGitlab(mcpUrl: string): Promise<Client> {
  const client = new Client({ name: 'portal-indexer', version: '1.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${mcpUrl}/mcp`))
  return client.connect(transport).then(() => client)
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}
