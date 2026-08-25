import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  publicDir: path.resolve(__dirname, 'public'),
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@features': path.resolve(__dirname, 'src/features'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@app': path.resolve(__dirname, 'src'),
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    cors: true,
    watch: {
      ignored: [
        '**/node_modules/**',
        '**/functions/node_modules/**',
        '**/public/**',
        '**/dist/**',
        '**/.git/**'
      ]
    }
  }
});
