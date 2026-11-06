import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";

const BARS = 24;

/**
 * Live input level from a Web Audio AnalyserNode. Draws straight to the DOM
 * in a rAF loop so 60 fps updates never re-render React.
 */
export default function AudioLevelMeter({ analyser, active }) {
  const { t } = useI18n();
  const barsRef = useRef([]);

  useEffect(() => {
    const bars = barsRef.current;
    if (!analyser || !active) {
      bars.forEach((b) => b && (b.style.transform = "scaleY(0.08)"));
      return undefined;
    }
    const data = new Float32Array(analyser.fftSize);
    let raf;
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length);
      // Map -60 dBFS..0 dBFS → 0..1
      const db = 20 * Math.log10(rms || 1e-8);
      const level = Math.min(1, Math.max(0, (db + 60) / 60));
      const lit = Math.round(level * BARS);
      for (let i = 0; i < BARS; i++) {
        const b = bars[i];
        if (!b) continue;
        const on = i < lit;
        b.style.transform = `scaleY(${on ? 0.35 + (0.65 * (i + 1)) / BARS : 0.08})`;
        b.style.opacity = on ? "1" : "0.35";
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [analyser, active]);

  return (
    <div className="flex h-10 items-center gap-[3px]" role="meter" aria-label={t("recorder.micLevel")}>
      {Array.from({ length: BARS }, (_, i) => (
        <span
          key={i}
          ref={(el) => (barsRef.current[i] = el)}
          className={`h-full w-1.5 origin-center rounded-full transition-transform duration-75 ${
            i < BARS * 0.65 ? "bg-emerald-500" : i < BARS * 0.85 ? "bg-amber-500" : "bg-rose-500"
          }`}
          style={{ transform: "scaleY(0.08)", opacity: 0.35 }}
        />
      ))}
    </div>
  );
}
