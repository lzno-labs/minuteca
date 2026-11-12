// The bridge the minuteca web sees as window.minutecaDesktop (src/web/lib/desktop.js). It runs
// sandboxed and exposes sign-in, local transcription, local models and updates only: no file
// system, no Node.
import { contextBridge, ipcRenderer } from "electron";

type Progress = { step: string; done?: number; total?: number };

let listener: ((p: Progress) => void) | null = null;
ipcRenderer.on("desktop:progress", (_e, p: Progress) => listener?.(p));
const updateListeners = new Set<(u: unknown) => void>();
ipcRenderer.on("desktop:update", (_e, u: unknown) => updateListeners.forEach((f) => f(u)));

async function call(channel: string, ...args: unknown[]) {
  const r = (await ipcRenderer.invoke(channel, ...args)) as { value?: unknown; error?: string } | undefined;
  if (r?.error) throw Object.assign(new Error(r.error), { code: r.error });
  return r?.value;
}

contextBridge.exposeInMainWorld("minutecaDesktop", {
  requestLink: (email: string) => call("desktop:requestLink", String(email)),
  transcribe: async (meetingId: string, onProgress?: (p: Progress) => void, options?: { model?: string }) => {
    listener = typeof onProgress === "function" ? onProgress : null;
    try {
      return await call("desktop:transcribe", String(meetingId), { model: typeof options?.model === "string" ? options.model : undefined });
    } finally {
      listener = null;
    }
  },
  // Local speech models (ADR 0007): this computer, the catalog, and downloading or deleting one.
  models: () => call("desktop:models"),
  downloadModel: async (id: string, onProgress?: (p: Progress) => void) => {
    listener = typeof onProgress === "function" ? onProgress : null;
    try {
      return await call("desktop:model", "download", String(id));
    } finally {
      listener = null;
    }
  },
  deleteModel: (id: string) => call("desktop:model", "delete", String(id)),
  cancel: () => ipcRenderer.send("desktop:cancel"),
  // Version and updates: the web shows them in Settings.
  info: () => call("desktop:info"),
  checkForUpdates: () => call("desktop:checkUpdates"),
  installUpdate: () => call("desktop:installUpdate"),
  onUpdate: (f: (u: unknown) => void) => {
    if (typeof f !== "function") return () => {};
    updateListeners.add(f);
    return () => updateListeners.delete(f);
  },
});
