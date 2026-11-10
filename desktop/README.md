# minuteca desktop

[Leer en español](README.es.md)

The minuteca app for Mac and Windows, with transcription on the computer ([ADR 0005](../docs/adr/0005-desktop-app-and-local-transcription.md), [design](../docs/design/desktop-app.md)). Phase 1 is here: the local engine as a command, to compare it with a cloud provider on real meetings before building the app.

## Transcribe a meeting on this computer

Needs Node 22.18 or newer, about 1.5 GB of disk and 8 GB of RAM. WebM recordings need ffmpeg (`brew install ffmpeg`); on a Mac, M4A, MP3 and WAV also work without it.

```sh
npm ci --prefix desktop                      # once
npm run local:transcribe -- ~/Downloads/meeting.m4a --compare ~/Downloads/meeting.txt
```

- The first run downloads the models once (about 700 MB, from pinned Hugging Face revisions, checked by SHA-256) into `~/.cache/minuteca/models` (`--models` or `MINUTECA_MODELS` to change it).
- It writes `meeting.local.txt` and `meeting.local.json` (minuteca's transcript format) next to the audio. Nothing else leaves the computer.
- `--compare` takes the TXT export of the same meeting (from this app or the Firebase version), a minuteca JSON transcript or a raw Deepgram answer, and prints how alike the words and the voices are. Neither side is ground truth: read both where they differ.
- `--threshold`: lower it (0.4) if two people came out as one voice, raise it (0.6) if one person came out as several.

## Models and credits

- NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0), speech to text in 25 languages including Spanish.
- pyannote segmentation 3.0 (MIT) and WeSpeaker ResNet34-LM trained on VoxCeleb (CC-BY-4.0), to tell voices apart.
- All run through [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0).
