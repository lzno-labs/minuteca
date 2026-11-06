import { Languages } from "lucide-react";
import { LANGUAGES, useI18n } from "../i18n";

/** EN | ES toggle for the interface language (remembered per browser). */
export default function LanguageSwitch({ className = "" }) {
  const { t, lang, setLanguage } = useI18n();
  return (
    <div
      role="group"
      aria-label={t("common.interfaceLanguage")}
      title={t("common.interfaceLanguage")}
      className={`inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold ${className}`}
    >
      <Languages className="ml-1 hidden h-3.5 w-3.5 text-slate-400 sm:block" aria-hidden />
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          lang={l.code}
          onClick={() => setLanguage(l.code)}
          aria-pressed={lang === l.code}
          aria-label={l.label}
          className={`rounded-md px-2 py-1 transition ${
            lang === l.code ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}
