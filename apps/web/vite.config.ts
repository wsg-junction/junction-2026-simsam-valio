import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// Aimo Assistant: the buyer's chat app. Served by the gateway (apps/mcp) at /assistant; in dev, Vite proxies the
// API to the gateway (GATEWAY_URL, default http://localhost:8787).
const gateway = process.env.GATEWAY_URL ?? "http://localhost:8787";

export default defineConfig({
  base: "/assistant/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@gateway": path.resolve(__dirname, "../mcp/src"),
    },
  },
  server: {
    port: 5170,
    proxy: {
      "/api": gateway,
      "/promise": gateway,
    },
  },
});
