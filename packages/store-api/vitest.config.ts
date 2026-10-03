import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], pool: 'threads', maxWorkers: 2, minWorkers: 1 },
});
