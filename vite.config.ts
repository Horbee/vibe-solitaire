import { defineConfig } from "vite-plus";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Solitaire",
        short_name: "Solitaire",
        description: "Classic Klondike solitaire rendered in WebGL. Fully playable offline.",
        theme_color: "#123c1f",
        background_color: "#123c1f",
        display: "standalone",
        orientation: "any",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Three.js chunk is ~560 kB; raise the default 2 MB precache ceiling.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  fmt: {},
  build: {
    // The single three.js chunk is intentionally large; it is precached by
    // the service worker, so the size warning is noise.
    chunkSizeWarningLimit: 900,
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
