// minuteca for Mac and Windows (docs/adr/0005, docs/design/desktop-app.md): a window that shows the
// person's minuteca server, plus transcription on this computer. The window never gets Node; the
// main process holds the session token and adds it only to requests to that server.
import { app, BrowserWindow, dialog, ipcMain, Menu, net, powerSaveBlocker, safeStorage, session, shell, systemPreferences, utilityProcess, type IpcMainInvokeEvent, type UtilityProcess } from "electron";
import { autoUpdater } from "electron-updater";
import en from "../../locales/en.json" with { type: "json" };
import es from "../../locales/es.json" with { type: "json" };
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { accessToken, challengeOf, DEFAULT_SERVER, errorCode, externalAllowed, isMeetingId, linkInArgs, newVerifier, sameOrigin, serverOrigin } from "./core.ts";

/** Set by build.mjs: true only for Mac builds with a Developer ID signature, which macOS lets update themselves. */
declare const __MAC_SIGNED__: boolean;

const ORIGIN = serverOrigin(process.env.MINUTECA_SERVER) ?? serverOrigin(readConfig().server) ?? DEFAULT_SERVER;
const SESSION_FILE = () => join(app.getPath("userData"), "session.json");
const PENDING_MINUTES = 30;

function readConfig(): { server?: string } {
  try {
    return JSON.parse(readFileSync(join(app.getPath("userData"), "config.json"), "utf8"));
  } catch {
    return {};
  }
}

/* ---------- session token: encrypted by the OS (Keychain, DPAPI) when it can ---------- */

let token: string | null = null;
let pending: { verifier: string; expires: number } | null = null;

function loadToken() {
  try {
    const s = JSON.parse(readFileSync(SESSION_FILE(), "utf8")) as { enc: string; origin: string; expiresAt: string };
    if (s.origin !== ORIGIN || Date.parse(s.expiresAt) < Date.now()) return;
    token = safeStorage.decryptString(Buffer.from(s.enc, "base64"));
  } catch {
    token = null;
  }
}

function saveToken(value: string, expiresAt: string) {
  token = value;
  if (!safeStorage.isEncryptionAvailable()) return; // kept in memory only
  writeFileSync(SESSION_FILE(), JSON.stringify({ enc: safeStorage.encryptString(value).toString("base64"), origin: ORIGIN, expiresAt }), { mode: 0o600 });
}

function dropToken() {
  token = null;
  rmSync(SESSION_FILE(), { force: true });
}

// Chromium's network stack: the system's proxies and certificates, like the window.
const api = (path: string, init: RequestInit = {}) =>
  net.fetch(`${ORIGIN}/api${path}`, {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), "Accept-Language": app.getLocale(), ...init.headers },
  });

/* ---------- window ---------- */

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 380,
    minHeight: 500,
    title: "minuteca",
    autoHideMenuBar: true,
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (sameOrigin(url, ORIGIN)) return;
    e.preventDefault();
    if (externalAllowed(url)) void shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (externalAllowed(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("closed", () => (win = null));
  void win.loadURL(ORIGIN);
}

/** Only the minuteca page may use the bridge. */
const fromServer = (e: IpcMainInvokeEvent | Electron.IpcMainEvent) => Boolean(e.senderFrame && sameOrigin(e.senderFrame.url, ORIGIN));

/* ---------- sign-in: the app's own secret, the link comes back as minuteca://acceso (ADR 0003) ---------- */

ipcMain.handle("desktop:requestLink", async (e, email: unknown) => {
  if (!fromServer(e)) return { error: "generic" };
  const verifier = newVerifier();
  pending = { verifier, expires: Date.now() + PENDING_MINUTES * 60_000 };
  try {
    const r = await api("/auth/link", { method: "POST", body: JSON.stringify({ email: String(email), client: "app", challenge: challengeOf(verifier), device: "desktop" }) });
    if (!r.ok) return { error: errorCode(((await r.json().catch(() => ({}))) as { error?: string }).error) };
    return { value: true };
  } catch {
    return { error: "network" };
  }
});

async function openLink(url: string | null) {
  const t = accessToken(url);
  if (!t) return;
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  if (!pending || pending.expires < Date.now()) return;
  try {
    const r = await api("/auth/app-token", { method: "POST", body: JSON.stringify({ token: t, verifier: pending.verifier }) });
    if (!r.ok) return;
    const s = (await r.json()) as { token: string; expiresAt: string };
    pending = null;
    saveToken(s.token, s.expiresAt);
    win?.loadURL(ORIGIN);
  } catch {
    // The page still shows the sign-in screen; asking for another link works.
  }
}

/* ---------- transcription on this computer ---------- */

let job: { worker: UtilityProcess; cancelled: boolean } | null = null;
let decoder: BrowserWindow | null = null;
let decodeId = 0;

function decode(bytes: Uint8Array): Promise<Int16Array> {
  if (!decoder || decoder.isDestroyed()) {
    decoder = new BrowserWindow({ show: false, webPreferences: { preload: join(__dirname, "decode-preload.cjs"), contextIsolation: true, sandbox: true } });
    void decoder.loadFile(join(__dirname, "decode.html"));
  }
  const id = ++decodeId;
  const d = decoder;
  return new Promise((resolve, reject) => {
    const onDone = (_e: Electron.IpcMainEvent, r: { id: number; samples?: Int16Array; error?: string }) => {
      if (r.id !== id) return;
      ipcMain.removeListener("decoded", onDone);
      if (r.samples) resolve(r.samples);
      else reject(Object.assign(new Error(r.error ?? "decode"), { code: "decode_failed" }));
    };
    ipcMain.on("decoded", onDone);
    const send = () => d.webContents.send("decode", { id, bytes });
    if (d.webContents.isLoading()) d.webContents.once("did-finish-load", send);
    else send();
  });
}

/** Runs one request to the engine process and relays its progress. */
function ask(worker: UtilityProcess, message: unknown, progress: (p: unknown) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMessage = (m: { type: string; value?: unknown; code?: string; detail?: string }) => {
      if (m.type === "progress") return progress(m);
      worker.off("message", onMessage);
      worker.off("exit", onExit);
      if (m.type === "done") resolve(m.value);
      else reject(Object.assign(new Error(m.detail ?? m.code ?? "engine"), { code: m.code ?? "engine_failed" }));
    };
    const onExit = () => {
      worker.off("message", onMessage);
      reject(Object.assign(new Error("engine exited"), { code: job?.cancelled ? "cancelled" : "engine_failed" }));
    };
    worker.on("message", onMessage);
    worker.once("exit", onExit);
    worker.postMessage(message);
  });
}

