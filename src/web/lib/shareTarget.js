/** Hand-off between the service worker's share target and the app. */
export const SHARE_CACHE = "minuteca-share";
export const SHARE_KEY = "/__shared-file";

/**
 * Returns the file shared to the app from another app (Android share
 * sheet), or null, and clears it so it is imported only once.
 */
export async function takeSharedFile() {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(SHARE_CACHE);
    const res = await cache.match(SHARE_KEY);
    if (!res) return null;
    await cache.delete(SHARE_KEY);
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get("X-File-Name") || "shared-audio");
    const lastModified = Number(res.headers.get("X-Last-Modified")) || Date.now();
    return new File([blob], name, { type: blob.type, lastModified });
  } catch {
    return null;
  }
}
