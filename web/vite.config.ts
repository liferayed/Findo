import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/health': 'http://localhost:3000',
      '/chat': 'http://localhost:3000',
      '/accounts': 'http://localhost:3000',
      '/transactions': 'http://localhost:3000',
    },
  },
});
