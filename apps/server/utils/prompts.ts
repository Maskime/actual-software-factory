import { query } from './db'

export async function getActivePrompt(agentKey: string): Promise<string | null> {
  const res = await query<{ content: string }>(
    `SELECT content FROM prompt_versions
     WHERE agent_key = $1 AND is_active = TRUE
     ORDER BY created_at DESC LIMIT 1`,
    [agentKey],
  )
  return res.rows[0]?.content ?? null
}
