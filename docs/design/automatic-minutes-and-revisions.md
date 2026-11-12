# Design: automatic names and minutes, and revising minutes

- **Issue:** owner request, 2026-11-11 ("choose to have names and minutes made automatically once the audio is ready, with fewer clicks; give feedback to edit parts of the minutes, with the model or by hand")
- **Status:** Implemented
- **Author:** founding agent (claude)
- **Touches:** AI (calls made without a click, text sent again for revisions), data (minutes history)

## Goal

1. A person can turn on, in Settings, "when a transcription finishes: name the people" and "write the minutes". Then a recording goes from audio to minutes without clicks: the upload already starts the transcription when the person allowed their provider; the names and the minutes follow on their own.
2. A person can change part of the minutes: edit one section by hand, ask the model to change one section ("add that Ana presents it on Friday"), or ask for a change to the whole minutes. Every change can be undone.

Out of scope: running these steps on the server while nobody has the app open (see Alternatives), chat with the transcript.

## Relevant ADRs

- ADR-0004: `runLlm()` stays the only path to a language model, with the same permission per provider and the person's own key. Revisions are one more purpose (`revise`) in the usage ledger.
- ADR-0001: Workers Free gives 10 ms of CPU per request and `waitUntil` lasts 30 seconds after the response, so a minutes call (often over a minute) cannot run in the background there.
- ADR-0002 and ADR-0005: no change; cloud and desktop transcripts finish the same way.

## Approach

### Automatic names and minutes

- **Setting:** `users.auto_steps` (migration `0005`), a list of `names` and `minutes`, set with `PUT /me/llm { auto: [...] }` and returned in `/me` as `llm.auto`. Turning a step on asks for permission for the default provider first; the steps use the default provider and model.
- **Pending steps:** when a transcript is saved (`finishMeeting` for providers, `finishLocal` for the desktop app), the meeting gets `auto_pending` = the person's steps, read in the same SQL statement; empty without a default provider. Bringing back an earlier transcript clears it. The meeting returns `autoPending`.
- **Who runs them:** the app, while the meeting is open (it already finishes conversions on Cloudflare; ADR-0001). `POST /speakers/suggest { auto: true }` and `POST /minutes { auto: true }`:
  - check that the default provider has permission and a key, so a missing one leaves the step pending and the app says what is missing;
  - then take the step from `auto_pending` with a compare and set, so two open tabs never pay twice; a step taken and failed is not retried on its own (the buttons stay);
  - `names` applies suggestions with high or medium confidence to voices that have no name yet (merged with a compare and set on `speaker_names`, so a name typed meanwhile wins). Low confidence ones (role descriptions) stay as suggestions the person can use.
- **What the person sees:** a strip on the meeting: "Poniendo nombres con Claude…", then "Redactando la minuta…", then which names the AI put, with a reminder to check them. "Detener" clears what is left (`DELETE /meetings/:id/auto`). The minutes tab opens when they arrive, labelled as AI-written as always.

### Revising the minutes

- **Sections:** the app splits the Markdown at the main headings (the smallest heading level used at least twice, plus any above it). Each section has two small buttons: edit by hand and ask for a change.
- **By hand:** the section opens as text; saving puts it back in its place and saves the whole minutes (`PUT /minutes`, as before).
- **With the model:** `POST /meetings/:id/minutes/:version/revise { instruction, part?, provider? }`. The prompt carries the transcript (so the model can check facts or add what was missed), the current minutes, the part to change if any, and the request. The transcript and minutes are delimited and declared as content; the request is the person's own. With `part`, the model returns only that section, which the server puts back where it was (refused with `409 minutes_changed` if the minutes changed meanwhile). A box under the minutes asks for changes to all of it.
- **Undo:** every manual or model change pushes the previous text to `minutes.undo` (the last 5, within D1's row size). `POST /minutes/:version/undo` brings it back. A revised version records the provider that revised it (`revised_with`), and its note says so.

## Alternatives considered

- Running names and minutes on the server when the transcription finishes: on Workers Free a long call does not fit `waitUntil`, and a queue or Durable Object is a new resource and an ADR. The app-driven steps work the same on a self-hosted server. Revisit if people want minutes ready before they open the app.
- A new version for each revision: the 10 version cap would push out the versions people keep for comparing models, and tabs would multiply. Revisions edit the version in place, with undo.
- Applying low confidence names: they are role guesses ("Moderadora"), so they stay suggestions.

## Risks and safeguards

- **Money:** the person's own key pays each automatic step and each revision; the steps are off by default, run once per transcript, and never retry on their own. Requests stay limited to 10 per minute per person. The ledger shows them (`revise` purpose).
- **AI and honesty:** automatic names say they came from the AI and can be changed; minutes keep their AI note; revisions are named in it.
- **Data:** nothing new leaves: the same transcript goes to the same provider the person already allowed. The undo history is deleted with the minutes and the meeting.
- **Prompt injection:** transcript and minutes stay inside delimiters and are declared as content; only the person's request is an instruction.

## Testing and rollout

Server tests: setting saved and returned; steps pending after a cloud or desktop transcript and cleared when an earlier one is used; a step taken once; names applied only to empty voices and only with high or medium confidence; a missing key leaves the step pending; revise of the whole and of a part, a stale part refused, undo, history cap; the usage ledger. Web tests for the section split. Checked in a browser against a fake model. Rollback: revert the PR; migration `0005` only adds columns.
