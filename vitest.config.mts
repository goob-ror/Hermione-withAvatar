import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': path.dirname(fileURLToPath(import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Never touch the operator's real .hermione store, providers or Ollama.
    env: {
      HERMIONE_CONFIG_DIR: path.join(os.tmpdir(), `hermione-vitest-${process.pid}`),
      OLLAMA_HOST: 'http://127.0.0.1:9',
      AGENT_ALLOWED_DOMAINS: '*',
    },
    testTimeout: 20_000,
  },
})
