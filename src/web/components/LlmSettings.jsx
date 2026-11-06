import { useState } from "react";
import { Check, KeyRound, Loader2, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { LLM_IDS, llmConsentId } from "../lib/llm";
import { useI18n } from "../i18n";
import { useConfirm } from "./Confirm";

const input =
  "min-w-0 rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200";

/**
 * Language model for speaker names and minutes (docs/design/minutes-with-llm.md): the provider,
 * the person's own key for it (shared with transcription for OpenAI), the model, permission, and
 * their own instructions for the minutes.
 */
export default function LlmSettings({ me, onMeChange }) {
  const { t, locale } = useI18n();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [instructions, setInstructions] = useState(me.llm?.instructions ?? "");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const providers = LLM_IDS.map((id) => me.llm?.providers?.find((p) => p.id === id)).filter(Boolean);
  const fmt = (n) => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);

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

  const saveKey = async (id) => {
    if (await run(`key:${id}`, () => api(`/keys/${id}`, { method: "PUT", body: { key: draft.trim() } }))) {
      setDraft("");
      setEditing(null);
    }
  };
  const removeKey = async (id) => {
    const name = t(`llmProviders.${id}.name`);
    if (await confirm({ title: t("settings.removeKeyTitle", { provider: name }), body: t(id === "openai" ? "llmSettings.removeSharedKey" : "settings.removeKeyConfirm"), confirmLabel: t("settings.removeKey"), danger: true })) {
      run(`del:${id}`, () => api(`/keys/${id}`, { method: "DELETE" }));
    }
  };
  const revoke = async (id) => {
    const name = t(`llmProviders.${id}.name`);
    if (await confirm({ title: t("settings.revokeTitle", { provider: name }), body: t("llmSettings.revokeConfirm", { provider: name }), confirmLabel: t("settings.revoke") })) {
      run(`consent:${id}`, () => api("/me/consents", { method: "PUT", body: { provider: llmConsentId(id), granted: false } }));
    }
  };
  const saveModel = (id, value, current) => {
    const v = value.trim();
    if (v === current) return;
    run(`model:${id}`, () => api("/me/llm", { method: "PUT", body: { models: { [id]: v } } }));
  };
  const saveInstructions = async () => {
    if (await run("instructions", () => api("/me/llm", { method: "PUT", body: { instructions } }))) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-surface p-5 shadow-sm">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        <Sparkles className="h-4 w-4 text-indigo-600" /> {t("llmSettings.title")}
      </h2>
      <p className="mt-1 text-sm text-slate-600">{t("llmSettings.hint")}</p>
      {error && <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      <div role="radiogroup" aria-label={t("llmSettings.title")} className="mt-4 space-y-3">
        {providers.map((p) => {
          const id = p.id;
          const chosen = me.llm.provider === id;
          const name = t(`llmProviders.${id}.name`);
          const consented = me.consents.includes(llmConsentId(id));
          return (
            <div key={id} className={`rounded-xl border p-4 transition ${chosen ? "border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200" : "border-slate-200"}`}>
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  aria-label={t("settings.useProvider", { provider: name })}
                  disabled={busy !== null}
                  onClick={() => !chosen && run(`use:${id}`, () => api("/me/llm", { method: "PUT", body: { provider: id } }))}
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${chosen ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 hover:border-indigo-400"}`}
                >
                  {chosen && <Check className="h-3 w-3" strokeWidth={3} />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{name}</span>
                    {!p.needsKey ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">{t("llmSettings.noKeyNeeded")}</span>
                    ) : p.ownKey ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
                        <KeyRound className="h-3 w-3" /> {t("settings.ownKey", { last4: p.ownKey.last4 })}
                      </span>
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
                    {t(`llmProviders.${id}.where`)} · {t(`llmProviders.${id}.privacy`)}
                  </p>

                  {chosen && (
                    <label className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                      <span>{t("llmSettings.model")}</span>
                      <input
                        key={`${id}-${p.model}`}
                        defaultValue={p.model === p.defaultModel ? "" : p.model}
                        placeholder={p.defaultModel}
                        spellCheck={false}
                        onBlur={(e) => saveModel(id, e.target.value, p.model === p.defaultModel ? "" : p.model)}
                        className={`${input} w-56 font-mono`}
                      />
                      {busy === `model:${id}` && <Loader2 className="h-4 w-4 animate-spin" />}
                    </label>
                  )}

                  {p.needsKey && editing === id ? (
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
                        className={`${input} basis-full font-mono sm:flex-1 sm:basis-0`}
                        aria-label={t("settings.keyFor", { provider: name })}
                      />
                      <button type="submit" disabled={!draft.trim() || busy !== null} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                        {busy === `key:${id}` && <Loader2 className="h-4 w-4 animate-spin" />} {t("settings.saveKey")}
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
                        {t("common.cancel")}
                      </button>
                      <p className="w-full text-xs text-slate-500">{t(id === "openai" ? "llmSettings.sharedKey" : "settings.keySafety")}</p>
                    </form>
                  ) : (
                    me.keysEnabled && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                        {p.needsKey && (
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
                        )}
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

      <div className="mt-5 space-y-2">
        <label htmlFor="minutes-instructions" className="block text-sm font-medium text-slate-800">
          {t("llmSettings.instructions")}
        </label>
        <p className="text-xs text-slate-500">{t("llmSettings.instructionsHint")}</p>
        <textarea
          id="minutes-instructions"
          value={instructions}
          maxLength={2000}
          rows={4}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={t("llmSettings.instructionsPlaceholder")}
          className="w-full rounded-xl border border-slate-300 bg-surface p-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
        <button
          type="button"
          onClick={saveInstructions}
          disabled={busy !== null || instructions === (me.llm?.instructions ?? "")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-surface px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {saved ? <Check className="h-4 w-4 text-emerald-600" /> : busy === "instructions" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {saved ? t("llmSettings.saved") : t("settings.saveKey")}
        </button>
      </div>

      {me.llm?.usage?.length > 0 && (
        <p className="mt-4 text-xs text-slate-500">
          {t("llmSettings.usage")}{" "}
          {me.llm.usage
            .map((u) => t("llmSettings.usageLine", { provider: t(`llmProviders.${u.provider}.name`), requests: u.requests, tokens: fmt((u.input_tokens || 0) + (u.output_tokens || 0)) }))
            .join(" · ")}
        </p>
      )}
    </section>
  );
}
