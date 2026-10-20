const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'data/**'] },
  js.configs.recommended,
  { rules: { 'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }] } },
  { files: ['src/**/*.js', 'tests/**/*.js', 'eslint.config.js'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, fetch: 'readonly' } } },
  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, io: 'readonly' } },
    // app.js defines globals used by inline onclick handlers in generated HTML
    rules: { 'no-unused-vars': 'off', 'no-empty': 'off', 'no-undef': 'off' },
  },
];
