import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const AUDIO_ACCEPT = ["audio/*", "video/*", ".m4a", ".mp3", ".wav", ".aac", ".ogg", ".opus", ".amr", ".3gp", ".flac", ".webm", ".mp4"];

// The web app lives in src/web and builds to dist/, which the server serves (Node or Workers).
// `npm run dev` proxies /api to a server started with `npm start` on port 8787.
export default defineConfig({
  root: "src/web",
  build: { outDir: "../../dist", emptyOutDir: true },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: ".",
      filename: "sw.js",
      // The app shows its own "new version" banner (UpdatePrompt) instead of
      // auto-reloading, which could interrupt a recording.
      registerType: "prompt",
      injectRegister: false,
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg}", "apple-touch-icon.png"],
      },
      manifest: {
        id: "/",
        name: "minuteca",
        short_name: "minuteca",
        lang: "es",
        description: "Graba reuniones presenciales y obtén la transcripción con el nombre de cada persona.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#f8fafc",
        theme_color: "#4f46e5",
        categories: ["productivity", "business"],
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        // Android: lets other apps share an audio file straight into minuteca.
        share_target: {
          action: "/share-target",
          method: "POST",
          enctype: "multipart/form-data",
          params: { files: [{ name: "audio", accept: AUDIO_ACCEPT }] },
        },
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    proxy: { "/api": "http://127.0.0.1:8787", "/health": "http://127.0.0.1:8787" },
  },
});
