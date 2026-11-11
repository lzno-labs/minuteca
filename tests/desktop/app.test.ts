import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { accessToken, challengeOf, errorCode, externalAllowed, isMeetingId, linkInArgs, newVerifier, sameOrigin, serverOrigin, toFloat32, toInt16 } from "../../desktop/app/core.ts";
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
