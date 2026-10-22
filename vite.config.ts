import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const cspPlugin = {
  name: "knoux-csp",
  apply: "build" as const,
  transformIndexHtml(html) {
    const csp =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none';";
    return {
      html,
      tags: [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: csp },
          injectTo: "head-prepend",
        },
      ],
    };
  },
};

export default defineConfig({
  base: "./",
  plugins: [react(), cspPlugin],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    minify: "terser",
  },
});
