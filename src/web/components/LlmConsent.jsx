import { useCallback, useState } from "react";
import { api } from "../lib/api";
import { llmConsentId } from "../lib/llm";
import { useI18n } from "../i18n";
import Dialog from "./Dialog";

/**
 * Asks once per provider before a transcript is sent to a language model (AGENTS: nothing about a
 * person leaves towards an AI without explicit permission). The server refuses without it too.
 * const { ensure, dialog } = useLlmConsent(me, onMeChange); if (await ensure()) ...
 */
export function useLlmConsent(me, onMeChange) {
  const { t } = useI18n();
  const [pending, setPending] = useState(null); // { resolve }
  const id = me?.llm?.provider;
  const name = id ? t(`llmProviders.${id}.name`) : "";

  const ensure = useCallback(() => {
    if (!id) return Promise.resolve(false);
    if (me.consents.includes(llmConsentId(id))) return Promise.resolve(true);
    return new Promise((resolve) => setPending({ resolve }));
  }, [id, me]);

  const close = async (granted) => {
    const p = pending;
    setPending(null);
    if (granted) {
      try {
        await api("/me/consents", { method: "PUT", body: { provider: llmConsentId(id), granted: true } });
        await onMeChange?.();
      } catch {
        p?.resolve(false);
        return;
      }
    }
    p?.resolve(granted);
  };

  const dialog = (
    <Dialog
      open={Boolean(pending)}
      onClose={() => close(false)}
      title={t("llmConsent.title", { provider: name })}
      actions={
        <>
          <button type="button" onClick={() => close(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
            {t("common.cancel")}
          </button>
          <button type="button" autoFocus onClick={() => close(true)} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            {t("llmConsent.accept")}
          </button>
        </>
      }
    >
      {id === "local" ? (
        <p>{t("llmConsent.bodyLocal")}</p>
      ) : (
        <>
          <p>{t("llmConsent.body", { provider: name, where: id ? t(`llmProviders.${id}.where`) : "" })}</p>
          {id && <p>{t(`llmProviders.${id}.privacy`)}</p>}
          <p>{t("consent.others")}</p>
        </>
      )}
      <p className="text-xs text-slate-500">{t("llmConsent.revoke")}</p>
    </Dialog>
  );

  return { ensure, dialog };
}
