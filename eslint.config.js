import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'coverage/', 'node_modules/', 'src/infra/repositories/prisma/generated/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Leia variáveis de ambiente só por src/env/.',
        },
      ],
    },
  },
  {
    files: ['src/env/**', '*.config.ts', 'test/**'],
    rules: { 'no-restricted-properties': 'off' },
  },
  prettier,
);
