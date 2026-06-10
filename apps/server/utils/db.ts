import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'

let pool: Pool | null = null

function connectionString(): string {
  const cs = process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL
  if (!cs) {
    throw new Error('NUXT_DATABASE_URL (or DATABASE_URL) environment variable is required')
  }
  return cs
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: connectionString() })
  }
  return pool
}

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params)
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}
