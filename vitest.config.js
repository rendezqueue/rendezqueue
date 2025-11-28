
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    setupFiles: ['test/setup.js'],
    // Ensure tests run in an environment where process.env can be mutated per-test-file
    // Vitest runs test files in worker threads, so modifications to process.env in setupFiles
    // will be local to that worker (and thus that test file), which is perfect.
    testTimeout: 30000, // Increase timeout for integration tests
  },
});
