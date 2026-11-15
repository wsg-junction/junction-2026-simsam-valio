import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The console is served by the gateway (apps/mcp) at /app. In dev, Vite proxies API calls to the gateway.
const gateway = process.env.GATEWAY_URL ?? 'http://localhost:8787';

export default defineConfig({
  base: '/app/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: {
    port: 5180,
    proxy: {
      '/api': gateway,
      '/quotes': gateway,
      '/.well-known': gateway,
    },
  },
});