ipcMain.handle("desktop:transcribe", async (e, meetingId: unknown) => {
  if (!fromServer(e)) return { error: "generic" };
  if (!isMeetingId(meetingId)) return { error: "not_found" };
  if (job) return { error: "not_ready" };
  if (!token) return { error: "signed_out" };
  const progress = (p: unknown) => e.sender.isDestroyed() || e.sender.send("desktop:progress", p);
  const worker = utilityProcess.fork(join(__dirname, "engine-worker.cjs"), [], { serviceName: "minuteca-engine" });
  job = { worker, cancelled: false };
  const awake = powerSaveBlocker.start("prevent-app-suspension");
  try {
    progress({ step: "models" });
    await ask(worker, { type: "models" }, progress);
    progress({ step: "audio" });
    const audio = await api(`/meetings/${meetingId}/audio`);
    if (audio.status === 401) return { error: "signed_out" };
    if (!audio.ok) return { error: audio.status === 404 ? "not_found" : "network" };
    const bytes = new Uint8Array(await audio.arrayBuffer());
    if (job.cancelled) return { error: "cancelled" };
    progress({ step: "decode" });
    const samples = await decode(bytes);
    if (job.cancelled) return { error: "cancelled" };
    progress({ step: "voices" });
    const transcript = await ask(worker, { type: "transcribe", samples }, progress);
    progress({ step: "save" });
    const saved = await api(`/meetings/${meetingId}/transcript/local`, { method: "PUT", body: JSON.stringify({ transcript }) });
    if (!saved.ok) return { error: errorCode(((await saved.json().catch(() => ({}))) as { error?: string }).error) };
    return { value: true };
  } catch (err) {
    if (job?.cancelled) return { error: "cancelled" };
    const code = (err as { code?: string }).code;
    console.error("local transcription", code, (err as Error).message);
    return { error: code ? errorCode(code) : "network" };
  } finally {
    powerSaveBlocker.stop(awake);
    worker.kill();
    job = null;
    if (promptAfterJob) {
      promptAfterJob = false;
      void offer();
    }
  }
});

ipcMain.on("desktop:cancel", (e) => {
  if (!fromServer(e) || !job) return;
  job.cancelled = true;
  job.worker.kill();
});

/* ---------- updates: GitHub releases of the open core (ADR 0005), set by electron-builder.yml ---------- */

