# Design: choosing local speech models in the desktop app

- **Issue:** owner request, 2026-11-12 ("the desktop app still lacks using local models like Whisper"; earlier: "options to download and install models, with recommendations from the computer's specs")
- **Status:** Implemented
- **Author:** founding agent (claude)
- **Touches:** people's computers (downloads, disk, CPU); no data leaves them

## Goal

In the desktop app, a person sees which local speech models exist, which one suits their computer and why, downloads or deletes them, and picks the one used by "Transcribir en esta computadora". Whisper is offered next to Parakeet.

## Relevant ADRs

ADR-0005 (desktop app, sherpa-onnx engine, pinned and checked downloads), ADR-0007 (this choice of models), ADR-0002 (transcripts and versions, so models can be compared on one meeting), ADR-0004 (the minutes read the transcript's language).

## Approach

- **Catalog** (`desktop/engine/models.ts`): `SPEECH_MODELS` with id, name, kind (`parakeet` or `whisper`), files (pinned URL, size, SHA-256), minimum memory and the measured speed. `SPEAKER_FILES` are shared. `filesFor(id)` lists what a model needs; downloads resume and are checked as before.
- **Recommendation** (`desktop/engine/recommend.ts`, pure): from total memory and cores, each model gets a fit (`ok`, `slow`, `too_big`) and an estimated time per hour of audio (measured factor, scaled to the threads the app uses). The recommended model is Whisper base under 6 GB of memory, else Parakeet.
- **Engine** (`desktop/engine/sherpa.ts`): the recognizer is built from the chosen model's kind. For Whisper, the language is detected per window and the most frequent one goes in the transcript; sentences without word times share their window's time by length (`sentencesFrom`).
- **Desktop bridge** (`window.minutecaDesktop`): `models()` returns the computer's specs, the catalog with what is downloaded and the recommendation; `downloadModel(id, onProgress)` and `deleteModel(id)`; `transcribe(meetingId, onProgress, { model })` takes the model. The engine process validates every id against the catalog.
- **Web**: Settings shows "Transcribir en esta computadora" only when the bridge has `models()` (older desktop versions keep working with Parakeet). The chosen model is remembered on the computer (local settings). The transcribe panel names the model and says when it will download first.
- **Command line**: `npm run local:transcribe -- audio --model whisper-turbo`.

## Alternatives considered

- whisper.cpp with the GPU: faster, but a second native engine (ADR-0007).
- Downloading the recommended model on first launch: hundreds of MB without asking; the person decides instead.

## Risks and safeguards

- **Disk and time:** sizes and estimates are shown before downloading; models can be deleted; downloads resume.
- **Integrity:** every file is pinned to a revision and checked by SHA-256 before use, as in ADR-0005.
- **Memory:** a model marked "too big" can still be chosen, with the warning.
- **Privacy:** unchanged: audio goes from the person's minuteca server to their own computer only.

## Testing and rollout

Unit tests for the catalog, the recommendation, Whisper's sentence timing and the language pick; web tests for the bridge helpers. Checked with the real models on the test meeting (ADR-0007 table). Ships in desktop 0.1.2 (the web part works with the server deploy; older apps simply do not show the section). Rollback: revert the PR; downloaded models stay in the models folder until deleted.
