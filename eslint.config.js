import js from '@eslint/js';
import globals from 'globals';

export default [
  // Ignore generated and third-party folders
  {
    ignores: ['node_modules/', 'payload_logs/', 'dist/', 'build/', 'coverage/'],
  },
  // Base recommended rules
  js.configs.recommended,
  // Project language options and any local rules
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // Relax rules to match existing codebase without churn
      'no-empty': 'off',
      'no-unused-vars': 'off',
      'no-func-assign': 'off',
    },
  },
];
