/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Тёплая 2048 — клиентская статика. Контент-JSON лежит вне src, но в корне проекта,
// поэтому Vite его спокойно импортирует.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, host: true },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
