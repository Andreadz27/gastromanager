// Lint: errores reales (variables sin definir, claves duplicadas, código inalcanzable...), no estilo.
// npm run lint
'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/', 'data/', 'demo/', '_respaldos/', '_retirado/', 'logs/', '*.bak-*']
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }]
    }
  },
  {
    // Frontend sin build: los archivos comparten funciones globales entre sí (api.js, app.js...)
    files: ['public/**/*.js', 'landing/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, io: 'readonly' } },
    rules: { 'no-undef': 'off', 'no-unused-vars': 'off', 'no-redeclare': 'off', 'no-useless-escape': 'off' }
  },
  {
    // Código que corre dentro del navegador desde los tests e2e y los scripts de demo (page.evaluate)
    files: ['test/e2e/**/*.js', 'scripts/demo/**/*.js'],
    languageOptions: { globals: { ...globals.browser, App: 'readonly', Pedidos: 'readonly' } }
  }
];
