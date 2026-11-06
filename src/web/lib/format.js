/** Formatting helpers for transcripts and exports (unit-tested). */
import { getLocale, t } from "../i18n";

export function defaultSpeakerName(speaker) {
  return t("speakers.default", { n: speaker });
}

export function speakerName(speakerNames, speaker) {
  const name = speakerNames?.[speaker];
  return name && name.trim() ? name.trim() : defaultSpeakerName(speaker);
}

/** Unique speakers in order of first appearance, with talk time and segment count. */
export function speakerStats(utterances) {
  const map = new Map();
  for (const u of utterances) {
    const s = map.get(u.speaker) || { speaker: u.speaker, segments: 0, seconds: 0 };
    s.segments += 1;
    s.seconds += Math.max(0, u.end - u.start);
    map.set(u.speaker, s);
  }
  return [...map.values()];
}

/** Resolved participant names, deduplicated (two speaker ids may share a name). */
export function participants(utterances, speakerNames) {
  return [...new Set(speakerStats(utterances).map((s) => speakerName(speakerNames, s.speaker)))];
}

/**
 * Merges consecutive utterances that resolve to the same display name. This
 * matters when diarization split one person into two ids and the user gave
 * both the same name.
 */
export function mergeBySpeakerName(utterances, speakerNames) {
  const out = [];
  for (const u of utterances) {
    const name = speakerName(speakerNames, u.speaker);
    const last = out[out.length - 1];
    if (last && last.name === name) {
      last.text += ` ${u.text}`;
      last.end = u.end;
    } else {
      out.push({ name, start: u.start, end: u.end, text: u.text });
    }
  }
  return out;
}

