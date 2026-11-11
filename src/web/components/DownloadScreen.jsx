import { Download, Laptop } from "lucide-react";
import { useI18n } from "../i18n";
import { detectOs, installerUrl, RELEASES } from "../lib/desktop";
import { Shell } from "./LoginScreen";

/**
 * /descargar: the desktop app for Mac and Windows (docs/adr/0005). Public, like any download page;
 * the files are the newest GitHub release of the open core, the same the app's updater reads.
 */
export default function DownloadScreen() {
  const { t } = useI18n();
  const os = detectOs(navigator.userAgent);
  const order = os === "windows" ? ["windows", "mac", "mac-intel"] : ["mac", "mac-intel", "windows"];
  const labels = { windows: t("download.windows"), mac: t("download.macApple"), "mac-intel": t("download.macIntel") };

  return (
    <Shell icon={<Laptop className="h-7 w-7" />}>
      <h1 className="text-2xl font-bold tracking-tight">{t("download.title")}</h1>
      <p className="mt-2 text-sm text-slate-600">{t("download.intro")}</p>
      <div className="mt-5 space-y-2">
        {order.map((kind, i) => (
          <a
            key={kind}
            href={installerUrl(kind)}
            className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-sm ${
              i === 0 ? "bg-indigo-600 text-white hover:bg-indigo-700" : "border border-slate-300 bg-surface text-slate-800 hover:bg-slate-50"
            }`}
          >
            <Download className="h-4 w-4" /> {labels[kind]}
          </a>
        ))}
      </div>
      <ul className="mt-5 space-y-2 text-left text-xs leading-relaxed text-slate-500">
        <li>{t("download.macFirstOpen")}</li>
        <li>{t("download.winFirstOpen")}</li>
        <li>{t("download.updates")}</li>
        <li>{t("download.needs")}</li>
      </ul>
      <div className="mt-6 flex flex-col items-center gap-2 text-sm">
        <a href={RELEASES} className="font-medium text-indigo-700 hover:underline">
          {t("download.allVersions")}
        </a>
        <a href="/" className="font-medium text-indigo-700 hover:underline">
          {t("download.back")}
        </a>
      </div>
    </Shell>
  );
}
