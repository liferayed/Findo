const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const globals = require('globals');

module.exports = [
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'web/dist/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.jest },
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['web/**/*.{ts,tsx}'],
  })),
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
];
