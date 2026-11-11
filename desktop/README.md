# minuteca desktop

[Leer en español](README.es.md)

The minuteca app for Mac and Windows ([ADR 0005](../docs/adr/0005-desktop-app-and-local-transcription.md), [design](../docs/design/desktop-app.md)). It shows the person's minuteca server in its own window and adds "Transcribir en esta computadora": local models transcribe the meeting, so the audio goes to no AI provider and costs nothing per minute.

## Install

Installers come from the `desktop` workflow (Actions, "Run workflow"), as the `minuteca-macOS` and `minuteca-Windows` artifacts.

- **Mac:** open the `.dmg` for your Mac (`arm64` for Apple chips, `x64` for Intel) and drag minuteca to Applications. Until the app carries a Developer ID signature, macOS blocks it the first time: open it once, then System Settings, Privacy & Security, "Open Anyway".
- **Windows:** run `minuteca-…-windows-x64.exe`. It is not signed yet, so SmartScreen warns once: "More info", "Run anyway". Updates the app downloads itself do not warn.

On first sign-in, the app asks for an email link; open it on the same computer and choose "Abrir en la app de minuteca". The first local transcription downloads the models once (about 700 MB). Needs about 1.5 GB of disk and 8 GB of RAM.

## Develop

```sh
npm ci --prefix desktop
MINUTECA_SERVER=http://localhost:8787 npm --prefix desktop start   # against `npm start` in the repo root
npm --prefix desktop run dist                                      # installer for this platform
```

- `app/main.ts`: the window (only its server, no Node in the page), the session token (OS keychain via `safeStorage`, added to that server's requests only), `minuteca://` sign-in links, and the local transcription job.
- `app/preload.ts`: the bridge the web sees as `window.minutecaDesktop` (`requestLink`, `transcribe`, `cancel`).
- `app/decode-preload.ts`: a hidden window decodes audio with Chromium's own decoders (no ffmpeg shipped).
- `app/engine-worker.ts`: the engine (`engine/`) in a utility process, so the window never freezes.
- The server is `MINUTECA_SERVER` or `config.json` (`{"server": "https://…"}`) in the app's data folder; default `https://minuteca.lzno.app`.

## Transcribe a meeting from the command line

The same engine as a command, to compare it with a cloud provider on real meetings. Needs Node 22.18 or newer; WebM recordings need ffmpeg (`brew install ffmpeg`); on a Mac, M4A, MP3 and WAV also work without it.

```sh
npm ci --prefix desktop
npm run local:transcribe -- ~/Downloads/meeting.m4a --compare ~/Downloads/meeting.txt
```

- Models download once (about 700 MB, pinned Hugging Face revisions, checked by SHA-256) into `~/.cache/minuteca/models` (`--models` or `MINUTECA_MODELS` to change it). The app uses the same folder.
- It writes `meeting.local.txt` and `meeting.local.json` next to the audio. `--compare` takes the TXT export of the same meeting, a minuteca JSON transcript or a raw Deepgram answer and prints how alike words and voices are.
- `--threshold`: lower it (0.4) if two people came out as one voice, raise it (0.6) if one person came out as several.

## Models and credits

- NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0), speech to text in 25 languages including Spanish.
- pyannote segmentation 3.0 (MIT) and WeSpeaker ResNet34-LM trained on VoxCeleb (CC-BY-4.0), to tell voices apart.
- All run through [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0) inside [Electron](https://www.electronjs.org) (MIT).
