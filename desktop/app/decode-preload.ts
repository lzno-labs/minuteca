// A hidden window decodes audio with Chromium's own decoders (AAC, MP3, Opus, WAV, FLAC), so the
// app ships no ffmpeg. Output: 16 kHz mono as 16-bit PCM (ADR 0005).
import { ipcRenderer } from "electron";

const RATE = 16_000;

ipcRenderer.on("decode", async (_e, job: { id: number; bytes: Uint8Array }) => {
  try {
    const ctx = new OfflineAudioContext(1, 1, RATE);
    const copy = job.bytes.buffer.slice(job.bytes.byteOffset, job.bytes.byteOffset + job.bytes.byteLength) as ArrayBuffer;
    const audio = await ctx.decodeAudioData(copy);
    const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
    const out = new Int16Array(audio.length);
    for (let i = 0; i < audio.length; i++) {
      let s = 0;
      for (const ch of channels) s += ch[i]!;
      s = Math.max(-1, Math.min(1, s / channels.length));
      out[i] = s < 0 ? s * 32768 : s * 32767;
    }
    ipcRenderer.send("decoded", { id: job.id, samples: out });
  } catch (e) {
    ipcRenderer.send("decoded", { id: job.id, error: (e as Error).message });
  }
});
