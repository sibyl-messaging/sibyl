import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 4173,
    // Local phone tests use a temporary HTTPS tunnel hostname. The relay still
    // validates every helper request; this only lets Vite serve the page.
    allowedHosts: true,
    proxy: {
      "/v2": "http://127.0.0.1:8080"
    }
  }
});
