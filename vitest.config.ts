import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { LEDGER_KEY: 'test-key-0123456789abcdef0123456789abcdef' },
  },
});
