# Design: desktop app for Mac and Windows with local transcription

- **Issue:** owner request, 2026-11-06 and 2026-11-10; PRD change in `lzno-labs/empresa` (minuteca, "App de escritorio")
- **Status:** Proposed
- **Author:** founding agent (claude)
- **Touches:** data (meeting audio on the computer), security (desktop sign-in, model downloads), AI (local models)

## Goal

On a Mac or Windows computer, the person opens "minuteca", sees the same app as on the web, and can pick "En esta computadora" to transcribe a meeting with local models: the audio does not go to any AI provider and there is no cost per minute. Recordings made on the iPhone or the web are transcribed on the computer. Out of scope for now: a local language model for minutes, fully offline meetings that never reach the server, Linux builds, and a separate desktop interface.

## Relevant ADRs

- ADR-0005 (this feature). ADR-0002: same transcript format, `provider: "local"`. ADR-0003: app sign-in with verifier and `minuteca://`. ADR-0001: the server does no extra CPU work.

## Approach

- **First run:** choose the server (default `minuteca.lzno.app`), sign in by email (the link opens the app through `minuteca://acceso`), then "Descargar modelos de transcripción (710 MB)" with progress, resumable, checked by SHA-256. Needs about 1.5 GB of disk and 8 GB of RAM.
- **Transcribe:** in a meeting, "Transcribir" lists "En esta computadora" (only inside the desktop app) next to the cloud providers, with an optional "¿Cuántas personas hablaron?" that improves speaker separation. The app tells the server (`POST /api/meetings/:id/transcribe` with `provider: "local"`, which marks it "transcribing on a computer" without spending anything), downloads the audio with byte ranges, decodes it to 16 kHz mono with Chromium's own decoders (no ffmpeg in the installer), runs speaker separation and then speech recognition per speaker turn in a utility process, and sends the result with `PUT /api/meetings/:id/transcript`. Progress shows in the window and the tray or menu bar; the computer is kept awake while it runs. The web on other devices shows "Transcribiendo en una computadora" with "Cancelar"; a claim older than 24 hours is released by `maintenance()`.
- **Speed:** measured 0.2 times real time on 4 CPU cores without GPU (2 hours in about 25 minutes). Apple Silicon and newer Windows laptops should be similar or faster; a CoreML or DirectML execution provider is a later improvement, measured before adopting it.
- **Security:** the window only navigates to the chosen server; other links open in the browser. The preload bridge exposes three calls (`localAvailable`, `transcribeLocally`, `cancel`) and no file system or Node access. The bearer token lives in the main process and is attached to that origin's requests. Model files are checked by hash before loading.
- **Updates:** Mac checks a signed update feed served by the minuteca server; Windows updates through the Store. The app warns when the server needs a newer app.
- **Phases:** (1) the engine as a command (`npm run local:transcribe -- reunion.m4a`) and a comparison on 2 or 3 real meetings against Deepgram, on the owner's Mac; (2) the shell, server changes and Mac build; (3) Windows build and Store listing; (4) optional: local language model for minutes.

## Alternatives considered

- A menu bar helper with no window: invisible to the person, harder to tell what it is doing.
- Bundling the models: every update would download 700 MB again.
- Whisper large-v3 turbo as the default: slower on CPU than Parakeet v3 and prone to repeated lines on noise; kept as a possible second engine.

## Risks and safeguards

- Real rooms (echo, distance, people talking over each other) separate speakers worse than the spike: phase 1 measures it on real meetings before building the rest, and the person can always pick a cloud provider or fix voices by hand.
- A laptop that sleeps or closes mid-way: the claim expires and the meeting can be transcribed again.
- Model licenses require attribution: shown in "Acerca de" with links.
