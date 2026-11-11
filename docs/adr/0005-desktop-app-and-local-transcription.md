# ADR-0005: Desktop app for Mac and Windows with local transcription

- **Status:** Accepted (PRD scope change approved by the owner, lzno-labs/empresa#34); distribution superseded by ADR-0006
- **Date:** 2026-11-10
- **Supersedes:** none (extends ADR-0002 with a provider that runs outside the server)
- **Author:** founding agent (claude)

## Context

The owner wants minuteca on Mac and Windows computers, mainly to transcribe with local models: the audio of work meetings would not go to Deepgram or any other AI provider (PRD risk "Confidencialidad del trabajo"), there is no cost per minute, and nothing waits on a provider. The web already records, shows, names, exports and writes minutes on a computer, so a second copy of that interface would only add maintenance for 1 to 2 owner hours a week. Speaker separation is the core of minuteca and Whisper alone does not do it.

A spike on 2026-11-10 (synthetic 3-voice Spanish meeting, 4 server CPU cores, no GPU) ran sherpa-onnx from Node with NVIDIA Parakeet TDT 0.6B v3 (int8) for speech and pyannote segmentation 3.0 plus WeSpeaker ResNet34 for speakers: 3 of 3 voices found, 97% of speech time on the right voice, 7.1% word error rate, 0.2 times real time (a 2 hour meeting in about 25 minutes), 1.4 GB of RAM for 10 minutes of audio. Synthetic voices are easier than a real room, so real meetings must be tested before relying on it.

## Options

1. **Whisper in the browser (WebGPU).** No install, but fragile for hours of audio, limited in Safari, and speaker separation in the browser is immature.
2. **A full native app per platform (SwiftUI and WinUI).** Best feel, but two new interfaces to build and maintain.
3. **Tauri shell with Rust or a sidecar binary.** Small installer, but a new language (Rust) and community bindings for sherpa-onnx.
4. **Electron shell that shows the minuteca web app and adds a local engine.** Same language as the core (TypeScript), sherpa-onnx ships official Node binaries for macOS (arm64, x64) and Windows (x64, arm64) under Apache-2.0, mature signing and updates. Larger installer (about 100 MB), which is small next to the models.

## Decision

Option 4, as an extra provider, not a replacement for Deepgram.

- `desktop/` in this repo (AGPL-3.0-only like the core: no store in our plan forbids it). The window loads the person's minuteca server (default `https://minuteca.lzno.app`, self-hosters type theirs), with `contextIsolation`, `sandbox`, no Node in the page, navigation limited to that origin and a small preload bridge.
- Engine: sherpa-onnx in an Electron utility process. Models are not in the installer: downloaded once (about 710 MB) from pinned Hugging Face revisions, checked by SHA-256, and deletable in settings. Licenses: Parakeet TDT 0.6B v3 and WeSpeaker ResNet34 under CC-BY-4.0, pyannote segmentation 3.0 under MIT, credited in "Acerca de". The engine sits behind a small interface so Whisper (whisper.cpp with Metal or Vulkan) can be added if it proves better.
- Transcript format v1 unchanged (ADR-0002): `provider: "local"`, `model` names the engine and models. The server never runs or pays for it: `startTranscription()` is not involved and no permission is asked, because the audio only goes from the person's own server to the person's own computer.
- Sign-in reuses the app flow of ADR-0003 (verifier plus `minuteca://acceso`); the bearer token stays in the main process (OS keychain through Electron `safeStorage`) and is added to requests to that origin, so page scripts never see it.
- Distribution: direct download from the person's minuteca server (`/descargar`), like most desktop apps; no app stores. Mac: a Developer ID signed and notarized DMG with the Apple account Lzno already pays for, so it opens without warnings. Windows: an installer that is unsigned at first, so the first install shows the SmartScreen warning once ("Más información", "Ejecutar de todas formas"); updates the app downloads itself do not. A paid certificate (150 to 500 USD a year) would not remove that warning for a new app with few downloads: since 2024 even EV certificates start without SmartScreen reputation. Builds run on GitHub-hosted runners; while the repo is private the build workflow is manual, like iOS.

## Consequences

- People with the desktop app get "En esta computadora" as a provider; everyone else sees no change.
- Audio still goes to the minuteca server (Cloudflare R2 in the hosted version), but not to an AI provider.
- A third client to maintain; Electron and the models need updates, so Operaciones watches Electron security releases.
- Windows people see the SmartScreen warning once, when installing; the download page shows the two clicks. If the app reaches people outside the family, signing is revisited: SignPath Foundation (free for open source once the core is public) or the Microsoft Store (free for individuals, signs the package and installs without SmartScreen).
- Revisit if real meetings transcribe clearly worse than Deepgram, if Electron's size or updates become a burden (Tauri), or if a local language model for minutes is wanted on the computer.
