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
