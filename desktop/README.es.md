# minuteca para escritorio

[Read in English](README.md)

La app de minuteca para Mac y Windows, que transcribe en la computadora ([ADR 0005](../docs/adr/0005-desktop-app-and-local-transcription.md), [diseño](../docs/design/desktop-app.md)). Aquí está la fase 1: el motor local como comando, para compararlo con un proveedor en la nube en reuniones reales antes de construir la app.

## Transcribir una reunión en esta computadora

Necesita Node 22.18 o más nuevo, unos 1,5 GB de disco y 8 GB de RAM. Las grabaciones WebM necesitan ffmpeg (`brew install ffmpeg`); en una Mac, M4A, MP3 y WAV funcionan sin él.

```sh
npm ci --prefix desktop                      # una vez
npm run local:transcribe -- ~/Downloads/reunion.m4a --compare ~/Downloads/reunion.txt
```

- La primera vez descarga los modelos (unos 700 MB, de versiones fijas en Hugging Face, verificados con SHA-256) en `~/.cache/minuteca/models` (`--models` o `MINUTECA_MODELS` para cambiarlo).
- Guarda `reunion.local.txt` y `reunion.local.json` (el formato de transcripción de minuteca) junto al audio. Nada más sale de la computadora.
- `--compare` recibe el TXT exportado de la misma reunión (de esta app o de la versión de Firebase), una transcripción JSON de minuteca o la respuesta tal cual de Deepgram, y dice qué tanto se parecen las palabras y las voces. Ninguna de las dos es la verdad: donde difieran, lee ambas.
- `--threshold`: bájalo (0,4) si dos personas salieron como una sola voz; súbelo (0,6) si una persona salió como varias.

## Modelos y créditos

- NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0): voz a texto en 25 idiomas, entre ellos el español.
- pyannote segmentation 3.0 (MIT) y WeSpeaker ResNet34-LM entrenado con VoxCeleb (CC-BY-4.0): para distinguir voces.
- Todo corre con [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0).
