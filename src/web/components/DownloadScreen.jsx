import { useEffect, useState } from "react";
import { Download, Laptop, Loader2 } from "lucide-react";
import { useI18n } from "../i18n";
import { detectOs, feedVersion, installerFile } from "../lib/desktop";
import { Shell } from "./LoginScreen";

/**
 * /descargar: the desktop app for Mac and Windows (docs/adr/0005). Public, like any download page.
 * The versions come from the same feeds the app's updater reads.
 */
export default function DownloadScreen() {
  const { t } = useI18n();
  const [versions, setVersions] = useState(null);
  const os = detectOs(navigator.userAgent);

  useEffect(() => {
    const feed = (name) =>
      fetch(`/api/desktop/${name}`)
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => "");
    Promise.all([feed("latest.yml"), feed("latest-mac.yml")]).then(([win, mac]) => setVersions({ windows: feedVersion(win), mac: feedVersion(mac) }));
  }, []);

  const button = (kind, label, primary) => {
    const version = kind === "windows" ? versions.windows : versions.mac;
    if (!version) return null;
    return (
      <a
        key={kind}
        href={`/api/desktop/${installerFile(version, kind)}`}
        className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-sm ${
          primary ? "bg-indigo-600 text-white hover:bg-indigo-700" : "border border-slate-300 bg-surface text-slate-800 hover:bg-slate-50"
        }`}
      >
        <Download className="h-4 w-4" /> {label}
      </a>
    );
  };

  const order = os === "windows" ? ["windows", "mac", "mac-intel"] : ["mac", "mac-intel", "windows"];
  const labels = { windows: t("download.windows"), mac: t("download.macApple"), "mac-intel": t("download.macIntel") };

  return (
    <Shell icon={<Laptop className="h-7 w-7" />}>
      <h1 className="text-2xl font-bold tracking-tight">{t("download.title")}</h1>
      <p className="mt-2 text-sm text-slate-600">{t("download.intro")}</p>
      {!versions ? (
        <Loader2 className="mx-auto mt-6 h-6 w-6 animate-spin text-slate-400" />
      ) : !versions.windows && !versions.mac ? (
        <p className="mt-6 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("download.none")}</p>
      ) : (
        <>
          <p className="mt-4 text-xs text-slate-500">{t("download.version", { version: versions.mac ?? versions.windows })}</p>
          <div className="mt-3 space-y-2">{order.map((kind, i) => button(kind, labels[kind], i === 0))}</div>
          <ul className="mt-5 space-y-2 text-left text-xs leading-relaxed text-slate-500">
            <li>{t("download.macFirstOpen")}</li>
            <li>{t("download.winFirstOpen")}</li>
            <li>{t("download.updates")}</li>
            <li>{t("download.needs")}</li>
          </ul>
        </>
      )}
      <a href="/" className="mt-6 inline-block text-sm font-medium text-indigo-700 hover:underline">
        {t("download.back")}
      </a>
    </Shell>
  );
}
