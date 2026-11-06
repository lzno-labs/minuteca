import { describe, expect, it } from "vitest";
import {
  buildCues,
  defaultMeetingTitle,
  fileBaseName,
  formatClock,
  formatSrtTime,
  mergeBySpeakerName,
  speakerStats,
  splitText,
  toAiText,
  toSrt,
  toTxt,
} from "../../src/web/lib/format";

const meeting = {
  title: "Meeting - 2026-10-24 09:00",
  date: "2026-10-24T09:00:00",
  duration: 125,
  speakerNames: { 0: "Sarah (Director)", 1: "Dave (Finance)" },
  utterances: [
    { speaker: 0, start: 1.24, end: 4.56, text: "Let's start the review." },
    { speaker: 1, start: 5.1, end: 8.3, text: "We are currently 5% under budget." },
  ],
};

describe("time formatting", () => {
  it("formats SRT timestamps", () => {
    expect(formatSrtTime(0)).toBe("00:00:00,000");
    expect(formatSrtTime(3725.4)).toBe("01:02:05,400");
    expect(formatSrtTime(59.9996)).toBe("00:01:00,000");
  });
  it("formats clocks", () => {
    expect(formatClock(125)).toBe("02:05");
    expect(formatClock(125, true)).toBe("00:02:05");
    expect(formatClock(3725)).toBe("01:02:05");
  });
  it("builds the default title", () => {
    expect(defaultMeetingTitle(new Date(2026, 9, 4, 8, 5))).toBe("Meeting - 2026-10-04 08:05");
  });
});

describe("Copy (LLM-ready text)", () => {
  it("produces the LLM-ready block", () => {
    expect(toAiText(meeting)).toBe(
      "[Meeting: October 24, 2026]\n" +
        "[Duration: 2 min 5 s]\n" +
        "[Participants: Sarah (Director), Dave (Finance)]\n\n" +
        "Sarah (Director): Let's start the review.\n" +
        "Dave (Finance): We are currently 5% under budget.\n",
    );
  });
  it("includes custom titles and falls back to Speaker N", () => {
    const text = toAiText({ ...meeting, title: "Budget review", speakerNames: {} });
    expect(text).toContain("[Title: Budget review]");
    expect(text).toContain("Speaker 1: Let's start the review.");
  });
});

describe("speaker handling", () => {
  it("merges consecutive blocks sharing a name", () => {
    const merged = mergeBySpeakerName(
      [
        { speaker: 0, start: 0, end: 1, text: "Hi." },
        { speaker: 2, start: 1, end: 2, text: "Again." },
        { speaker: 1, start: 2, end: 3, text: "Hello." },
      ],
      { 0: "Ana", 2: "Ana" },
    );
    expect(merged.map((m) => [m.name, m.text])).toEqual([
      ["Ana", "Hi. Again."],
      ["Speaker 2", "Hello."],
    ]);
  });
  it("computes stats in order of appearance", () => {
    expect(speakerStats(meeting.utterances).map((s) => s.speaker)).toEqual([0, 1]);
  });
});

describe("exports", () => {
  it("writes TXT with timestamps and paragraph breaks", () => {
    const txt = toTxt(meeting);
    expect(txt).toContain("[00:01] Sarah (Director):\nLet's start the review.\n\n[00:05] Dave (Finance):");
  });

  it("writes valid SRT", () => {
    expect(toSrt(meeting)).toBe(
      "1\n00:00:01,240 --> 00:00:04,560\nSarah (Director): Let's start the review.\n\n" +
        "2\n00:00:05,100 --> 00:00:08,300\nDave (Finance): We are\ncurrently 5% under budget.\n",
    );
  });

  it("splits long text into cues with proportional, non-overlapping timing", () => {
    const long = "word ".repeat(60).trim();
    const cues = buildCues([{ speaker: 0, start: 0, end: 30, text: long }], {});
    expect(cues.length).toBeGreaterThan(1);
    for (const c of cues) expect(c.text.length).toBeLessThanOrEqual(84 + "Speaker 1: ".length);
    for (let i = 1; i < cues.length; i++) expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end);
    expect(cues.at(-1).end).toBeCloseTo(30, 5);
  });

  it("uses sentence timings when present", () => {
    const cues = buildCues(
      [
        {
          speaker: 1,
          start: 0,
          end: 10,
          text: "One. Two.",
          sentences: [
            { start: 0, end: 2, text: "One." },
            { start: 6, end: 10, text: "Two." },
          ],
        },
      ],
      {},
    );
    expect(cues).toEqual([
      { start: 0, end: 2, text: "Speaker 2: One." },
      { start: 6, end: 10, text: "Two." },
    ]);
  });

  it("splits on word boundaries", () => {
    expect(splitText("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
  });

  it("makes safe file names", () => {
    expect(fileBaseName("Reunión: Q3 / Budget?")).toBe("Reunion_Q3_Budget");
  });
});

describe("exports in Spanish", () => {
  it("translates labels, dates and default speaker names", async () => {
    const { setLanguage } = await import("../../src/web/i18n");
    setLanguage("es");
    try {
      const text = toAiText({ ...meeting, title: defaultMeetingTitle(new Date(2026, 9, 24, 9, 0)), speakerNames: { 1: "Dave (Finanzas)" } });
      expect(text).toBe(
        "[Reunión: 24 de octubre de 2026]\n" +
          "[Duración: 2 min 5 s]\n" +
          "[Participantes: Persona 1, Dave (Finanzas)]\n\n" +
          "Persona 1: Let's start the review.\n" +
          "Dave (Finanzas): We are currently 5% under budget.\n",
      );
      expect(toTxt(meeting)).toContain("Fecha: sábado, 24 de octubre de 2026");
    } finally {
      setLanguage("en");
    }
  });
});
