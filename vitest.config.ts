import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['backend/**/*.test.ts', 'infrastructure/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cdk.out/**',
      'kite-window-chatgpt-project/**',
    ],
  },
});