/** 3725.4 → "01:02:05"; under an hour → "02:05" unless forceHours. */
export function formatClock(seconds, forceHours = false) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 || forceHours ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 3725.4 → "1h 2m"; 95 → "1m 35s". */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** SRT timestamp: 3725.4 → "01:02:05,400". */
export function formatSrtTime(seconds) {
  const ms = Math.max(0, Math.round((seconds || 0) * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(r, 3)}`;
}

export function defaultMeetingTitle(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
  return t("meeting.defaultTitle", { date: stamp });
}

/** True for auto-generated titles ("Meeting - …" / "Reunión - …") in any language. */
export function isDefaultTitle(title = "") {
  return /^\S+ - \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(title);
}

export function formatLongDate(iso, locale = getLocale()) {
  return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
}

/**
 * LLM-ready block for pasting into a company AI assistant:
 *
 *   [Meeting: October 24, 2026]
 *   [Title: Budget review]
 *   [Duration: 45m 12s]
 *   [Participants: Sarah (Director), Dave (Finance)]
 *
 *   Sarah (Director): Let's start the review.
 *   Dave (Finance): We are currently 5% under budget.
 */
export function toAiText(meeting, locale = getLocale()) {
  const { title, date, duration, utterances, speakerNames } = meeting;
  const header = [`[${t("exportText.meeting")}: ${formatLongDate(date, locale)}]`];
  if (title && !isDefaultTitle(title)) {
    header.push(`[${t("exportText.title")}: ${title}]`);
  }
  if (duration) header.push(`[${t("exportText.duration")}: ${formatDuration(duration)}]`);
  const people = participants(utterances, speakerNames);
  if (people.length) header.push(`[${t("exportText.participants")}: ${people.join(", ")}]`);

  const body = mergeBySpeakerName(utterances, speakerNames).map((b) => `${b.name}: ${b.text}`);
  return `${header.join("\n")}\n\n${body.join("\n")}\n`;
}

/** Human-readable transcript with a header, timestamps and paragraph breaks. */
export function toTxt(meeting, locale = getLocale()) {
  const { title, date, duration, utterances, speakerNames } = meeting;
  const lines = [
    title || t("exportText.meeting"),
    `${t("exportText.date")}: ${new Date(date).toLocaleString(locale, { dateStyle: "full", timeStyle: "short" })}`,
  ];
  if (duration) lines.push(`${t("exportText.duration")}: ${formatDuration(duration)}`);
  const people = participants(utterances, speakerNames);
  if (people.length) lines.push(`${t("exportText.participants")}: ${people.join(", ")}`);
  lines.push("", "=".repeat(60), "");

  const forceHours = (duration || 0) >= 3600;
  for (const u of utterances) {
    lines.push(`[${formatClock(u.start, forceHours)}] ${speakerName(speakerNames, u.speaker)}:`);
    lines.push(u.text, "");
  }
  return lines.join("\n");
}

const SRT_MAX_CHARS = 84; // ~2 lines of 42 chars, the common broadcast guideline
const SRT_MAX_SECONDS = 7;

/** Splits text into chunks of at most maxChars on word boundaries. */
export function splitText(text, maxChars = SRT_MAX_CHARS) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  let cur = "";
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > maxChars) {
      out.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Wraps a cue into at most two balanced lines. */
function wrapCue(text, lineMax = 42) {
  if (text.length <= lineMax) return text;
  const mid = Math.floor(text.length / 2);
  let cut = text.lastIndexOf(" ", mid);
  const after = text.indexOf(" ", mid);
  if (cut === -1 || (after !== -1 && after - mid < mid - cut)) cut = after;
  if (cut === -1) return text;
  return `${text.slice(0, cut)}\n${text.slice(cut + 1)}`;
}

/** Builds timed cues, preferring sentence timings, splitting long text proportionally. */
export function buildCues(utterances, speakerNames) {
  const cues = [];
  for (const u of utterances) {
    const name = speakerName(speakerNames, u.speaker);
    const pieces = u.sentences?.length ? u.sentences : [{ start: u.start, end: u.end, text: u.text }];
    let first = true;
    for (const p of pieces) {
      const parts = splitText(p.text);
      const span = Math.max(0.001, p.end - p.start);
      const totalChars = parts.reduce((n, t) => n + t.length, 0) || 1;
      let t = p.start;
      for (const part of parts) {
        const dur = (span * part.length) / totalChars;
        let start = t;
        let end = t + dur;
        t = end;
        // Very long single chunks still get capped for readability.
        if (end - start > SRT_MAX_SECONDS && parts.length === 1) end = start + SRT_MAX_SECONDS;
        // Label the speaker on the first cue of each turn only.
        const text = first ? `${name}: ${part}` : part;
        first = false;
        cues.push({ start, end, text });
      }
    }
  }
  // Enforce monotonic, non-overlapping cues with a minimum visible duration.
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (i > 0 && c.start < cues[i - 1].end) c.start = cues[i - 1].end;
    if (c.end - c.start < 0.5) c.end = c.start + 0.5;
    const next = cues[i + 1];
    if (next && c.end > next.start && next.start > c.start + 0.5) c.end = next.start;
  }
  return cues;
}

export function toSrt(meeting) {
  return (
    buildCues(meeting.utterances, meeting.speakerNames)
      .map((c, i) => `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${wrapCue(c.text)}\n`)
      .join("\n")
  );
}

/** Safe file name from a meeting title. */
/** The meeting in minuteca's open transcript format (docs/adr/0002-transcripts-and-providers.md). */
export function toJson(meeting) {
  return `${JSON.stringify(
    {
      format: "minuteca-transcript",
      version: 1,
      title: meeting.title,
      date: meeting.date,
      duration: meeting.duration,
      language: meeting.language ?? null,
      provider: meeting.transcript?.provider ?? meeting.provider ?? null,
      model: meeting.transcript?.model ?? null,
      speakerNames: meeting.speakerNames || {},
      blocks: (meeting.utterances || []).map(({ speaker, start, end, text, sentences }) => ({ speaker, start, end, text, ...(sentences ? { sentences } : {}) })),
    },
    null,
    2,
  )}\n`;
}

export function fileBaseName(title) {
  return (
    (title || "meeting")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\w\s.-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 80) || "meeting"
  );
}

export function audioExtension(mimeType = "") {
  if (mimeType.includes("mp4") || mimeType.includes("aac")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("flac")) return "flac";
  return "webm";
}

export function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
