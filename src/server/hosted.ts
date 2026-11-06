/**
 * Hosted keys: provider keys paid by whoever runs the server, offered to people who have no
 * key of their own. The open core ships without them (this file returns null): everyone uses
 * their own key. The hosted version at minuteca.lzno.app replaces this file at deploy time
 * (pro/minuteca/ in Lzno's private repository) to offer Lzno's keys to its access list.
 *
 * Whatever this returns, every transcription still goes through startTranscription()
 * (transcription.ts), which meters each person and enforces monthlyCapSeconds.
 */
import type { HostedKeys } from "./transcription.ts";

export function hostedKeys(_env: Record<string, string | undefined>): HostedKeys | null {
  return null;
}
