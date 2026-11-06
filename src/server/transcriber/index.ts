import { assemblyai } from "./assemblyai.ts";
import { deepgram } from "./deepgram.ts";
import { openai } from "./openai.ts";
import type { Fetcher, Provider, Transcriber } from "./transcriber.ts";

export function transcribers(fetcher: Fetcher = fetch): Record<Provider, Transcriber> {
  return { deepgram: deepgram(fetcher), assemblyai: assemblyai(fetcher), openai: openai(fetcher) };
}
