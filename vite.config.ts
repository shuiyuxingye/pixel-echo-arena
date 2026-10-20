import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    port: 5343,
    strictPort: true,
  },
  preview: {
    port: 5343,
    strictPort: true,
  },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    css: false,
  },
});
