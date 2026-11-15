import react from '@vitejs/plugin-react-swc';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the MCP Apps widget into a single self-contained HTML file (dist/widget.html).
// MCP hosts render it in a sandboxed iframe, so everything (JS + CSS) must be inlined.
export default defineConfig({
  root: resolve(__dirname, 'widget'),
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false,
    rollupOptions: { input: resolve(__dirname, 'widget/widget.html') },
  },
});
