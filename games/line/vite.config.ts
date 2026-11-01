import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, host: '0.0.0.0' },
  define: {
    __TARGET__: JSON.stringify(process.env.TARGET ?? 'web'),
    __API_BASE__: JSON.stringify(process.env.API_BASE ?? 'http://127.0.0.1:8080'),
  },
  build: { target: 'es2017', outDir: 'dist', assetsInlineLimit: 0 },
});
