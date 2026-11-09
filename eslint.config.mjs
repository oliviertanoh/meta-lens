import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'out/', '.vscode-test/', 'node_modules/', 'test/fixtures/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/core/**/*.ts'],
    rules: {
      // core/ must stay testable without VS Code.
      'no-restricted-imports': ['error', { paths: ['vscode'] }],
    },
  },
);
