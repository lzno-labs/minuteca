# Design: desktop app for Mac and Windows with local transcription

- **Issue:** owner request, 2026-11-06 and 2026-11-10; PRD change in `lzno-labs/empresa` (minuteca, "App de escritorio")
- **Status:** In progress: phase 1 done; phases 2 and 3 (app and installers) started on 2026-11-11 at the owner's request, in parallel with the real-meeting test
- **Author:** founding agent (claude)
- **Touches:** data (meeting audio on the computer), security (desktop sign-in, model downloads), AI (local models)

## Goal

On a Mac or Windows computer, the person opens "minuteca", sees the same app as on the web, and can pick "En esta computadora" to transcribe a meeting with local models: the audio does not go to any AI provider and there is no cost per minute. Recordings made on the iPhone or the web are transcribed on the computer. Out of scope for now: a local language model for minutes, fully offline meetings that never reach the server, Linux builds, and a separate desktop interface.

## Relevant ADRs

- ADR-0005 (this feature). ADR-0002: same transcript format, `provider: "local"`. ADR-0003: app sign-in with verifier and `minuteca://`. ADR-0001: the server does no extra CPU work.

## Approach

- **Install:** `minuteca.lzno.app/descargar` puts the visitor's system first (Mac with Apple chip, Mac with Intel, Windows) and explains the first-open warnings.
- **First run:** choose the server (default `minuteca.lzno.app`), sign in by email (the link opens the app through `minuteca://acceso`), then "Descargar modelos de transcripción (710 MB)" with progress, resumable, checked by SHA-256. Needs about 1.5 GB of disk and 8 GB of RAM.
- **Transcribe:** in a meeting, "Transcribir" lists "En esta computadora" (only inside the desktop app) next to the cloud providers. It does not ask how many people spoke: in phase 1, a fixed speaker count made sherpa-onnx merge two of three voices, while the automatic threshold (0.5) found all three. People fix a wrong voice by hand, as with any provider. The app tells the server (`POST /api/meetings/:id/transcribe` with `provider: "local"`, which marks it "transcribing on a computer" without spending anything), downloads the audio with byte ranges, decodes it to 16 kHz mono with Chromium's own decoders (no ffmpeg in the installer), runs speaker separation and then speech recognition per speaker turn in a utility process, and sends the result with `PUT /api/meetings/:id/transcript`. Progress shows in the window and the tray or menu bar; the computer is kept awake while it runs. The web on other devices shows "Transcribiendo en una computadora" with "Cancelar"; a claim older than 24 hours is released by `maintenance()`.
- **Speed:** measured 0.2 times real time on 4 CPU cores without GPU (2 hours in about 25 minutes). Apple Silicon and newer Windows laptops should be similar or faster; a CoreML or DirectML execution provider is a later improvement, measured before adopting it.
- **Security:** the window only navigates to the chosen server; other links open in the browser. The preload bridge exposes three calls (`localAvailable`, `transcribeLocally`, `cancel`) and no file system or Node access. The bearer token lives in the main process and is attached to that origin's requests. Model files are checked by hash before loading.
- **Updates (2026-11-11):** the open core is public, so releases live on GitHub: the `desktop` workflow publishes `v<version>` with the installers and electron-updater feeds, and `/descargar` links to `releases/latest/download/<name>`. The app checks at start and every 6 hours. Windows downloads in the background and asks to restart; Mac does the same once it carries a Developer ID signature (macOS refuses to update ad hoc signed apps), and until then it offers the download page. Updates the app downloads itself do not trigger SmartScreen. The app warns when the server needs a newer app.
- **Phases:** (1) the engine as a command (`npm run local:transcribe -- reunion.m4a --compare reunion.txt`, in `desktop/`; built 2026-11-10) and a comparison on 2 or 3 real meetings against Deepgram, on the owner's Mac; (2) the shell, server changes and Mac build; (3) Windows installer; (4) optional: local language model for minutes.

## Alternatives considered

- A menu bar helper with no window: invisible to the person, harder to tell what it is doing.
- Bundling the models: every update would download 700 MB again.
- Whisper large-v3 turbo as the default: slower on CPU than Parakeet v3 and prone to repeated lines on noise; kept as a possible second engine.

## Risks and safeguards

- Real rooms (echo, distance, people talking over each other) separate speakers worse than the spike: phase 1 measures it on real meetings before building the rest, and the person can always pick a cloud provider or fix voices by hand.
- The unsigned Windows installer: SmartScreen warns once and some antivirus programs may distrust it. Acceptable for the family; signing is revisited (ADR-0005) before offering it to others.
- A laptop that sleeps or closes mid-way: the claim expires and the meeting can be transcribed again.
- Model licenses require attribution: shown in "Acerca de" with links.
