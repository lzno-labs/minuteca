# ADR-0007: Local speech models: Parakeet or Whisper, chosen per computer

- **Status:** Accepted
- **Date:** 2026-11-12
- **Supersedes:** none (extends ADR-0005, whose engine already sits behind an interface "so Whisper can be added")
- **Author:** founding agent (claude)

## Context

ADR-0005 ships one local speech model, NVIDIA Parakeet TDT 0.6B v3, with pyannote and WeSpeaker for speaker separation. The owner asked for a choice of local models such as Whisper, downloaded from the app, with a recommendation based on the computer. Whisper is the best known open model, detects the language, and is usually robust in noisy rooms; Parakeet was faster and more accurate on our test meeting. Computers range from 8 GB laptops to 32 GB Apple Silicon machines.

Measured on 2026-11-12 with the synthetic 3-voice Spanish meeting of ADR-0005 (124 s, 4 CPU cores, no GPU), same speaker separation (99.7% of speech time on the right voice for all):

| Model (int8, sherpa-onnx) | Download | Words like the reference | Time (x real time) |
| --- | --- | --- | --- |
| Parakeet TDT 0.6B v3 | 670 MB | 91.5% | 0.18 |
| Whisper base | 161 MB | 82.4% | 0.23 |
| Whisper small | 375 MB | 84.7% | 0.49 |
| Whisper large-v3 turbo | 1.04 GB | 88.2% | 0.43 |

## Options

1. **whisper.cpp as a second engine** (Metal on Mac, Vulkan on Windows). Fast on GPUs, but a second native dependency to build, sign and update per platform.
2. **Whisper through sherpa-onnx**, the engine we already ship. ONNX int8 exports exist for every Whisper size, pinned on Hugging Face like Parakeet. CPU only for now; no new native code.
3. **Keep Parakeet only.** Simplest, but no answer for people whose rooms or languages suit Whisper better.

## Decision

Option 2.

- A catalog in `desktop/engine/models.ts`: Parakeet v3 (default), Whisper large-v3 turbo, Whisper small and Whisper base, each with pinned Hugging Face revisions, sizes and SHA-256. Medium, large-v3 and tiny are left out: slower than turbo for no gain, too slow on CPU, or too inaccurate in Spanish. Speaker separation models are shared by all.
- The app recommends one from the computer's memory and cores (Whisper base under 6 GB of memory, else Parakeet), shows an estimate of the time per hour of audio from the table above, and marks a model as too big when it does not fit in memory. People download, choose and delete models in Settings; nothing is downloaded until they choose or transcribe.
- Whisper does not return word times through sherpa-onnx, so its sentences share their window's time in proportion to their length. Whisper's detected language is stored in the transcript (`language`), which the minutes use (ADR-0004).
- The transcript's `model` names the speech model and the speaker models, as before.
- Licenses: Whisper weights are MIT (OpenAI), ONNX exports by the sherpa-onnx project; credited with the others.

## Consequences

- People can compare Parakeet and Whisper on their own meetings (each run is a transcript version, ADR-0002), and keep the one that does better.
- More disk: up to about 2.3 GB if someone downloads every model; each can be deleted.
- Whisper turbo is slow on older computers (about 0.4 times real time on 4 cores); the estimate says so before downloading.
- Revisit with whisper.cpp or a GPU provider if CPU speed becomes the complaint, or when a better open model appears for Spanish.
