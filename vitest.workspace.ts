import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'mcp/gitlab/vitest.config.ts',
  'mcp/temporal/vitest.config.ts',
  'workers/pipeline/vitest.config.ts',
  'workers/agents/vitest.config.ts',
  'workers/review-worker/vitest.config.ts',
  'workers/review-fix-worker/vitest.config.ts',
  'workers/static-analysis-worker/vitest.config.ts',
  'apps/vitest.config.ts',
])
