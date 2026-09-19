import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In dev, /api is proxied to the backend so auth cookies stay same-origin.
// In production, set VITE_API_URL to the deployed API (e.g. https://api.example.com/api/v1).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:4000', changeOrigin: true },
    },
  },
});
