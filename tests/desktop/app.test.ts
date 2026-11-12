import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accessToken, bundleOf, challengeOf, errorCode, externalAllowed, isMeetingId, linkInArgs, macArchive, newVerifier, releaseFileUrl, replaceable, sameOrigin,
  serverOrigin, SWAP_SCRIPT, toFloat32, toInt16,
} from "../../desktop/app/core.ts";
import { challengeMatches } from "../../src/server/crypto.ts";

describe("desktop app helpers", () => {
  it("accepts https servers, and http only on this computer", () => {
    expect(serverOrigin("https://minuteca.lzno.app/")).toBe("https://minuteca.lzno.app");
    expect(serverOrigin(" http://localhost:8787/x ")).toBe("http://localhost:8787");
    expect(serverOrigin("http://minuteca.example.org")).toBeNull();
    expect(serverOrigin("https://user:pass@minuteca.example.org")).toBeNull();
    expect(serverOrigin("file:///etc/passwd")).toBeNull();
    expect(serverOrigin(undefined)).toBeNull();
  });

  it("makes a secret the server accepts for its challenge", async () => {
    const verifier = newVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const challenge = challengeOf(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(await challengeMatches(verifier, challenge)).toBe(true);
    expect(await challengeMatches(newVerifier(), challenge)).toBe(false);
  });

  it("reads only well formed sign-in links", () => {
    const t = "a".repeat(64);
    expect(accessToken(`minuteca://acceso?t=${t}`)).toBe(t);
    expect(accessToken(`minuteca:///acceso?t=${t}`)).toBe(t);
    expect(accessToken(`minuteca://acceso?t=${t.slice(1)}`)).toBeNull();
    expect(accessToken(`minuteca://otra?t=${t}`)).toBeNull();
    expect(accessToken(`https://minuteca.lzno.app/acceso?t=${t}`)).toBeNull();
    expect(accessToken(null)).toBeNull();
    expect(linkInArgs(["/app/minuteca", "--flag", `minuteca://acceso?t=${t}`])).toBe(`minuteca://acceso?t=${t}`);
    expect(linkInArgs(["/app/minuteca"])).toBeNull();
  });

  it("keeps the window on its server and opens only web pages and mail outside", () => {
    const o = "https://minuteca.lzno.app";
    expect(sameOrigin("https://minuteca.lzno.app/?m=1", o)).toBe(true);
    expect(sameOrigin("https://minuteca.lzno.app.evil.org/", o)).toBe(false);
    expect(sameOrigin("not a url", o)).toBe(false);
    expect(externalAllowed("https://example.org")).toBe(true);
    expect(externalAllowed("mailto:soporte@lzno.app")).toBe(true);
    expect(externalAllowed("file:///Applications/Calculator.app")).toBe(false);
    expect(externalAllowed("smb://server/share")).toBe(false);
  });

  it("checks meeting ids and error codes before they reach a URL or the page", () => {
    expect(isMeetingId(crypto.randomUUID())).toBe(true);
    expect(isMeetingId("../../etc")).toBe(false);
    expect(isMeetingId(42)).toBe(false);
    expect(errorCode("decode_failed")).toBe("decode_failed");
    expect(errorCode("anything else")).toBe("generic");
  });

  it("round trips audio through 16-bit PCM", () => {
    const f = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
    const back = toFloat32(toInt16(f));
    expect(Array.from(toInt16(f))).toEqual([0, 16383, -16384, 32767, -32768, 32767]);
    expect(back[1]).toBeCloseTo(0.5, 3);
    expect(back[4]).toBe(-1);
  });
});

describe("updates on a Mac without a Developer ID (ADR 0008)", () => {
  const feed = [
    { url: "minuteca-mac-x64.zip", sha512: "x" },
    { url: "minuteca-mac-arm64.zip", sha512: "a" },
    { url: "minuteca-mac-arm64.dmg", sha512: "d" },
  ];

  it("picks this chip's archive and only downloads fixed names of plain versions", () => {
    expect(macArchive(feed, "arm64")?.sha512).toBe("a");
    expect(macArchive(feed, "x64")?.sha512).toBe("x");
    expect(macArchive(undefined, "arm64")).toBeNull();
    expect(releaseFileUrl("0.1.3", "minuteca-mac-arm64.zip")).toBe("https://github.com/lzno-labs/minuteca/releases/download/v0.1.3/minuteca-mac-arm64.zip");
    expect(releaseFileUrl("0.1.3/../../x", "minuteca-mac-arm64.zip")).toBeNull();
    expect(releaseFileUrl("0.1.3", "../evil.zip")).toBeNull();
  });

  it("finds its own bundle, and never replaces one on the disk image or in a translocated copy", () => {
    expect(bundleOf("/Applications/minuteca.app/Contents/MacOS/minuteca")).toBe("/Applications/minuteca.app");
    expect(bundleOf("/usr/bin/node")).toBeNull();
    expect(replaceable("/Applications/minuteca.app")).toBe(true);
    expect(replaceable("/Volumes/minuteca/minuteca.app")).toBe(false);
    expect(replaceable("/private/var/folders/x/AppTranslocation/ABC/d/minuteca.app")).toBe(false);
  });

  // The swap runs in /bin/sh with open and xattr stubbed: on success the new bundle is in place and
  // the app reopens; if the new one is missing, the old one stays.
  it.skipIf(process.platform === "win32")("swaps the bundle after the app ends, and keeps the old one if the swap fails", () => {
    const root = mkdtempSync(join(tmpdir(), "minuteca-swap-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      for (const tool of ["open", "xattr"]) {
        writeFileSync(join(bin, tool), `#!/bin/sh\necho "${tool} $*" >> "${root}/calls.log"\n`);
        chmodSync(join(bin, tool), 0o755);
      }
      const setup = (withNext: boolean) => {
        const app = join(root, "minuteca.app");
        const work = mkdtempSync(join(root, ".minuteca-update-"));
        rmSync(app, { recursive: true, force: true });
        mkdirSync(app);
        writeFileSync(join(app, "version"), "old");
        const next = join(work, "minuteca.app");
        if (withNext) {
          mkdirSync(next);
          writeFileSync(join(next, "version"), "new");
        }
        return { app, work, next };
      };
      const swap = (env: Record<string, string>) =>
        spawnSync("/bin/sh", ["-c", SWAP_SCRIPT], { env: { PATH: `${bin}:/usr/bin:/bin`, PID: "999999", REOPEN: "1", ...env } });

      const ok = setup(true);
      expect(swap({ APP: ok.app, NEXT: ok.next, WORK: ok.work }).status).toBe(0);
      expect(readFileSync(join(ok.app, "version"), "utf8")).toBe("new");
      expect(existsSync(ok.work)).toBe(false);
      expect(readFileSync(join(root, "calls.log"), "utf8")).toContain(`open ${ok.app}`);

      const bad = setup(false);
      swap({ APP: bad.app, NEXT: bad.next, WORK: bad.work, REOPEN: "0" });
      expect(readFileSync(join(bad.app, "version"), "utf8")).toBe("old");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
