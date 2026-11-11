// Desktop installers and their update feeds (docs/adr/0005): public and read only, from their own
// bucket (hosted) or a folder (self-hosting). The desktop app's updater reads latest.yml and
// latest-mac.yml here; /descargar links to the installers.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import type { FileRange, StoredFile } from "./files.ts";
import { r2Files, type R2Like } from "./r2.ts";

export interface Downloads {
  get(name: string, range?: FileRange): Promise<StoredFile | null>;
}

/** Plain file names only, with the extensions electron-builder writes. */
export const DOWNLOAD_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(yml|dmg|zip|exe|blockmap)$/;

const TYPES: Record<string, string> = {
  yml: "text/yaml; charset=utf-8",
  dmg: "application/x-apple-diskimage",
  zip: "application/zip",
  exe: "application/vnd.microsoft.portable-executable",
  blockmap: "application/octet-stream",
};
export const downloadType = (name: string) => TYPES[name.split(".").pop() ?? ""] ?? "application/octet-stream";

export function r2Downloads(bucket: R2Like): Downloads {
  const files = r2Files(bucket);
  return {
    async get(name, range) {
      if (!DOWNLOAD_RE.test(name)) return null;
      const f = await files.get(name, range);
      return f && { ...f, contentType: downloadType(name) };
    },
  };
}

export function diskDownloads(root: string): Downloads {
  const base = resolve(root);
  return {
    async get(name, range) {
      if (!DOWNLOAD_RE.test(name)) return null;
      const p = join(base, name);
      const size = await stat(p).then((s) => (s.isFile() ? s.size : -1), () => -1);
      if (size < 0) return null;
      const contentType = downloadType(name);
      if (range) {
        const length = Math.min(range.length ?? size - range.offset, size - range.offset);
        const body = Readable.toWeb(createReadStream(p, { start: range.offset, end: range.offset + length - 1 })) as ReadableStream<Uint8Array>;
        return { body, size, contentType, range: { offset: range.offset, length } };
      }
      return { body: Readable.toWeb(createReadStream(p)) as ReadableStream<Uint8Array>, size, contentType };
    },
  };
}
