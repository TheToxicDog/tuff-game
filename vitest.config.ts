import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'shared/src/**/*.test.ts',
      'server/src/**/*.test.ts',
      'client/src/**/*.test.ts',
      'ironwild/shared/src/**/*.test.ts',
      'ironwild/server/src/**/*.test.ts',
      'ironwild/client/src/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 20_000,
  },
});
