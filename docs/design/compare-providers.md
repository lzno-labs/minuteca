# Design: comparing transcription providers and language models

- **Issue:** owner request, 2026-11-11 ("configure several AI providers, pick one on each generation screen, to see which does better")
- **Status:** Implemented
- **Author:** founding agent (claude)
- **Touches:** data (several transcripts and minutes per meeting), AI (same consent and key rules)

## Goal

A person keeps keys for several providers and, for each meeting, tries more than one: transcribe again with another provider (or on the computer with the desktop app) and write the minutes with another language model, then keep whichever is better. Nothing is replaced silently.

## Relevant ADRs

- ADR-0002: one transcript format; versions are whole transcripts in that format. ADR-0004: `runLlm()` is still the only path to a language model. ADR-0005: local transcripts are versions like any other.

## Approach

- **Transcription:** the transcribe panel shows "Con [proveedor]" with every provider (those without a key say so). A finished meeting has "Transcribir de nuevo" in its menu; `POST /transcribe` with `again: true` accepts a `done` meeting.
  - When the new transcript arrives (`finishMeeting`, or `finishLocal` from the desktop app), the current one moves to `transcript_versions` (migration `0004`) with its provider, model and voice names; the newest 5 are kept. Voice names start over for the new one.
  - If the new transcription fails, the meeting stays `done` with the old transcript and its provider, and `error` says why; the app shows it above the versions.
  - "Usar esta" (`POST /transcripts/:version/use`) swaps a version back in with its names; the current one becomes a version. Versions can be deleted. The meeting lists them without text (`transcriptVersions`); the export includes their text (`earlierTranscripts`).
- **Language models:** described in `docs/design/minutes-with-llm.md` (choice per generation, minutes versions, every voice named).
- **Costs:** each transcription and each generation is a new call, paid as before (the person's key, or Lzno's within its cap); the app does not repeat anything on its own.

## Risks

- Storage: a transcript of a long meeting is up to about 1 MB; 5 versions per meeting stay far inside D1's limits, and everything is deleted with the meeting after 30 days.
- Minutes written from an earlier transcript keep their text; they say which model wrote them, not which transcript, so people compare with that in mind.
