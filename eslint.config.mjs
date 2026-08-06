// Flat ESLint config for the backend workspaces (testing-core + shared). The
// dashboard keeps its own config. This codebase was never linted, so genuinely
// risky rules are errors while stylistic/legacy findings are warnings — lint stays
// green (ESLint fails only on errors) while still surfacing cleanup opportunities.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'developer-dashboard/**',
      'bugsafari-target-app/**',
      '.claude/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      'testing-core/scripts/**',
      'testing-core/testing/**',
      '**/*.test.ts',
      '**/*.spec.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['testing-core/src/**/*.{ts,tsx}', 'shared/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // TypeScript already resolves identifiers (incl. ambient/browser globals in
      // injected scripts) far better than ESLint — no-undef is redundant and wrong here.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      // Never-linted legacy surface — surface, don't block.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-this-alias': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
      // Real bugs — keep as errors.
      'no-cond-assign': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
);
