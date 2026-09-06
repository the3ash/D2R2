import { defineConfig } from 'vite-plus'

// WXT owns extension builds in wxt.config.ts; this config owns lint, format, and tests.
export default defineConfig({
  fmt: {
    semi: false,
    singleQuote: true,
  },
  lint: {
    plugins: ['react', 'typescript'],
    env: {
      browser: true,
    },
    globals: {
      chrome: 'readonly',
    },
    categories: {
      correctness: 'error',
      suspicious: 'warn',
    },
    rules: {
      'eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'react/react-in-jsx-scope': 'off',
      'typescript/no-explicit-any': 'warn',
      'react/rules-of-hooks': 'error',
      'react/exhaustive-deps': 'warn',
      'vite-plus/prefer-vite-plus-imports': 'error',
    },
    overrides: [
      {
        files: ['wxt.config.ts', '*.config.{js,mjs,cjs,ts,mts}'],
        env: {
          node: true,
        },
      },
    ],
    jsPlugins: [
      {
        name: 'vite-plus',
        specifier: 'vite-plus/oxlint-plugin',
      },
    ],
  },
})
