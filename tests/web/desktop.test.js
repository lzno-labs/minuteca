import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopBridge, progressText } from "../../src/web/lib/desktop";

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
});
