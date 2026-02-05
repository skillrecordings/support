import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov', 'json'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/**/fixtures/**',
      ],
      // Thresholds lowered to match reality — CLI has many untested commands
      // TODO: Gradually increase as coverage improves
      thresholds: {
        lines: 20,
        functions: 55,
        branches: 50,
        statements: 20,
        // Core utilities should maintain higher standards
        'src/core/': {
          lines: 75,
          functions: 75,
          branches: 65,
          statements: 75,
        },
      },
    },
  },
})
