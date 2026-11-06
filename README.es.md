# minuteca

Graba reuniones presenciales y obtén la transcripción con el nombre de cada persona, lista para tu minuta.

[Read in English](README.md)

- **Graba** desde el navegador del teléfono o la computadora (pausa, medidor de nivel, respaldo en el dispositivo cada 5 segundos, «Restaurar y transcribir» si algo falla), o **importa** un audio grabado con otra app.
- **Grabadora para iPhone** (`ios/`): una app nativa pequeña que sigue grabando con la pantalla bloqueada, durante una llamada o en otra app, y sube el audio cuando hay señal.
- **Transcribe** separando a cada persona, con **Deepgram, AssemblyAI u OpenAI** usando **tu propia clave** (se guarda cifrada y nunca se vuelve a mostrar). Las transcripciones usan un formato abierto propio, igual para todos los proveedores.
- **Ponle nombre a cada voz**, corrige a quién pertenece un bloque, busca y reproduce el audio desde cualquier línea.
- **Exporta** en TXT, SRT y JSON, descarga el audio o **compártelo con una app de IA** (ChatGPT, Gemini...) para que redacte la minuta. minuteca siempre dice hacia dónde sale el audio o el texto antes de que salga.
- **Modo claro y oscuro**, en teléfono y computadora. Lo que grabes con la grabadora de iPhone se transcribe solo una vez que permitiste a tu proveedor.
- **Entra** con un enlace a tu correo, solo si estás en la lista de acceso. Todo se borra a los **30 días**.

Usa IA: la transcripción la hace el proveedor que elijas, solo después de que lo permitas. Sin rastreo.

## Instálalo en tu máquina

Necesitas Node 22.18 o más reciente. Los datos viven en un archivo SQLite y una carpeta de audios.

```sh
git clone https://github.com/lzno-labs/minuteca && cd minuteca
npm ci && npm run build
cp .env.example .env
# En .env: MINUTECA_ADMIN_EMAILS=tu@correo.com
#          MINUTECA_KEY_ENCRYPTION_KEY=$(openssl rand -base64 32)
npm start
```

Abre `http://localhost:8787` y escribe tu correo: con `MAIL_PROVIDER=console` (el valor por defecto) el enlace para entrar aparece en el registro del servidor. En Ajustes pega tu clave de Deepgram, AssemblyAI u OpenAI, y graba.

- Para usarlo desde el teléfono, sírvelo por HTTPS (con cualquier proxy inverso) y pon esa dirección en `MINUTECA_ORIGIN`. El micrófono solo funciona en páginas HTTPS (o `localhost`).
- Agrega personas en la pantalla Usuarios de la app o con `npm run access -- add ana@correo.com`.
- Correos de verdad: `MAIL_PROVIDER=resend` con `RESEND_API_KEY` y `MAIL_FROM`.

Para correrlo en Cloudflare (Workers, D1 y R2), copia `wrangler.example.toml` a `wrangler.toml`, crea la base D1 y el bucket R2, y luego `npx wrangler d1 migrations apply minuteca --remote` y `npx wrangler deploy`. Ver el [ADR 0001](docs/adr/0001-where-it-runs.md) (en inglés).

`GET /health` responde `{"ok": true, "core": "<commit>"}` con el valor de `LZNO_CORE_SHA`.

## Exporta tus datos

- Cada reunión: TXT, SRT, JSON (formato abierto, [ADR 0002](docs/adr/0002-transcripts-and-providers.md)) y el audio.
- Todo junto: Ajustes, «Descargar todos mis datos (JSON)».
- Si lo instalas tú, también puedes copiar el archivo SQLite y la carpeta de audios.

## Grabadora para iOS

Ver [`ios/README.md`](ios/README.md) (en inglés). Su licencia es **MPL-2.0** ([`ios/LICENSE`](ios/LICENSE)); el resto del repositorio es **AGPL-3.0-only** ([`LICENSE`](LICENSE)).

## Contribuir

[CONTRIBUTING.md](CONTRIBUTING.md) (en inglés). Cada commit lleva `Signed-off-by` (`git commit -s`). Los reportes de seguridad van solo por el canal privado de GitHub: [SECURITY.md](SECURITY.md).
