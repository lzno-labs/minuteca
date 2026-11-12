import { readyLlms } from "../lib/llm";
import { useI18n } from "../i18n";

/**
 * Which configured language model to use for this generation, so people can compare them
 * (docs/design/minutes-with-llm.md). Shown only when more than one is ready.
 */
export default function LlmChoice({ me, value, onChange, disabled }) {
  const { t } = useI18n();
  const ready = readyLlms(me);
  if (ready.length < 2) return null;
  return (
    <label className="inline-flex items-center gap-1.5 text-sm text-slate-600">
      <span>{t("llmChoice.with")}</span>
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-300 bg-surface py-1 pl-2 pr-7 text-sm font-medium text-slate-800 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
      >
        {ready.map((id) => (
          <option key={id} value={id}>
            {t(`llmProviders.${id}.name`)}
            {id === me.llm.provider ? ` (${t("llmChoice.default")})` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
