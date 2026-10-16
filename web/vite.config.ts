import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // During development the API runs on :3000. Proxying keeps everything on one
    // origin, so the session cookie and the WebSocket work exactly like in production.
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
});
