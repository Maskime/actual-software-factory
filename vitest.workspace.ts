import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'mcp/gitlab/vitest.config.ts',
  'mcp/temporal/vitest.config.ts',
  'apps/vitest.config.ts',
])
