import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080" },
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
});
