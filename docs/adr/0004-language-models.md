# ADR-0004: Language models for speaker names and minutes, with each person's own key

- **Status:** Accepted
- **Date:** 2026-11-06
- **Supersedes:** none
- **Author:** founding agent (claude)

## Context

The owner asked for minutes written inside the app: first identify who each voice is, then write the minutes from the transcript, with the provider of each person's choice (Claude, Gemini, ChatGPT and others) and their own keys. Until now the app only shared the transcript with an AI app on the phone. Transcripts are work meetings with other people's voices, so where the text goes, permission and training policies matter as much as for audio (ADR-0002). The open core must not depend on one provider, the hosted version must not add spend for Lzno, and Workers Free gives each request 10 ms of CPU (ADR-0001).

## Options

1. **One provider (for example Claude) with Lzno's key.** Simplest, but ties the product to one vendor and makes Lzno pay for every minutes document.
2. **A third party router only (OpenRouter).** One adapter and many models, but one more company between the person and the model, and its own account.
3. **Our own adapter interface with the person's own keys:** Anthropic (official SDK), Google Gemini, OpenAI and OpenRouter (Chat Completions), plus a local OpenAI-compatible server (Ollama, LM Studio) that only the server administrator can configure.
4. **Run a model inside minuteca.** Not possible on Workers, and too heavy for the machines self-hosters use.

## Decision

Option 3.

- `src/server/llm/`: one adapter per provider with `complete` and `checkKey`. Claude uses `@anthropic-ai/sdk` (pinned), streaming with `finalMessage()`, `output_config.effort` (low for names, medium for minutes) and `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) so a safety decline is retried on Anthropic's recommended model; a final `refusal` becomes an error the app explains. Default models: `claude-opus-5-5`, `gemini-flash-latest`, `gpt-5.4-mini`, `openrouter/auto`; each person can type another model id.
- Keys use the same vault as transcription keys (AES-256-GCM, last 4 shown). One OpenAI key serves both uses.
- `runLlm()` in `src/server/minutes.ts` is the only function that calls a language model: it requires a stored permission for that provider (`llm:<provider>`, separate from the audio permission), uses the person's key, and records tokens per person in `llm_usage`. There are no hosted language model keys, so Lzno spends nothing; a hosted offer would be a pro feature with its own cap (a new ADR).
- The local provider exists only when `MINUTECA_LLM_LOCAL_URL` is set by the administrator. People cannot point the server at an address, which would let them make it fetch any URL.
- Speaker names are suggestions: the model returns JSON (`speaker`, `name`, `evidence`), the server keeps only voices that exist, and the person applies them. Minutes are Markdown, stored per meeting (`minutes` table), editable, exported with everything else, and deleted with the meeting after 30 days.
- The transcript is placed inside delimiters and the prompt says it is content, never instructions. Prompts live in `locales/<lang>.json` with the rest of the texts.
- CPU: the server parses one transcript (about 1 to 3 ms for two hours) and waits on the provider without spending CPU, so it fits Workers Free.

Provider data policies shown to people (to check again before relying on them): Anthropic and OpenAI do not train on API data by default; Gemini may use content from free tier keys to improve Google's products, not from paid ones; OpenRouter passes the text to the chosen model's provider; the local model keeps it on the server.

## Consequences

- People pay their provider directly; minuteca shows requests and tokens per month.
- A person without a key cannot use these features in the hosted version until they add one.
- Model ids change: defaults are aliases where the provider has one (`gemini-flash-latest`) and can be changed per person; a wrong id returns a clear error.
- Revisit if the family wants this without their own keys (hosted keys in `pro/`, with a cap in code and an owner decision on cost), or when a provider changes its data policy.
- Self-hosting: works the same, and `MINUTECA_LLM_LOCAL_URL` lets everything stay on the machine.
