# Design: each person's own provider keys, hosted keys and the monthly cap

- **Issue:** PRD of minuteca (`productos/minuteca/prd.md` in lzno-labs/empresa, approved 2026-11-06)
- **Status:** Implemented in the first version
- **Author:** founding agent (claude)
- **Touches:** security (third party secrets), money (provider credit), AI (audio leaves to a provider)

## Goal

Anyone can transcribe with their own Deepgram, AssemblyAI or OpenAI key, free in minuteca: the provider bills them. Whoever runs the server can also offer their own keys ("hosted keys") to the people on the access list, with minutes metered per person and a monthly cap enforced in code. Out of scope: charging for hosted keys (a later version), sharing one person's key with others.

## Relevant ADRs

- ADR-0002: providers behind one interface; every call goes through `startTranscription()`.
- ADR-0003: the access list decides who may use hosted keys.
- ADR-0001: on Workers the key is decrypted only inside the request that starts the job.

## Approach

**Saving a key** (`PUT /api/keys/:provider`, session required, rate limited):

1. Shape check (printable, 16 to 300 characters).
2. The key is checked with its own provider (a read-only call: Deepgram `GET /v1/projects`, AssemblyAI `GET /v2/transcript?limit=1`, OpenAI `GET /v1/models`). It is sent nowhere else.
3. AES-256-GCM with a 32 byte server key, `MINUTECA_KEY_ENCRYPTION_KEY`, a Worker secret (never in a file or the repository), random 12 byte IV per key. The associated data is `minuteca:provider-key:v1:<user id>:<provider>`, so a ciphertext copied to another person or provider does not decrypt.
4. Stored: ciphertext, IV, the last 4 characters and a version number. The API only ever returns `last4`; the key is never logged, never exported (the export lists provider and last 4), and deleting it removes the row.

Without the server key, saving keys is disabled and the app says so. Losing the server key makes saved keys unreadable; people paste them again. Rotation: a new version number in the AAD and a re-encrypt on first use (not needed yet).

**Choosing the key** (`resolveKey`): the person's own key for that provider if there is one; otherwise a hosted key, if `hosted.allowed(user)` and the server has one for that provider; otherwise the request fails with `no_key` and the app points to Settings.

**Hosted keys** come from `src/server/hosted.ts`, which returns `null` in the open core. The hosted version replaces that one file at deploy time (`pro/minuteca/` in Lzno's private repository): Deepgram's key from a Worker secret, allowed for everyone on the access list, cap 20 hours a month for all people together.

**Metering and the cap** (`startTranscription`, the only function that calls a provider):

1. Permission for that provider must exist (`consents`), or `403 no_consent`.
2. Minutes are estimated before the call: the known length, or the size at 32 kbit/s.
3. With a hosted key, if `used this month + estimate > cap`, `429 hosted_cap`, and the provider is not called.
4. The meeting moves to `transcribing` with a conditional update (only from `uploaded` or `error`), so two clicks never pay twice; the estimate is booked in the `usage` table before the call, so concurrent jobs see each other.
5. On success the booking becomes the real length (with conversion in the browser, never lower than the estimate). On failure the booking is deleted.

Usage is shown to each person (own and hosted minutes this month, hosted minutes left for everyone) and kept 13 months, without content.

## Alternatives considered

- Keys only in the browser, sent with each request: simpler, but the iPhone recorder and server-side jobs (callbacks, retries) could not use them.
- A key management service: another provider and account for a handful of keys.
- One global key per server, no per person keys: ties everyone to the host's provider and budget.

## Risks and safeguards

- **Data:** only ciphertext and last 4 characters at rest; plain keys exist in memory during the check and the call.
- **Security:** keys are used only for their owner's meetings; server error answers never echo provider bodies (they could reflect the key). Rate limits on saving keys stop key-testing abuse.
- **Money:** hosted spend is capped in code (20 h a month on Lzno), plus the provider's own prepaid credit as the hard stop. The per person ledger shows who used what.
- **AI:** permission per provider, stored and enforced on the server, revocable in Settings; the destination is shown before every transcription started from the web. Recordings uploaded by the iPhone recorder are transcribed on upload only with a permission already given, and the permission dialog says so.

## Testing and rollout

Tests in `tests/server/transcription.test.ts` and `units.test.ts`: keys checked, encrypted and never returned; AAD binding; consent required; own key preferred; cap reached; monthly reset; failed jobs free their booking. Rollout with the first deploy; rollback removes the hosted file (everyone falls back to their own keys).
