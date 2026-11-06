import { useState } from "react";
import { ArrowLeft, Check, Download, ExternalLink, KeyRound, Loader2, LogOut, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { PROVIDER_IDS } from "../lib/providers";
import { useI18n } from "../i18n";
import { useConfirm } from "./Confirm";
import LanguageSwitch from "./LanguageSwitch";

const card = "rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm";
const input =
  "min-w-0 basis-full rounded-lg border border-slate-300 bg-surface px-3 py-2.5 font-mono sm:flex-1 sm:basis-0 text-sm text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200";

/**
 * Provider choice, each person's own keys (docs/design/own-provider-keys.md), permissions to send
 * audio, usage this month, "download all my data" and the account.
 */
export default function SettingsPanel({ me, onMeChange, onBack, onSignOut }) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null); // provider whose key form is open
  const [draft, setDraft] = useState("");
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
    if (await run(`key:${provider}`, () => api(`/keys/${provider}`, { method: "PUT", body: { key: draft.trim() } }))) {
      setDraft("");
      setEditing(null);
    }
  };
  const removeKey = async (provider) => {
    const name = t(`providers.${provider}.name`);
    if (await confirm({ title: t("settings.removeKeyTitle", { provider: name }), body: t("settings.removeKeyConfirm"), confirmLabel: t("settings.removeKey"), danger: true })) {
      run(`del:${provider}`, () => api(`/keys/${provider}`, { method: "DELETE" }));
    }
  };
  const revoke = async (provider) => {
    const name = t(`providers.${provider}.name`);
    if (await confirm({ title: t("settings.revokeTitle", { provider: name }), body: t("settings.revokeConfirm", { provider: name }), confirmLabel: t("settings.revoke") })) {
      run(`consent:${provider}`, () => api("/me/consents", { method: "PUT", body: { provider, granted: false } }));
    }
  };

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> {t("users.back")}
      </button>
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("settings.subtitle")}</p>
      </header>

      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}

      <section className={card}>
        <h2 className="font-semibold text-slate-900">{t("settings.providers")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("settings.providersHint")}</p>
        {!me.keysEnabled && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("settings.keysDisabled")}</p>}

        <div role="radiogroup" aria-label={t("settings.providers")} className="mt-4 space-y-3">
          {PROVIDER_IDS.map((id) => {
            const p = me.providers.find((x) => x.id === id) || {};
            const chosen = me.provider === id;
            const name = t(`providers.${id}.name`);
            const consented = me.consents.includes(id);
            return (
              <div key={id} className={`rounded-xl border p-4 transition ${chosen ? "border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200" : "border-slate-200"}`}>
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    aria-label={t("settings.useProvider", { provider: name })}
                    disabled={busy !== null}
                    onClick={() => !chosen && run(`use:${id}`, () => api("/me/provider", { method: "PUT", body: { provider: id } }))}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      chosen ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 hover:border-indigo-400"
                    }`}
                  >
                    {chosen && <Check className="h-3 w-3" strokeWidth={3} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{name}</span>
                      {p.ownKey ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                          <KeyRound className="h-3 w-3" /> {t("settings.ownKey", { last4: p.ownKey.last4 })}
                        </span>
                      ) : p.hosted ? (
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-sky-200">{t("settings.hostedKey")}</span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{t("settings.noKey")}</span>
                      )}
                      {consented && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> {t("settings.consentedShort")}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      {t(`providers.${id}.where`)} · {t(`providers.${id}.privacy`)}
                    </p>

                    {editing === id ? (
                      <form
                        className="mt-3 flex flex-wrap gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          saveKey(id);
                        }}
                      >
                        <input
                          type="password"
                          autoFocus
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={t("settings.pasteKey")}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          className={input}
                          aria-label={t("settings.keyFor", { provider: name })}
                        />
                        <button
                          type="submit"
                          disabled={!draft.trim() || busy !== null}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {busy === `key:${id}` && <Loader2 className="h-4 w-4 animate-spin" />} {t("settings.saveKey")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(null);
                            setDraft("");
                          }}
                          className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                        >
                          {t("common.cancel")}
                        </button>
                        <p className="w-full text-xs text-slate-500">{t("settings.keySafety")}</p>
                      </form>
                    ) : (
                      me.keysEnabled && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                          <button
                            type="button"
                            onClick={() => {
                              setDraft("");
                              setEditing(id);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-surface px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <KeyRound className="h-3.5 w-3.5" /> {t(p.ownKey ? "settings.changeKey" : "settings.addKey")}
                          </button>
                          {p.ownKey && (
                            <button type="button" onClick={() => removeKey(id)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700">
                              <Trash2 className="h-3.5 w-3.5" /> {t("settings.removeKey")}
                            </button>
                          )}
                          {consented && (
                            <button type="button" onClick={() => revoke(id)} className="rounded-lg px-2 py-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                              {t("settings.revoke")}
                            </button>
                          )}
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className={card}>
        <h2 className="font-semibold text-slate-900">{t("settings.usage")}</h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-4">
            <dt className="text-sm text-slate-500">{t("settings.usageOwn")}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{t("settings.minutes", { n: minutes(me.usage.ownSeconds) })}</dd>
          </div>
          {me.hosted && (
            <div className="rounded-xl bg-slate-50 p-4">
              <dt className="text-sm text-slate-500">{t("settings.usageHosted")}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{t("settings.minutes", { n: minutes(me.usage.hostedSeconds) })}</dd>
              <dd className="mt-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden>
                  <div
                    className="h-full rounded-full bg-sky-500"
                    style={{ width: `${Math.min(100, (100 * (me.hosted.capSeconds - me.hosted.remainingSeconds)) / Math.max(1, me.hosted.capSeconds))}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">{t("settings.hostedLeft", { left: minutes(me.hosted.remainingSeconds), cap: minutes(me.hosted.capSeconds) })}</p>
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className={card}>
        <h2 className="flex items-center gap-2 font-semibold text-slate-900">
          <Smartphone className="h-4 w-4 text-slate-500" /> {t("settings.iosTitle")}
        </h2>
        <p className="mt-1 text-sm text-slate-600">{t("settings.iosHint")}</p>
      </section>

      <section className={card}>
        <h2 className="font-semibold text-slate-900">{t("settings.data")}</h2>
        <p className="mt-1 text-sm text-slate-600">{t("settings.dataHint", { days: me.retentionDays })}</p>
        <a
          href="/api/export"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-surface px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Download className="h-4 w-4" /> {t("settings.exportAll")}
        </a>
      </section>

      <section className={card}>
        <h2 className="font-semibold text-slate-900">{t("settings.account")}</h2>
        <dl className="mt-3 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">{t("settings.email")}</dt>
            <dd className="truncate font-medium text-slate-900">{me.email}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-slate-500">{t("common.interfaceLanguage")}</dt>
            <dd>
              <LanguageSwitch />
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="https://lzno.app" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
            <ExternalLink className="h-4 w-4" /> {t("settings.about")}
          </a>
          <button type="button" onClick={onSignOut} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50">
            <LogOut className="h-4 w-4" /> {t("app.signOut")}
          </button>
        </div>
      </section>
    </div>
  );
}
