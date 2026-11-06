# ADR-0002: Our own transcript format and several providers

- **Status:** Accepted
- **Date:** 2026-11-06
- **Supersedes:** none
- **Author:** founding agent (claude)

## Context

The previous version stored Deepgram's answer shape and called Deepgram directly. The PRD asks for no dependency on one provider: Deepgram, AssemblyAI and OpenAI in the first version, each person's own key, and adding a provider by adding an adapter. Recordings are work meetings with other people's voices, so each provider's policy on training with customer audio matters, and the app must show which provider processed each meeting.

## Options

1. **Keep Deepgram's shape** and translate other providers into it. Ties the stored data and the exports to one vendor's schema.
2. **A third party abstraction service** that fronts many providers. Another account, another place where audio goes, and its own lock-in.
3. **Our own format plus one adapter per provider** behind a `Transcriber` interface.

## Decision

Option 3. The format, stored in the database and exported as JSON:

```json
{
  "format": "minuteca-transcript", "version": 1,
  "provider": "deepgram", "model": "nova-3", "language": "es", "duration": 3725.4,
  "blocks": [{ "speaker": 0, "start": 0.0, "end": 4.2, "text": "Buenos días.", "sentences": [{ "start": 0.0, "end": 4.2, "text": "Buenos días." }] }]
}
```

Speakers are numbers from 0 in order of first appearance; names are kept apart (`speakerNames`) so a correction never rewrites text. Changing which voice a block belongs to is the only edit to blocks. `version` grows only with a new ADR.

Each adapter in `src/server/transcriber/` implements `start` (by link or by bytes), `callback` or `poll` for late answers, `fromRaw` (pure, also used in the browser, ADR-0001), `checkKey` and, where useful, `forget`. Every call goes through `startTranscription()` (`src/server/transcription.ts`), the single place that checks permission, picks the key and meters minutes.

What each provider does with the audio, as of this ADR (to be checked again before relying on it; sources: [Deepgram MIP](https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program), [AssemblyAI data retention and model training](https://www.assemblyai.com/docs/data-retention-and-model-training), [AssemblyAI opt out](https://www.assemblyai.com/docs/faq/how-to-opt-out-of-data-sharing-for-model-training)):

| Provider | Model | Training with our audio | What we do |
| --- | --- | --- | --- |
| Deepgram | nova-3, diarization | Requests are part of its Model Improvement Program unless they send `mip_opt_out=true`; opted out requests are kept only while processed. Opting out raises the price per minute (Deepgram does not publish by how much). | Every request sends `mip_opt_out=true`: these are work meetings with other people's voices. Operaciones compares the cost per minute in the Deepgram usage log after the first transcriptions. |
| AssemblyAI | universal, speaker labels | Its FAQ says it does not train on customer data today, but its terms allow it. Paid accounts can opt out in the dashboard (Data Controls); it is an account setting, not a request parameter. | The settings page tells people using their own key to turn on that opt out. After we have the result we `DELETE` the transcript at AssemblyAI. |
| OpenAI | gpt-4o-transcribe-diarize | API data is not used for training by default; it may be kept up to 30 days for abuse monitoring. | Nothing extra. Files over 25 MB are refused before sending. |

The app shows the provider of each meeting, asks for explicit permission per provider before the first transcription (stored on the server, which refuses without it) and says where the audio goes before every transcription.

## Consequences

- Exports and stored data do not change when the provider changes. Old Firebase meetings are not migrated (PRD): they expire on their own.
- Each adapter maps its own speaker labels; quality differs between providers and people can switch.
- Adding a provider: one adapter, its texts in `locales/`, its row in this table (a new ADR if it changes the format).
- Revisit when a provider changes its data policy, or when the format needs fields a provider cannot fill.
