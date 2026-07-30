import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API and the X OAuth dance live on the Selkie server; proxy them in dev
// so cookies stay same-origin and the browser never sees a ledger token.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/auth": "http://localhost:4000",
    },
  },
  build: {
    outDir: "dist",
  },
});
