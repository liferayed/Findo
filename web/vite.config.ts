import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { IncomingMessage } from 'node:http';

// Some paths (e.g. /accounts, /transactions, /documents) are both real API
// endpoints AND client-side React Router routes. A top-level browser
// navigation (hard refresh, bookmark, typed URL) must fall through to the
// SPA shell so client-side routing can take over; a fetch()/AJAX call to the
// same path must still be proxied to the API. Browser navigations send
// `Accept: text/html,...`, while this app's fetch() calls never set that
// header, so we can distinguish the two cases.
function bypassBrowserNavigation(req: IncomingMessage) {
  const accept = req.headers.accept || '';
  if (accept.includes('text/html')) {
    return req.url;
  }
}

// In Docker Compose this is set to `http://api:3000` (the api container's
// service name) — see docker-compose.yml. Defaults to localhost for anyone
// invoking `vite` directly outside Compose.
const apiTarget = process.env.API_PROXY_TARGET || 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/health': apiTarget,
      '/chat': apiTarget,
      '/accounts': { target: apiTarget, bypass: bypassBrowserNavigation },
      '/transactions': { target: apiTarget, bypass: bypassBrowserNavigation },
      '/documents': { target: apiTarget, bypass: bypassBrowserNavigation },
    },
  },
});
