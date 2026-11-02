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
    // Split large vendor libraries into their own chunks so the main entry
    // stays under the 500 kB warning threshold. Each group below is a
    // dependency that is large enough to justify its own request.
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          "wavesurfer": ["wavesurfer.js"],
          "fabric": ["fabric"],
          "tensorflow": [
            "@tensorflow/tfjs",
            "@tensorflow/tfjs-backend-webgl",
            "@tensorflow/tfjs-converter",
          ],
          "radix-tooltip": ["@radix-ui/react-tooltip"],
          "react-compare-slider": ["react-compare-slider"],
          "react-zoom-pan-pinch": ["react-zoom-pan-pinch"],
          "react-resizable-panels": ["react-resizable-panels"],
          "react-colorful": ["react-colorful"],
        },
      },
    },
  },
});
