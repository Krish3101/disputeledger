import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { LEDGER_KEY: 'test-key' },
  },
});
