# ADR-0001: Where minuteca runs

- **Status:** Accepted
- **Date:** 2026-11-06
- **Supersedes:** none
- **Author:** founding agent (claude)

## Context

minuteca records meetings (about 2 hours a week for its first user, roughly 9 hours a month), stores the audio for 30 days, sends it to a transcription provider and keeps the transcripts. The previous version ran on Firebase (Hosting, Auth, Firestore, Storage, Cloud Functions). The hosted version must cost 0 USD on top of the transcription itself, the core must install on any machine with common tools, and everything specific to a provider sits behind our own interfaces (`storage`, `files`, `mail`, `transcriber`). Audio of 3 hours at 32 kbit/s is about 43 MB; uploads up to 95 MB must work.

Measured while designing: turning a 2 hour Deepgram answer (about 4.5 MB of JSON) into our transcript format takes 30 to 45 ms of CPU in Node.

## Options

1. **Cloudflare Workers + D1 + R2, free plan.** Requests, 5 GB of D1 and 10 GB of R2 with free egress are far above our use (about 130 MB of audio a month, deleted after 30 days). Same account as the rest of Lzno's products. Request bodies up to 100 MB (fits the 95 MB limit). Limit: 10 ms of CPU per request, which parsing a long transcript exceeds. 0 USD a month.
2. **Cloudflare Workers paid plan (same stack).** 30 s of CPU per request removes the limit above. 5 USD a month.
3. **Stay on Firebase.** Needs the Blaze plan for Functions (pay as you go, likely cents a month), Google sign-in or Firebase Auth, and a second cloud to watch. Vendor specific SDKs all over the code.
4. **A small VPS (Node + SQLite).** 4 to 6 USD a month, plus patching and backups by hand.

## Decision

Option 1, with the work shaped to fit 10 ms of CPU per request:

- Audio uploads stream straight to R2 (`FixedLengthStream`); downloads and ranges stream back. Providers download the audio from a private, short-lived link and call minuteca back when they finish, so no request waits on them or holds the file in memory.
- Provider answers are stored in R2 as they arrive, without parsing them, and the browser that opens the meeting converts them with the same pure converters the server uses (`MINUTECA_CONVERT=client`, set by `worker.ts`). Then it sends the transcript, which the server validates (about 300 KB for 2 hours) and saves.
- Transcripts are sent to the browser and exported as stored text, never parsed again on the server.
- A cron trigger runs retention (30 days), stuck jobs and expired sign-in links.

On Node (`npm start`) nothing changes: the server converts answers itself (`MINUTECA_CONVERT=server`).

## Consequences

- 0 USD a month for hosting. The deploy needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (already in the deployment repository), one D1 database and one R2 bucket.
- A transcript appears when someone opens the meeting in the web app (it takes a second there). The iPhone recorder never needs it.
- With hosted keys, the minutes booked before the call are never lowered by what the browser reports, so a browser cannot under-count usage.
- Revisit (move to option 2 with a new ADR) if a smoke test shows `Exceeded CPU` errors on other paths, if the free limits change, or if people complain that transcripts only appear after opening the web app.
- Self-hosting: `npm ci && npm run build && npm start` on any machine with Node 22.18; SQLite file and audio folder on disk. Cloudflare is optional (`wrangler.example.toml`).
