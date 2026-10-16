import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // lets a tunnel such as ngrok or cloudflared reach the dev server
    allowedHosts: true,
    // the browser only talks to Vite; Vite forwards /api to the backend
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
