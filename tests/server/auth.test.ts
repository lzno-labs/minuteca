import { afterEach, describe, expect, it } from "vitest";
import { ADMIN, ORIGIN, setup } from "./helpers.ts";

let t: ReturnType<typeof setup>;
afterEach(() => t?.cleanup());

describe("health", () => {
  it("answers with the core commit", async () => {
    t = setup({ env: { LZNO_CORE_SHA: "abc123" } });
    const r = await t.fetch("/health");
    expect(await r.json()).toEqual({ ok: true, core: "abc123" });
  });
});

describe("sign in with an email link", () => {
  it("sends a link only to people on the access list, with the same answer for everyone", async () => {
    t = setup();
    const a = await t.fetch("/api/auth/link", { method: "POST", body: JSON.stringify({ email: "stranger@example.org" }) });
    const b = await t.fetch("/api/auth/link", { method: "POST", body: JSON.stringify({ email: ADMIN }) });
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
    expect(t.mails).toHaveLength(1);
    expect(t.mails[0]!.to).toBe(ADMIN);
    expect(t.mails[0]!.subject).toMatch(/minuteca/i);
    expect(t.mails[0]!.text).toContain(`${ORIGIN}/acceso?t=`);
  });

  it("starts a session once per link, and the link expires", async () => {
    t = setup();
    await t.fetch("/api/auth/link", { method: "POST", body: JSON.stringify({ email: ADMIN }) });
    const token = /t=([0-9a-f]{64})/.exec(t.mails[0]!.text)![1]!;
    const first = await t.fetch("/api/auth/session", { method: "POST", body: JSON.stringify({ token }) });
    expect(first.status).toBe(200);
    const cookie = first.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    const again = await t.fetch("/api/auth/session", { method: "POST", body: JSON.stringify({ token }) });
    expect(again.status).toBe(400);

    await t.fetch("/api/auth/link", { method: "POST", body: JSON.stringify({ email: ADMIN }) });
    const late = /t=([0-9a-f]{64})/.exec(t.mails[1]!.text)![1]!;
    t.advance(31 * 60_000);
    expect((await t.fetch("/api/auth/session", { method: "POST", body: JSON.stringify({ token: late }) })).status).toBe(400);
  });

  it("refuses cookie writes from another origin", async () => {
    t = setup();
    const cookie = await t.signIn();
    const r = await t.fetch("/api/meetings", { method: "POST", cookie, headers: { Origin: "https://evil.example" }, body: JSON.stringify({ id: crypto.randomUUID() }) });
    expect(r.status).toBe(403);
  });

  it("knows who is signed in and signs out", async () => {
    t = setup();
    const cookie = await t.signIn();
    const me = await (await t.fetch("/api/me", { cookie })).json();
    expect(me).toMatchObject({ email: ADMIN, role: "admin", provider: "deepgram", consents: [], keysEnabled: true, hosted: null });
    await t.fetch("/api/auth/logout", { method: "POST", cookie });
    expect((await t.fetch("/api/me", { cookie })).status).toBe(401);
  });
});

describe("sign in from the iOS app", () => {
  it("needs the verifier of the device that asked for the link", async () => {
    t = setup();
    const token = await t.appSignIn();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const me = await t.fetch("/api/me", { bearer: token });
    expect(me.status).toBe(200);
    // Bearer requests carry no ambient credentials, so they need no Origin.
    const created = await t.fetch("/api/meetings", { method: "POST", bearer: token, body: JSON.stringify({ id: crypto.randomUUID(), source: "ios" }) });
    expect(created.status).toBe(201);
  });

  it("rejects a stolen link without the verifier", async () => {
    t = setup();
    await t.fetch("/api/auth/link", { method: "POST", body: JSON.stringify({ email: ADMIN, client: "app", challenge: "A".repeat(43) }) });
    const token = /t=([0-9a-f]{64})/.exec(t.mails[0]!.text)![1]!;
    expect(t.mails[0]!.text).toContain("&app=1");
    const r = await t.fetch("/api/auth/app-token", { method: "POST", body: JSON.stringify({ token, verifier: "x".repeat(43) }) });
    expect(r.status).toBe(400);
    // App links cannot open a browser session either.
    const web = await t.fetch("/api/auth/session", { method: "POST", body: JSON.stringify({ token }) });
    expect(web.status).toBe(400);
  });
});

describe("access list", () => {
  it("lets admins add and remove people; removed people cannot sign in", async () => {
    t = setup();
    const cookie = await t.signIn();
    const add = await t.fetch("/api/users", { method: "POST", cookie, body: JSON.stringify({ email: "Ana@Example.org", role: "member" }) });
    expect((await add.json()).users.map((u: { email: string }) => u.email)).toContain("ana@example.org");
    const ana = await t.signIn("ana@example.org");
    expect((await t.fetch("/api/users", { cookie: ana })).status).toBe(403);
    await t.fetch(`/api/users/${encodeURIComponent("ana@example.org")}`, { method: "DELETE", cookie });
    expect((await t.fetch("/api/me", { cookie: ana })).status).toBe(401);
    const before = t.mails.length;
    await t.fetch("/api/auth/link", { method: "POST", body: JSON.stringify({ email: "ana@example.org" }) });
    expect(t.mails.length).toBe(before);
  });

  it("does not let an admin remove themselves", async () => {
    t = setup();
    const cookie = await t.signIn();
    const r = await t.fetch(`/api/users/${encodeURIComponent(ADMIN)}`, { method: "DELETE", cookie });
    expect(r.status).toBe(400);
  });
});
