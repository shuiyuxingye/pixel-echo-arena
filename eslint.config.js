import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      '.local/**',
      '.cdp-browser/**',
      '.claude/**',
      '.memory/**',
      'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'vite.config.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // 试玩机器人运行在浏览器页面内，由 playtest.mjs 注入。
    files: ['tools/playtest/bot.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
);
