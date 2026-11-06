import { useState } from "react";
import { Loader2, Mail, Mic } from "lucide-react";
import { api } from "../lib/api";
import { useI18n } from "../i18n";
import LanguageSwitch from "./LanguageSwitch";

function Shell({ children }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-slate-50 to-slate-100 p-4">
      <LanguageSwitch className="absolute right-4 top-4" />
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-surface p-8 text-center shadow-xl">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg">
          <Mic className="h-7 w-7" />
        </div>
        {children}
      </div>
    </div>
  );
}

/** Sign in without a password: we email a one-time link (docs/adr/0003-access.md). */
export default function LoginScreen() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | sent
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      await api("/auth/link", { method: "POST", body: { email: email.trim() } });
      setState("sent");
    } catch (err) {
      setError(err.message);
      setState("idle");
    }
  };

  return (
    <Shell>
      <h1 className="text-2xl font-bold tracking-tight">minuteca</h1>
      <p className="mt-2 text-sm text-slate-600">{t("login.tagline")}</p>
      {state === "sent" ? (
        <div className="mt-6 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900" role="status">
          <Mail className="mx-auto mb-2 h-6 w-6" />
          <p className="font-semibold">{t("login.sentTitle")}</p>
          <p className="mt-1">{t("login.sent", { email: email.trim() })}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-3 text-left">
          <label className="block text-sm font-medium text-slate-700">
            {t("login.email")}
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </label>
          <button
            type="submit"
            disabled={state === "sending"}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
          >
            {state === "sending" && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("login.sendLink")}
          </button>
          <p className="text-xs text-slate-500">{t("login.onlyList")}</p>
        </form>
      )}
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      <p className="mt-6 text-xs text-slate-400">{t("login.retention")}</p>
    </Shell>
  );
}

/**
 * /acceso?t=…: the page the email link opens. Mail scanners open links on their own, so the
 * session starts only when the person taps the button. Links asked by the iOS recorder
 * (&app=1) open the recorder instead, which finishes the sign-in with its own secret.
 */
export function AccessScreen() {
  const { t } = useI18n();
  const params = new URLSearchParams(window.location.search);
  const token = params.get("t") || "";
  const forApp = params.get("app") === "1";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const enter = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/session", { method: "POST", body: { token } });
      window.location.replace("/");
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Shell>
      <h1 className="text-2xl font-bold tracking-tight">minuteca</h1>
      {forApp ? (
        <>
          <p className="mt-2 text-sm text-slate-600">{t("access.appHint")}</p>
          <a
            href={`minuteca://acceso?t=${encodeURIComponent(token)}`}
            className="mt-6 flex w-full items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            {t("access.openApp")}
          </a>
          <p className="mt-3 text-xs text-slate-500">{t("access.appOnlyHere")}</p>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-600">{t("access.webHint")}</p>
          <button
            type="button"
            onClick={enter}
            disabled={busy || !token}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("access.enter")}
          </button>
        </>
      )}
      {error && (
        <p className="mt-3 text-sm text-rose-600">
          {error}{" "}
          <a href="/" className="underline">
            {t("access.askAgain")}
          </a>
        </p>
      )}
    </Shell>
  );
}
