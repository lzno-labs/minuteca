# minuteca para escritorio

[Read in English](README.md)

La app de minuteca para Mac y Windows ([ADR 0005](../docs/adr/0005-desktop-app-and-local-transcription.md), [diseño](../docs/design/desktop-app.md)). Muestra tu servidor de minuteca en su propia ventana y agrega «Transcribir en esta computadora»: modelos locales transcriben la reunión, así que el audio no va a ningún proveedor de IA y no cuesta nada por minuto.

## Instalar

Descárgala desde [minuteca.lzno.app/descargar](https://minuteca.lzno.app/descargar) o desde los [releases](https://github.com/lzno-labs/minuteca/releases) de este repo. La app revisa los releases al abrir y cada 6 horas: Windows se actualiza solo después de preguntar si reinicia; Mac también cuando tenga la firma Developer ID, y mientras tanto abre la página de descarga. En Ajustes están la versión y «Buscar actualizaciones».

- **Mac:** abre el `.dmg` de tu Mac (`arm64` para chips de Apple, `x64` para Intel) y arrastra minuteca a Aplicaciones. Mientras la app no tenga la firma Developer ID, macOS la bloquea la primera vez: ábrela una vez y luego Ajustes del Sistema, Privacidad y seguridad, «Abrir de todas formas».
- **Windows:** ejecuta `minuteca-windows-x64.exe`. Todavía no está firmada, así que SmartScreen avisa una vez: «Más información», «Ejecutar de todas formas». Las actualizaciones que baja la app no vuelven a avisar.

Al entrar, la app pide un enlace por correo; ábrelo en la misma computadora y elige «Abrir en la app de minuteca». La primera transcripción local descarga los modelos una vez (unos 700 MB). Necesita unos 1,5 GB de disco y 8 GB de RAM.

## Publicar una versión

Actions, `desktop`, «Run workflow» con una versión mayor que la del último release (por ejemplo `0.1.2`). Construye las dos plataformas en servidores de GitHub y publica el release `v0.1.2` con los instaladores y los canales de actualización (`latest.yml`, `latest-mac.yml`). Sin versión, solo los construye como artefactos.

## Desarrollo

```sh
npm ci --prefix desktop
MINUTECA_SERVER=http://localhost:8787 npm --prefix desktop start   # contra `npm start` en la raíz del repo
npm --prefix desktop run dist                                      # instalador para esta plataforma
```

## Transcribir desde la línea de comandos

El mismo motor como comando, para compararlo con un proveedor en la nube con reuniones reales. Necesita Node 22.18 o más nuevo; las grabaciones WebM necesitan ffmpeg (`brew install ffmpeg`); en una Mac, M4A, MP3 y WAV funcionan sin él.

```sh
npm ci --prefix desktop
npm run local:transcribe -- ~/Downloads/reunion.m4a --compare ~/Downloads/reunion.txt
```

- Los modelos se descargan una vez (unos 700 MB, versiones fijas en Hugging Face, verificados con SHA-256) en `~/.cache/minuteca/models`; la app usa la misma carpeta.
- Guarda `reunion.local.txt` y `reunion.local.json` junto al audio. `--compare` dice qué tanto se parecen las palabras y las voces.
- `--threshold`: bájalo (0,4) si dos personas salieron como una sola voz; súbelo (0,6) si una persona salió como varias.

## Modelos y créditos

- NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0): voz a texto en 25 idiomas, entre ellos el español.
- pyannote segmentation 3.0 (MIT) y WeSpeaker ResNet34-LM entrenado con VoxCeleb (CC-BY-4.0): para distinguir voces.
- Todo corre con [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0) dentro de [Electron](https://www.electronjs.org) (MIT).
