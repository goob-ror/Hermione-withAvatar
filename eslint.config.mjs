import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // The codebase leans on `any` at API/JSON boundaries; zod validation is
      // replacing those step by step — warn instead of failing the build.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // console.warn/error are the server log; stray console.log is not.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // React Compiler guidance. They flag "load when a dialog opens" effects and
      // the latest-callback-in-a-ref pattern, which work correctly today; kept
      // visible as warnings until those components are refactored.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  {
    // Node scripts and tests may log freely.
    files: ['scripts/**', 'tests/**'],
    rules: { 'no-console': 'off' },
  },
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'PiperTTS/**',
    'public/**/*.min.js',
    '.hermione/**',
    'next-env.d.ts',
  ]),
])
