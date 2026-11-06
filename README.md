# minuteca

Record in-person meetings and get a transcript with each speaker's name, ready for your minutes.

[Leer en español](README.es.md)

- **Record** from the phone or computer browser (pause, level meter, a backup on the device every 5 seconds, "Restaurar y transcribir" if anything fails), or **import** audio recorded with another app.
- **iPhone recorder** (`ios/`): a small native app that keeps recording with the screen locked, during a call or in another app, and uploads when there is signal.
- **Transcribe** with speakers told apart, using **Deepgram, AssemblyAI or OpenAI** with **your own key** (stored encrypted, never shown again). Transcripts use minuteca's own open format, the same for every provider.
- **Name the voices**, fix which voice a block belongs to, search, play the audio from any line.
- **Minutes with AI:** suggest each speaker's name and write the minutes from the transcript with **Claude, Gemini, ChatGPT, OpenRouter** or a **local model**, using your own key. Edit, copy, share or download them. Always labelled as AI-written.
- **Export** TXT, SRT and JSON and the audio, or **share with an AI app** (ChatGPT, Gemini...) to write the minutes. minuteca always says where the audio or text is going before it leaves.
- **Light and dark**, on phones and computers. Recordings from the iPhone recorder are transcribed on their own once you have allowed your provider.
- **Sign in** with an email link, only people on an access list. Everything is deleted after **30 days**.

Uses AI: transcription and minutes are done by the providers you choose, only after you allow each one. Nothing is tracked.

## Self-host in a few commands

Requires Node 22.18 or newer. Data lives in one SQLite file and a folder of audio files.

```sh
git clone https://github.com/lzno-labs/minuteca && cd minuteca
npm ci && npm run build
cp .env.example .env
# In .env: MINUTECA_ADMIN_EMAILS=you@example.org
#          MINUTECA_KEY_ENCRYPTION_KEY=$(openssl rand -base64 32)
npm start
```

Open `http://localhost:8787`, type your email: with the default `MAIL_PROVIDER=console` the sign-in link is printed in the server log. In Settings, paste your Deepgram, AssemblyAI or OpenAI key, and record.

- To reach it from your phone, serve it over HTTPS (any reverse proxy) and set `MINUTECA_ORIGIN` to that address. Microphones only work on HTTPS pages (or `localhost`).
- Add people on the Users screen of the app or `npm run access -- add ana@example.org`.
- Real sign-in emails: `MAIL_PROVIDER=resend` with `RESEND_API_KEY` and `MAIL_FROM`.

To run on Cloudflare instead (Workers, D1 and R2), copy `wrangler.example.toml` to `wrangler.toml`, create the D1 database and R2 bucket, then `npx wrangler d1 migrations apply minuteca --remote` and `npx wrangler deploy`. See [ADR 0001](docs/adr/0001-where-it-runs.md).

`GET /health` answers `{"ok": true, "core": "<commit>"}` with the value of `LZNO_CORE_SHA`.

## Export your data

- Each meeting: TXT, SRT, JSON (open format, [ADR 0002](docs/adr/0002-transcripts-and-providers.md)) and the audio.
- Everything at once: Settings, "Descargar todos mis datos (JSON)".
- Self-hosters can also copy the SQLite file and the audio folder.

## iOS recorder

See [`ios/README.md`](ios/README.md). It is licensed under **MPL-2.0** ([`ios/LICENSE`](ios/LICENSE)); the rest of the repository is **AGPL-3.0-only** ([`LICENSE`](LICENSE)).

## How it is built

- `src/server/`: the API (TypeScript that Node 22 runs without a build step, [Hono](https://hono.dev)). Behind our own interfaces: `storage` (SQLite or D1), `files` (disk or R2), `mail` (console or Resend), `transcriber` and `llm` (one adapter per provider). `node.ts` runs it on any machine, `worker.ts` on Cloudflare Workers.
- `src/web/`: the web app (React and Vite), installable as an app. All visible text lives in `locales/<lang>.json`.
- `ios/`: the iPhone recorder (SwiftUI).
- Decisions: [`docs/adr/`](docs/adr/). Designs: [`docs/design/`](docs/design/).

## Development

```sh
npm test        # server and web logic
npm run lint    # types, no hardcoded text, every text in every language
npm run dev     # web with hot reload on :5173, proxying /api to `npm start` on :8787
swift test --package-path ios/MinutecaKit   # iOS logic, also runs on Linux
```

Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).
