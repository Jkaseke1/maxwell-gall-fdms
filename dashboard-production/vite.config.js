import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(() => ({
  base: '/',
  plugins: [
    react({
      jsxRuntime: 'automatic',
    }),
  ],
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router-dom'],
    alias: {
      'react': path.resolve(process.cwd(), 'node_modules/react'),
      'react-dom': path.resolve(process.cwd(), 'node_modules/react-dom'),
    },
  },
  server: {
    port: 46157,
    open: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:46158',
        changeOrigin: true,
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
  },
}));


