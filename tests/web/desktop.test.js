import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopBridge, detectOs, installerFile, installerUrl, progressText } from "../../src/web/lib/desktop";

describe("desktop bridge", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is there only inside the desktop app", () => {
    vi.stubGlobal("window", {});
    expect(desktopBridge()).toBeNull();
    const bridge = { transcribe: () => {} };
    vi.stubGlobal("window", { minutecaDesktop: bridge });
    expect(desktopBridge()).toBe(bridge);
  });

  it("turns progress into texts", () => {
    expect(progressText(null)).toEqual({ key: "local.starting", values: {} });
    expect(progressText({ step: "models", done: 120e6, total: 710e6 })).toEqual({ key: "local.models", values: { done: 120, total: 710 } });
    expect(progressText({ step: "text", done: 3, total: 18 })).toEqual({ key: "local.text", values: { done: 3, total: 18 } });
    expect(progressText({ step: "voices" }).key).toBe("local.voices");
    expect(progressText({ step: "whatever" }).key).toBe("local.starting");
  });

  it("names the installers of the newest release for the download page", () => {
    expect(detectOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
    expect(detectOs("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBeNull();
    expect(installerFile("windows")).toBe("minuteca-windows-x64.exe");
    expect(installerFile("mac")).toBe("minuteca-mac-arm64.dmg");
    expect(installerFile("mac-intel")).toBe("minuteca-mac-x64.dmg");
    expect(installerUrl("mac")).toBe("https://github.com/lzno-labs/minuteca/releases/latest/download/minuteca-mac-arm64.dmg");
  });
});
