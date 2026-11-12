# Design: speaker names and minutes with a language model

- **Issue:** owner request, 2026-11-06; PRD change in `lzno-labs/empresa` (minuteca, "Minutas con IA")
- **Status:** Implemented
- **Author:** founding agent (claude)
- **Touches:** data (transcripts leave to a provider), security (third party keys), money (the person's own key), AI

## Goal

After a meeting is transcribed, the person can (1) ask an AI who each voice is and apply the names it finds, and (2) get the minutes written from the transcript with those names, then edit, copy, share or download them. Each person picks the provider (Claude, Gemini, ChatGPT, OpenRouter, or a local model if the server has one) and pays it with their own key. Out of scope: hosted keys paid by Lzno, chat with the transcript. (Automatic names and minutes, as an option, came later: `docs/design/automatic-minutes-and-revisions.md`.)

## Relevant ADRs

- ADR-0004 (this feature's architecture). ADR-0002: same consent model as transcription, separate permission per provider. ADR-0001: fits 10 ms of CPU per request. Own keys: `docs/design/own-provider-keys.md` (same vault).

## Approach

- **Settings, "Minutas con IA":** provider radio cards with key status, model field (empty means the provider's default), "Agregar mi clave" (checked with the provider before saving), permission status and withdrawal, the person's own instructions for their minutes (up to 2000 characters, for example their workplace format), and requests and tokens this month.
- **Permission:** the first time a transcript would go to a provider, a dialog says where it goes, the provider's data policy and that other people's words are included. The server stores `llm:<provider>` in `consents` and refuses without it (`403 no_llm_consent`).
- **Names:** `POST /api/meetings/:id/speakers/suggest` sends the transcript with neutral labels (S0, S1...) and asks for JSON with evidence. Nothing is saved; the app shows each suggestion under its voice ("Usar «Laura (Presidenta)»") and "Usar todas".
- **Minutes:** `POST /api/meetings/:id/minutes` sends title, date, length, participants, the person's instructions and the transcript with names; saves the Markdown in `minutes`. `PUT` saves edits (`edited = 1`), `DELETE` removes them. A "Minuta" tab shows them rendered by a small React Markdown renderer (no HTML injection), with share (system share sheet), copy, `.md` and `.txt`, write again, and an "AI-written, review before sending" note naming provider and model.
- **Several providers, chosen per generation (2026-11-11, owner request):** people can keep keys for several providers; Settings marks one as the default. "Sugerir nombres" and the minutes show a "Con [proveedor]" picker when more than one is ready, and send `{ provider }`; `runLlm()` checks permission and key for that provider as before. Each minutes generation is a new version (migration `0003_minutes_versions.sql`, newest 10 kept): the meeting returns `minutes` (newest) and `minutesVersions`, the panel shows them as tabs, and edit or delete apply to one version. Nothing is replaced, so models can be compared.
- **Every voice named (2026-11-11):** the first prompt left out any voice without a direct introduction, so most meetings got one name. The model now returns an entry for every voice, combining clues from the whole meeting, with a confidence (`high`, `medium`, `low`); a voice whose name is never said gets a short description of its role and `low`. The app shows the confidence next to each suggestion and applies nothing on its own, unless the person turns on automatic names (`docs/design/automatic-minutes-and-revisions.md`).
- **Slow answers (2026-11-11):** Cloudflare drops a connection that sends nothing for about 100 seconds, on the way to the provider and on the way to the browser. Gemini is called with streaming (`streamGenerateContent?alt=sse`, like Claude through its SDK) and with a thinking level from the task's effort on Gemini 3 and later. An answer not ready after 5 seconds goes to the browser as status 200 with a space every 15 seconds and then the JSON; an error carries its real status in `errorStatus`, which `api()` turns back into an error.
- **Busy models (2026-11-12):** Google turns away free tier keys from busy models with `503 UNAVAILABLE` ("high demand"), and sometimes holds the connection without answering. On that day every Flash model from 3.5 to 3.8 did so for a free key, while the Flash-Lite models answered in seconds. When the chosen Gemini model is overloaded, rate limited or does not start answering within 90 seconds, minuteca tries `gemini-3.5-flash-lite` and then `gemini-3.1-flash-lite`. It never does so after part of an answer came, or when the request itself was rejected. The minutes record the model that wrote them. Errors now say what happened: `rejected`, `overloaded` or `unavailable`, with a detail such as "gemini 503 UNAVAILABLE".
- **Language (2026-11-12, owner report):** prompts followed the browser's language, so a person with a browser in English got English minutes for a meeting held in Spanish. Names, minutes and revisions now use the transcript's language: the one the provider reported, else a count of frequent words, else the person's language.
- **Data model:** migration `0002_minutes.sql` adds three columns to `users`, the `minutes` table and the `llm_usage` ledger. Export includes minutes, instructions and the ledger.

## Alternatives considered

- Calling the provider from the browser with the key: the key would have to reach the browser; the server keeps keys encrypted and never returns them.
- Applying suggested names automatically: a wrong guess would silently mislabel what someone said.
- Storing minutes as HTML: Markdown is portable, editable as text and safe to render.

## Risks and safeguards

- **Data:** transcripts with names go to the chosen provider only after permission; minutes live with the meeting and are deleted with it after 30 days; the ledger has no content.
- **Security:** keys are encrypted at rest, never returned or logged; provider error bodies are not passed on; the local endpoint is set only by the administrator; transcript text is delimited and declared as content in the prompt; model ids are validated; requests are rate limited (10 per minute per person).
- **Money:** only the person's own key pays; Lzno spends nothing. Claude's default model is the most capable (the person can pick a cheaper one); tokens per month are shown.
- **AI:** labelled as AI wherever its output appears; names are suggestions; minutes are drafts the person reviews.

## Testing and rollout

`tests/server/minutes.test.ts` (settings, keys, permission, suggestions filtered to real voices, minutes saved, edited, exported, deleted with the meeting, local model without key) and `tests/server/llm.test.ts` (Claude adapter with refusal and fallbacks, Chat Completions adapters, Gemini, prompt helpers). Checked in a browser against a fake local model. Rollback: revert the PR; migration 0002 only adds columns and tables.
