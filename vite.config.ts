import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = process.env.PORT || 3001;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  server: {
    port: 3000,
    allowedHosts: ["tbd.saltbox.cc"],
    proxy: {
      "/api": `http://localhost:${apiPort}`,
    },
  },
});
