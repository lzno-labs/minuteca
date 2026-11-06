# Design: speaker names and minutes with a language model

- **Issue:** owner request, 2026-11-06; PRD change in `lzno-labs/empresa` (minuteca, "Minutas con IA")
- **Status:** Implemented
- **Author:** founding agent (claude)
- **Touches:** data (transcripts leave to a provider), security (third party keys), money (the person's own key), AI

## Goal

After a meeting is transcribed, the person can (1) ask an AI who each voice is and apply the names it finds, and (2) get the minutes written from the transcript with those names, then edit, copy, share or download them. Each person picks the provider (Claude, Gemini, ChatGPT, OpenRouter, or a local model if the server has one) and pays it with their own key. Out of scope: hosted keys paid by Lzno, automatic minutes on every meeting, chat with the transcript.

## Relevant ADRs

- ADR-0004 (this feature's architecture). ADR-0002: same consent model as transcription, separate permission per provider. ADR-0001: fits 10 ms of CPU per request. Own keys: `docs/design/own-provider-keys.md` (same vault).

## Approach

- **Settings, "Minutas con IA":** provider radio cards with key status, model field (empty means the provider's default), "Agregar mi clave" (checked with the provider before saving), permission status and withdrawal, the person's own instructions for their minutes (up to 2000 characters, for example their workplace format), and requests and tokens this month.
- **Permission:** the first time a transcript would go to a provider, a dialog says where it goes, the provider's data policy and that other people's words are included. The server stores `llm:<provider>` in `consents` and refuses without it (`403 no_llm_consent`).
- **Names:** `POST /api/meetings/:id/speakers/suggest` sends the transcript with neutral labels (S0, S1...) and asks for JSON with evidence. Nothing is saved; the app shows each suggestion under its voice ("Usar «Laura (Presidenta)»") and "Usar todas".
- **Minutes:** `POST /api/meetings/:id/minutes` sends title, date, length, participants, the person's instructions and the transcript with names; saves the Markdown in `minutes`. `PUT` saves edits (`edited = 1`), `DELETE` removes them. A "Minuta" tab shows them rendered by a small React Markdown renderer (no HTML injection), with share (system share sheet), copy, `.md` and `.txt`, write again, and an "AI-written, review before sending" note naming provider and model.
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
