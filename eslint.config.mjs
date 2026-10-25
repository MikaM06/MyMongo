import gts from 'gts';
import globals from 'globals';
import {defineConfig} from 'eslint/config';

export default defineConfig([
  {ignores: ['**/dist/', '**/build/', '**/node_modules/', 'data/']},
  ...gts,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: null,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: {jsx: true},
      },
    },
    rules: {
      'n/no-unpublished-import': 'off',
      'n/no-missing-import': 'off',
      'n/no-extraneous-import': 'off',
      'n/no-unsupported-features/node-builtins': 'off',
      'n/no-process-exit': 'off',
      'n/hashbang': 'off',
    },
  },
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: {globals: globals.browser},
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {sourceType: 'module', globals: globals.node},
  },
]);
