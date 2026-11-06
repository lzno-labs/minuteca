/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { SHARE_CACHE, SHARE_KEY } from "./lib/shareTarget";

// App shell: every built asset (list injected at build time), so the app
// opens and can record with no connection. API calls are never cached.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//, /^\/__\//, /^\/share-target/],
  }),
);

// Android "Share → Minuteca": the OS POSTs the shared audio file here
// (see share_target in the manifest). Stash it and open the app, which
// picks it up and starts the transcription.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== "/share-target") return;
  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const file = form.getAll("audio").find((f) => f instanceof File);
        if (file) {
          const cache = await caches.open(SHARE_CACHE);
          await cache.put(
            SHARE_KEY,
            new Response(file, {
              headers: {
                "Content-Type": file.type || "application/octet-stream",
                "X-File-Name": encodeURIComponent(file.name || "shared-audio"),
                "X-Last-Modified": String(file.lastModified || Date.now()),
              },
            }),
          );
        }
      } catch {
        // Fall through to the app; nothing to import.
      }
      return Response.redirect("/?shared=1", 303);
    })(),
  );
});

// The page asks for activation explicitly (UpdatePrompt), so a new version
// never reloads the app in the middle of a recording.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