type UpdateState = { status: "dev" | "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "error"; version?: string };
let update: UpdateState = { status: app.isPackaged ? "idle" : "dev" };
// macOS only installs updates of apps with a Developer ID signature; unsigned builds get a download link.
const canInstall = process.platform !== "darwin" || __MAC_SIGNED__;
let prompted = "";
let promptAfterJob = false;

// Spanish, the app's main language, unless the computer asks for English; texts live with the web's.
const words = () => (app.getLocale().toLowerCase().startsWith("en") ? en : es).desktopApp;
const fill = (text: string, version = "") => text.replace("{version}", version);

function setUpdate(next: UpdateState) {
  update = next;
  if (win && !win.isDestroyed()) win.webContents.send("desktop:update", update);
}

async function offer() {
  if (!update.version || prompted === update.version || !win) return;
  if (job) {
    promptAfterJob = true;
    return;
  }
  prompted = update.version;
  const w = words();
  if (update.status === "ready") {
    const r = await dialog.showMessageBox(win, { type: "info", message: fill(w.readyDialog, update.version), buttons: [w.restart, w.later], defaultId: 0, cancelId: 1 });
    if (r.response === 0) autoUpdater.quitAndInstall();
  } else if (update.status === "available") {
    const r = await dialog.showMessageBox(win, { type: "info", message: fill(w.availableDialog, update.version), buttons: [w.download, w.later], defaultId: 0, cancelId: 1 });
    if (r.response === 0) void shell.openExternal(`${ORIGIN}/descargar`);
  }
}

async function checkUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) return update;
  const result = await autoUpdater.checkForUpdates().catch(() => {
    setUpdate({ status: "error" });
    return undefined;
  });
  // null: this kind of build cannot update itself (for example a Linux folder build).
  if (result === null) setUpdate({ status: "dev" });
  return update;
}

function setupUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = canInstall;
  autoUpdater.autoInstallOnAppQuit = canInstall;
  autoUpdater.on("checking-for-update", () => setUpdate({ status: "checking" }));
  autoUpdater.on("update-not-available", () => setUpdate({ status: "current", version: app.getVersion() }));
  autoUpdater.on("update-available", (i) => {
    setUpdate({ status: canInstall ? "downloading" : "available", version: i.version });
    if (!canInstall) void offer();
  });
  autoUpdater.on("update-downloaded", (i) => {
    setUpdate({ status: "ready", version: i.version });
    void offer();
  });
  autoUpdater.on("error", (e) => {
    console.error("update", e.message);
    setUpdate({ status: "error" });
  });
  setTimeout(() => void checkUpdates(), 15_000);
  setInterval(() => void checkUpdates(), 6 * 60 * 60_000);
}

ipcMain.handle("desktop:info", (e) => (fromServer(e) ? { value: { version: app.getVersion(), update } } : { error: "generic" }));
ipcMain.handle("desktop:checkUpdates", async (e) => (fromServer(e) ? { value: await checkUpdates() } : { error: "generic" }));
ipcMain.handle("desktop:installUpdate", (e) => {
  if (!fromServer(e)) return { error: "generic" };
  if (update.status === "ready") autoUpdater.quitAndInstall();
  else if (update.status === "available") void shell.openExternal(`${ORIGIN}/descargar`);
  return { value: true };
});

/* ---------- app lifecycle ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // macOS sends links to the running app; Windows starts a second instance with the link.
  app.on("open-url", (e, url) => {
    e.preventDefault();
    if (app.isReady()) void openLink(url);
    else app.once("ready", () => void openLink(url));
  });
  app.on("second-instance", (_e, argv) => void openLink(linkInArgs(argv)));
  if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient("minuteca", process.execPath, [process.argv[1]]);
  else app.setAsDefaultProtocolClient("minuteca");

  app.whenReady().then(() => {
    loadToken();
    const ses = session.defaultSession;
    // The page never sees the token: it is added to requests to the server only.
    ses.webRequest.onBeforeSendHeaders({ urls: [`${ORIGIN}/*`] }, (details, done) => {
      if (token) details.requestHeaders.Authorization = `Bearer ${token}`;
      done({ requestHeaders: details.requestHeaders });
    });
    ses.webRequest.onCompleted({ urls: [`${ORIGIN}/api/auth/logout`, `${ORIGIN}/api/me`] }, (d) => {
      if (d.url.endsWith("/api/auth/logout") || d.statusCode === 401) dropToken();
    });
    // The microphone, for recording from the web, and nothing else.
    ses.setPermissionRequestHandler((_wc, permission, done, details) => {
      const audioOnly = (details as { mediaTypes?: string[] }).mediaTypes?.every((t) => t === "audio") !== false;
      const ok = permission === "media" && audioOnly && sameOrigin(details.requestingUrl, ORIGIN);
      if (ok && process.platform === "darwin") void systemPreferences.askForMediaAccess("microphone").then(done);
      else done(ok);
    });
    ses.setPermissionCheckHandler((_wc, permission, origin) => permission === "media" && sameOrigin(origin, ORIGIN));
    if (process.platform === "darwin") {
      const checkFromMenu = async () => {
        const s = await checkUpdates();
        if (s.status === "current" && win) void dialog.showMessageBox(win, { type: "info", message: fill(words().currentDialog, app.getVersion()) });
        else void offer();
      };
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          { label: app.name, submenu: [{ role: "about" }, { label: `${words().check}…`, click: () => void checkFromMenu() }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }] },
          { role: "editMenu" },
          { role: "viewMenu" },
          { role: "windowMenu" },
        ]),
      );
    } else Menu.setApplicationMenu(null);
    createWindow();
    setupUpdates();
    void openLink(linkInArgs(process.argv));
    app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
