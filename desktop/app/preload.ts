// The bridge the minuteca web sees as window.minutecaDesktop (src/web/lib/desktop.js). It runs
// sandboxed, exposes three calls and nothing else: no file system, no Node, no network.
import { contextBridge, ipcRenderer } from "electron";

type Progress = { step: string; done?: number; total?: number };

let listener: ((p: Progress) => void) | null = null;
ipcRenderer.on("desktop:progress", (_e, p: Progress) => listener?.(p));

async function call(channel: string, ...args: unknown[]) {
  const r = (await ipcRenderer.invoke(channel, ...args)) as { value?: unknown; error?: string } | undefined;
  if (r?.error) throw Object.assign(new Error(r.error), { code: r.error });
  return r?.value;
}

contextBridge.exposeInMainWorld("minutecaDesktop", {
  requestLink: (email: string) => call("desktop:requestLink", String(email)),
  transcribe: async (meetingId: string, onProgress?: (p: Progress) => void) => {
    listener = typeof onProgress === "function" ? onProgress : null;
    try {
      return await call("desktop:transcribe", String(meetingId));
    } finally {
      listener = null;
    }
  },
  cancel: () => ipcRenderer.send("desktop:cancel"),
});
