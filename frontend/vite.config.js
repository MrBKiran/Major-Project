import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Bind every interface so a phone on the same Wi-Fi can open the owner app
    // at http://<this-machine-ip>:5173/app. The proxy below is what makes that
    // work with no other change: the phone talks only to Vite, which forwards
    // /api to the backend on loopback — so the backend never has to listen on
    // the network, and its CORS allowlist stays a localhost-only list.
    host: true,
    // Proxy keeps every fetch same-origin, so the pages need no base URL and
    // the backend's CORS allowlist never has to matter during the demo.
    proxy: {
      "/api": { target: "http://localhost:8010", changeOrigin: true },
      "/ws": { target: "ws://localhost:8010", ws: true },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.js"],
    include: ["src/**/*.test.{js,jsx}"],
  },
});
