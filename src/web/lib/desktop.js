/**
 * The desktop app (desktop/, docs/adr/0005) shows this same web app and adds a small bridge,
 * window.minutecaDesktop. The web adapts only where the bridge is present: sign-in through the
 * app and transcription on the computer. In a browser nothing here changes.
 */
export function desktopBridge() {
  return (typeof window !== "undefined" && window.minutecaDesktop) || null;
}

/** Progress from the bridge to a translation key and its values. */
export function progressText(p) {
  if (!p) return { key: "local.starting", values: {} };
  const mb = (n) => Math.round((n || 0) / 1e6);
  switch (p.step) {
    case "models":
      return { key: "local.models", values: { done: mb(p.done), total: mb(p.total) } };
    case "text":
      return { key: "local.text", values: { done: p.done ?? 0, total: p.total ?? 0 } };
    case "audio":
    case "decode":
    case "voices":
    case "save":
      return { key: `local.${p.step}`, values: {} };
    default:
      return { key: "local.starting", values: {} };
  }
}

/** Where the desktop app is published: GitHub Releases of the open core (docs/adr/0005). */
export const RELEASES = "https://github.com/lzno-labs/minuteca/releases";

/** Which installer to offer first, from the browser's own description. */
export function detectOs(userAgent = "") {
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(userAgent) && !/iPhone|iPad/i.test(userAgent)) return "mac";
  return null;
}

/** Installer names, as desktop/electron-builder.yml writes them: the same in every release. */
export const installerFile = (kind) => (kind === "windows" ? "minuteca-windows-x64.exe" : `minuteca-mac-${kind === "mac-intel" ? "x64" : "arm64"}.dmg`);

/** GitHub sends the newest release's file for this link. */
export const installerUrl = (kind) => `${RELEASES}/latest/download/${installerFile(kind)}`;
