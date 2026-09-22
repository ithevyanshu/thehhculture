import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// In dev, /api is proxied to the backend so auth cookies stay same-origin.
// In production, set VITE_API_URL to the deployed API (e.g. https://api.example.com/api/v1).
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    /**
     * Installable app: "Add to home screen" on Android and iOS, own icon, no address
     * bar, and the shell loads from the device so it opens instantly and offline.
     *
     * The service worker precaches the built shell and caches fonts and cover art.
     * API responses are deliberately NOT cached: they are per-user and change often.
     * If offline browsing is wanted later, add a NetworkFirst rule for the public GETs
     * here and clear the cache on logout.
     */
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'DHH/CULTURE - Indian hip hop',
        short_name: 'DHH/CULTURE',
        description: 'The home of Indian hip hop. Artists, songs, scenes and your personal feed.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f2ecdf',
        theme_color: '#f2ecdf',
        lang: 'en-IN',
        categories: ['music', 'entertainment'],
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Long-press the app icon to jump straight in.
        shortcuts: [
          { name: 'Search', url: '/search' },
          { name: 'Artists', url: '/artists' },
          { name: 'Songs', url: '/songs' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Every route is served by the SPA shell; the API lives on another origin.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Cover art comes from Apple's CDN and never changes for a given URL.
            urlPattern: /^https:\/\/[a-z0-9-]+\.mzstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cover-art',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      // The service worker would cache dev assets and confuse hot reload.
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:4000', changeOrigin: true },
    },
  },
});
