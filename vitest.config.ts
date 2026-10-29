import { defineConfig } from 'vitest/config';
import { testEnv } from './test/test-env.ts';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    env: { ...testEnv },
    // Os arquivos E2E dividem o mesmo banco: rodam um de cada vez.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
