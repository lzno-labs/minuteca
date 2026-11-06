import { useState } from "react";
import { ArrowLeft, Check, Download, KeyRound, Loader2, Settings, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { PROVIDER_IDS } from "../lib/providers";
import { useI18n } from "../i18n";

/**
 * Provider choice, each person's own keys (docs/design/own-provider-keys.md), permissions to
 * send audio, usage this month and "download all my data".
 */
export default function SettingsPanel({ me, onMeChange, onBack }) {
  const { t, locale } = useI18n();
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const minutes = (s) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.ceil((s || 0) / 60));

  const run = async (key, fn) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await onMeChange();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveKey = async (provider) => {
    const key = (drafts[provider] || "").trim();
    if (await run(`key:${provider}`, () => api(`/keys/${provider}`, { method: "PUT", body: { key } }))) {
      setDrafts((d) => ({ ...d, [provider]: "" }));
    }
  };

  const card = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5";
  const input =
    "min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200";

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> {t("users.back")}
      </button>
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
          <Settings className="h-6 w-6 text-slate-500" /> {t("settings.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t("settings.subtitle")}</p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}

      <section className={card}>
        <h2 className="text-base font-semibold">{t("settings.providers")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("settings.providersHint")}</p>
        {!me.keysEnabled && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("settings.keysDisabled")}</p>}
        <ul className="mt-4 divide-y divide-slate-100">
          {PROVIDER_IDS.map((id) => {
            const p = me.providers.find((x) => x.id === id) || {};
            const chosen = me.provider === id;
            const consented = me.consents.includes(id);
            return (
              <li key={id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{t(`providers.${id}.name`)}</p>
                    <p className="text-xs text-slate-500">
                      {t(`providers.${id}.where`)} · {t(`providers.${id}.privacy`)}
                    </p>
                  </div>
                  {chosen ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                      <Check className="h-3.5 w-3.5" /> {t("settings.inUse")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => run(`use:${id}`, () => api("/me/provider", { method: "PUT", body: { provider: id } }))}
                      className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {t("settings.use")}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {p.ownKey ? (
                    <>
                      <span className="inline-flex items-center gap-1.5 text-slate-700">
                        <KeyRound className="h-4 w-4 text-emerald-600" /> {t("settings.ownKey", { last4: p.ownKey.last4 })}
                      </span>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => confirm(t("settings.removeKeyConfirm")) && run(`del:${id}`, () => api(`/keys/${id}`, { method: "DELETE" }))}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> {t("settings.removeKey")}
                      </button>
                    </>
                  ) : p.hosted ? (
                    <span className="text-slate-600">{t("settings.hostedKey")}</span>
                  ) : (
                    <span className="text-slate-500">{t("settings.noKey")}</span>
                  )}
                </div>
                {me.keysEnabled && (
                  <form
                    className="flex flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveKey(id);
                    }}
                  >
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={t(p.ownKey ? "settings.replaceKey" : "settings.pasteKey")}
                      value={drafts[id] || ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [id]: e.target.value }))}
                      className={input}
                      aria-label={t("settings.keyFor", { provider: t(`providers.${id}.name`) })}
                    />
                    <button
                      type="submit"
                      disabled={!drafts[id]?.trim() || busy !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {busy === `key:${id}` && <Loader2 className="h-4 w-4 animate-spin" />} {t("settings.saveKey")}
                    </button>
                  </form>
                )}
                {consented && (
                  <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> {t("settings.consented", { provider: t(`providers.${id}.name`) })}
                    <button
                      type="button"
                      className="underline hover:text-rose-700"
                      onClick={() => run(`consent:${id}`, () => api("/me/consents", { method: "PUT", body: { provider: id, granted: false } }))}
                    >
                      {t("settings.revoke")}
                    </button>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs text-slate-500">{t("settings.keySafety")}</p>
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold">{t("settings.usage")}</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">{t("settings.usageOwn")}</dt>
            <dd className="text-lg font-semibold">{t("settings.minutes", { n: minutes(me.usage.ownSeconds) })}</dd>
          </div>
          {me.hosted && (
            <div>
              <dt className="text-slate-500">{t("settings.usageHosted")}</dt>
              <dd className="text-lg font-semibold">{t("settings.minutes", { n: minutes(me.usage.hostedSeconds) })}</dd>
              <dd className="text-xs text-slate-500">
                {t("settings.hostedLeft", { left: minutes(me.hosted.remainingSeconds), cap: minutes(me.hosted.capSeconds) })}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold">{t("settings.data")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("settings.dataHint", { days: me.retentionDays })}</p>
        <a
          href="/api/export"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Download className="h-4 w-4" /> {t("settings.exportAll")}
        </a>
      </section>

      <section className={card}>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Smartphone className="h-5 w-5 text-slate-500" /> {t("settings.iosTitle")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t("settings.iosHint")}</p>
      </section>
    </div>
  );
}
