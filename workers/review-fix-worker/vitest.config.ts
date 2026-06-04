import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'worker-review-fix',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // worker.ts excluded from coverage reporting for the same reason as other workers:
      // the entry point wires dependencies at startup and cannot produce an unambiguous
      // SF: path in the lcov without causing monorepo path conflicts in SonarQube.
      // The startWorker() function is tested in worker.test.ts.
      exclude: ['src/worker.ts'],
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
})
