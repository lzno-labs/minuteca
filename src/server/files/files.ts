/**
 * The files boundary (meeting audio). Implementations: local disk (default) and Cloudflare R2
 * (hosted version). Bodies are streams so a long recording never has to fit in memory.
 */
export interface FileRange {
  offset: number;
  /** Bytes to read; to the end of the file when missing. */
  length?: number;
}

export interface StoredFile {
  body: ReadableStream<Uint8Array>;
  /** Size of the whole file. */
  size: number;
  contentType: string;
  /** The part returned, when a range was asked for. */
  range?: { offset: number; length: number };
}

export interface Files {
  /** Stores exactly `size` bytes; fails (and stores nothing) if the body is longer or shorter. */
  put(key: string, body: ReadableStream<Uint8Array> | Uint8Array, contentType: string, size: number): Promise<void>;
  get(key: string, range?: FileRange): Promise<StoredFile | null>;
  delete(key: string): Promise<void>;
}

/**
 * Keys look like audio/<user id>/<meeting id> (the recording) or raw/<user id>/<meeting id> (a
 * provider's answer waiting to be converted); anything else is rejected before touching storage.
 */
export const FILE_KEY_RE = /^(audio|raw)\/[A-Za-z0-9-]{8,64}\/[A-Za-z0-9-]{8,64}$/;

function key(kind: "audio" | "raw", userId: string, meetingId: string): string {
  const k = `${kind}/${userId}/${meetingId}`;
  if (!FILE_KEY_RE.test(k)) throw new Error("invalid file key");
  return k;
}

export const audioKey = (userId: string, meetingId: string) => key("audio", userId, meetingId);
export const rawKey = (userId: string, meetingId: string) => key("raw", userId, meetingId);

/** Reads a whole stored file into memory (only for providers that need the bytes, never for big files). */
export async function readAll(file: StoredFile): Promise<Uint8Array> {
  return new Uint8Array(await new Response(file.body).arrayBuffer());
}

/**
 * Parses a single "bytes=a-b" Range header against a file size. Returns null when the header is
 * missing, "invalid" when it cannot be satisfied.
 */
export function parseRange(header: string | null | undefined, size: number): FileRange | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return "invalid";
  let start: number;
  let end: number;
  if (!m[1]) {
    const suffix = Number(m[2]);
    if (!suffix) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || end < start) return "invalid";
  return { offset: start, length: end - start + 1 };
}
