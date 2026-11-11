import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { diskDownloads, DOWNLOAD_RE } from "../../src/server/files/downloads.ts";
import { setup } from "./helpers.ts";

let t: ReturnType<typeof setup>;
let dir = "";
afterEach(() => {
  t?.cleanup();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("desktop downloads", () => {
  it("serves feeds and installers publicly, with byte ranges", async () => {
    dir = mkdtempSync(join(tmpdir(), "minuteca-downloads-"));
    writeFileSync(join(dir, "latest.yml"), "version: 0.1.1\npath: minuteca-0.1.1-windows-x64.exe\n");
    writeFileSync(join(dir, "minuteca-0.1.1-windows-x64.exe"), "0123456789");
    t = setup({ downloads: diskDownloads(dir) });
    const feed = await t.fetch("/api/desktop/latest.yml");
    expect(feed.status).toBe(200);
    expect(feed.headers.get("cache-control")).toBe("no-cache");
    expect(feed.headers.get("content-type")).toContain("yaml");
    expect(await feed.text()).toContain("version: 0.1.1");
    const exe = await t.fetch("/api/desktop/minuteca-0.1.1-windows-x64.exe");
    expect(exe.headers.get("content-disposition")).toBe('attachment; filename="minuteca-0.1.1-windows-x64.exe"');
    expect(exe.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(await exe.text()).toBe("0123456789");
    const part = await t.fetch("/api/desktop/minuteca-0.1.1-windows-x64.exe", { headers: { Range: "bytes=2-4" } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("234");
  });

  it("serves only plain names with installer extensions, and nothing when none are published", async () => {
    dir = mkdtempSync(join(tmpdir(), "minuteca-downloads-"));
    writeFileSync(join(dir, "secret.txt"), "no");
    t = setup({ downloads: diskDownloads(dir) });
    expect((await t.fetch("/api/desktop/secret.txt")).status).toBe(404);
    expect((await t.fetch("/api/desktop/..%2Fsecret.yml")).status).toBe(404);
    expect((await t.fetch("/api/desktop/latest-mac.yml")).status).toBe(404);
    expect(DOWNLOAD_RE.test("minuteca-0.1.1-mac-arm64.zip.blockmap")).toBe(true);
    expect(DOWNLOAD_RE.test(".hidden.yml")).toBe(false);
    expect(DOWNLOAD_RE.test("a/b.yml")).toBe(false);
    t.cleanup();
    t = setup();
    expect((await t.fetch("/api/desktop/latest.yml")).status).toBe(404);
  });
});
