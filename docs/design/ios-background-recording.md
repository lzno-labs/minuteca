# Design: recording in the background on iPhone and uploading without losing audio

- **Issue:** PRD of minuteca (`productos/minuteca/prd.md` in lzno-labs/empresa, approved 2026-11-06)
- **Status:** Implemented in the first version; needs the device checks below
- **Author:** founding agent (claude)
- **Touches:** data (meeting audio on the phone and in transit), more than one day of work

## Goal

The iPhone keeps recording with the screen locked, while another app is in front, and across a phone call; a crash or a killed app loses as little as possible; the audio reaches the server when there is signal, without the person waiting with the app open, and the app says when something is not uploaded yet. Out of scope: transcribing, editing or exporting in the app (the web does it), Android.

## Relevant ADRs

- ADR-0003: sign-in with the app's verifier; the bearer token lives in the Keychain (readable after first unlock, this device only), so uploads work while locked.
- ADR-0001: the upload streams to R2; 95 MB per file.

## Approach

**Recording.** `AVAudioSession` category `.record` and `UIBackgroundModes: audio`, so iOS keeps the microphone with the screen locked or in another app. AAC in `.m4a`, mono, 24 kHz, 32 kbit/s (about 14 MB per hour).

**Segments.** `AVAudioRecorder` writes an `.m4a` index only when it stops, so a killed app would leave an unreadable file. The recorder therefore closes the running file and opens a new one every 2 minutes (`Segments.maxLength`), and also when an interruption starts. Each segment is listed in the store before it gets audio. A crash loses at most the last 2 minutes; the gap between segments is a few milliseconds.

**Interruptions.** On `interruptionNotification .began` (a call, Siri, an alarm) the segment is closed (its audio is safe) and the status shows "Interrumpida". On `.ended` the session is reactivated and a new segment starts; if iOS does not give the microphone back yet, the app tries again when it comes to the front. iOS does not let apps record the call itself; the meeting audio before and after it is kept. A media services reset is handled the same way.

**State on disk.** `RecordingStore` (MinutecaKit) keeps `recordings.json` next to one folder per recording, written atomically on every change. States: `recording`, `stopped`, `ready`, `created`, `uploaded`. On launch, any `recording` left behind becomes `stopped` and is flagged as recovered.

**Upload.** Each step is saved before the next one runs:

1. `stopped` to `ready`: join the readable segments with `AVMutableComposition` and an export session (passthrough, re-encoding as fallback). Unreadable segments (the one being written during a crash) are skipped.
2. `ready` to `created`: `POST /api/meetings` with the recording's own id (idempotent).
3. `created` to `uploaded`: `PUT /api/meetings/:id/audio` from the file with a background `URLSession`, which iOS completes even if the app is suspended or closed; iOS relaunches the app to report the result. A 409 means the server already has it.

4. Once the server has the audio, it starts the transcription on its own with the person's chosen provider, but only if that person already gave permission for that provider (the permission dialog says that iPhone recordings are then transcribed automatically). Without permission or without a key, the meeting waits in the web app under "Por transcribir". The upload never waits for the transcription.

Uploaded rows open the meeting in the web app (`/?m=<id>`), where it is transcribed, named and shared.

Retries run when the network comes back (`NWPathMonitor`), when the app comes to the front, on pull to refresh and with "Subir ahora". The list shows each recording's state and the last problem (no signal, signed out, too large). Local audio is deleted 7 days after it is uploaded; list entries after 31 days.

## Alternatives considered

- One long `.m4a` per recording: one crash loses the whole meeting.
- Linear PCM or CAF that can be recovered after a crash: 10 to 20 times larger files.
- Uploading segments and joining them on the server: needs audio tools on the server, not available on Workers.
- `BGProcessingTask` for uploads: runs when iOS decides; background `URLSession` starts right away.

## Risks and safeguards

- **Data:** audio stays in Application Support (not in Files, removed with the app) until uploaded and 7 days more; nothing goes to a transcription provider from the phone. Signing out keeps unsent recordings on the phone.
- **Security:** the bearer token is in the Keychain; Face ID covers the screens.
- **Battery and storage:** about 14 MB per hour; the screen can lock while recording.

## Testing and rollout

MinutecaKit tests (Linux CI): states, segment rules, the store surviving a restart, recovery, purging only uploaded audio, request building, sign-in link parsing. The app itself compiles in the manual `ios` workflow. On a real iPhone (no agent can do this): 30 minutes with the screen locked; a call in the middle; switching apps; stopping in airplane mode and turning it off; force quitting while recording (see `ios/README.md`). Rollout through TestFlight; rollback is the previous TestFlight build.
