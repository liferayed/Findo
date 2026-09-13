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

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/health': 'http://localhost:3000',
      '/chat': 'http://localhost:3000',
      '/accounts': { target: 'http://localhost:3000', bypass: bypassBrowserNavigation },
      '/transactions': { target: 'http://localhost:3000', bypass: bypassBrowserNavigation },
      '/documents': { target: 'http://localhost:3000', bypass: bypassBrowserNavigation },
    },
  },
});
