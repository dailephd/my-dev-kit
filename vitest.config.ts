import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.spec.ts'],
    exclude: ['tests/**/fixtures/**'],
    testTimeout: 20000,
    hookTimeout: 20000,
    // CLI-heavy integration suites launch real Node processes. Cap file workers to
    // avoid CPU contention turning otherwise-valid 20s tests into false timeouts.
    maxWorkers: 4,
  },
})
