// Cloudflare R2 adapter. Generic: the bucket comes from the deployment's wrangler.toml binding.
import type { Files } from "./files.ts";

interface R2ObjectLike {
  body: ReadableStream<Uint8Array>;
  size: number;
  httpMetadata?: { contentType?: string };
  range?: { offset?: number; length?: number };
}

/** The part of the R2Bucket binding this adapter uses. */
export interface R2Like {
  put(key: string, value: ReadableStream<Uint8Array> | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string, options?: { range?: { offset: number; length?: number } }): Promise<R2ObjectLike | null>;
  delete(key: string): Promise<void>;
}

/** Workers' FixedLengthStream: R2 needs to know the length of a streamed upload, and it fails on a mismatch. */
type FixedLengthStreamCtor = new (length: number) => TransformStream<Uint8Array, Uint8Array>;

export function r2Files(bucket: R2Like): Files {
  return {
    async put(key, body, contentType, size) {
      let value = body;
      if (!(body instanceof Uint8Array)) {
        const Fixed = (globalThis as unknown as { FixedLengthStream?: FixedLengthStreamCtor }).FixedLengthStream;
        if (Fixed) value = body.pipeThrough(new Fixed(size));
      } else if (body.byteLength !== size) {
        throw new Error("file size does not match");
      }
      await bucket.put(key, value, { httpMetadata: { contentType } });
    },
    async get(key, range) {
      const obj = await bucket.get(key, range ? { range: { offset: range.offset, length: range.length } } : undefined);
      if (!obj) return null;
      const contentType = obj.httpMetadata?.contentType ?? "application/octet-stream";
      if (range) {
        const offset = obj.range?.offset ?? range.offset;
        const length = obj.range?.length ?? Math.min(range.length ?? obj.size - offset, obj.size - offset);
        return { body: obj.body, size: obj.size, contentType, range: { offset, length } };
      }
      return { body: obj.body, size: obj.size, contentType };
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}
