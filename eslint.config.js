// eslint.config.js
import globals from 'globals';

export default [
  // Ignore build output
  {
    ignores: [
      'samples/**',
      'locales/**',
      'node_modules/**',
      'package-lock.json',
      'dist/**',
      'extension.zip'
    ]
  },

  // All extension JS runs in browser-like env
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        chrome: 'readonly',
        browser: 'readonly'
      }
    },
    rules: {
      // Clean-code basics
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-var': 'error',
      'prefer-const': 'warn',
      eqeqeq: 'off',
      indent: ['error', 2, { SwitchCase: 1 }],
      semi: ['error', 'always'],


      // Optional: keep logs in extension (tắt nếu muốn strict)
      'no-console': 'off'
    }
  }
];
