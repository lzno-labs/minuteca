import { describe, expect, it } from "vitest";
import { audioMimeType, fileExtension, titleFromFileName } from "../../src/web/lib/audioFile";

describe("audio file helpers", () => {
  it("detects types by extension first", () => {
    expect(audioMimeType({ name: "Nota de voz.m4a", type: "audio/x-m4a" })).toBe("audio/mp4");
    expect(audioMimeType({ name: "call.AMR", type: "" })).toBe("audio/amr");
    expect(audioMimeType({ name: "zoom.mov", type: "video/quicktime" })).toBe("video/quicktime");
  });
  it("falls back to the browser type, rejects non-audio", () => {
    expect(audioMimeType({ name: "rec", type: "audio/x-custom" })).toBe("audio/x-custom");
    expect(audioMimeType({ name: "notes.pdf", type: "application/pdf" })).toBeNull();
    expect(audioMimeType({ name: "noext", type: "" })).toBeNull();
  });
  it("derives titles and extensions", () => {
    expect(titleFromFileName("Reunión_directorio.m4a")).toBe("Reunión directorio");
    expect(titleFromFileName(".m4a")).toBe("Uploaded meeting");
    expect(fileExtension("a.b.WAV")).toBe("wav");
  });
});
