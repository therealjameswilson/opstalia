import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/opstalia/" : "/",
  plugins: [react()],
  build: {
    sourcemap: true,
    target: "es2022",
    reportCompressedSize: true
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    }
  }
}));
