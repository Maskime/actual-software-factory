import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { consola } from 'consola'
import { getPool, query } from '../utils/db'
import { PROMPT_REGISTRY, type PromptSeed } from '../utils/prompt-registry'

// Depuis apps/server/scripts/, la racine du dépôt est ../../../
const promptsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../workers/prompts')

function resolveContent(entry: PromptSeed): string {
  if ('file' in entry) {
    return readFileSync(join(promptsDir, `${entry.file}.md`), 'utf-8')
  }
  return entry.content
}

async function seed(): Promise<void> {
  let inserted = 0
  let skipped = 0

  for (const entry of PROMPT_REGISTRY) {
    const content = resolveContent(entry)
    // Insertion idempotente : n'insère que si aucune version n'existe déjà pour la clé.
    const res = await query(
      `INSERT INTO prompt_versions (agent_key, label, content, is_active)
       SELECT $1, 'v1', $2, TRUE
       WHERE NOT EXISTS (SELECT 1 FROM prompt_versions WHERE agent_key = $1)`,
      [entry.agentKey, content],
    )
    if (res.rowCount && res.rowCount > 0) {
      inserted += 1
      consola.success(`inséré: ${entry.agentKey} (v1, active)`)
    } else {
      skipped += 1
      consola.info(`déjà présent: ${entry.agentKey} — inchangé`)
    }
  }

  consola.box(`Seed terminé — ${inserted} inséré(s), ${skipped} déjà présent(s)`)
}

try {
  await seed()
} catch (err) {
  consola.error('Échec du seed des prompts:', err)
  process.exitCode = 1
} finally {
  await getPool().end()
}
