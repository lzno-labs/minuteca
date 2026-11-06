// Default files backend: a folder on disk. The content type is stored next to each file.
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { FILE_KEY_RE, type Files } from "./files.ts";

export function diskFiles(root: string): Files {
  const base = resolve(root);
  const path = (key: string) => {
    if (!FILE_KEY_RE.test(key)) throw new Error("invalid file key");
    return join(base, key);
  };
  return {
    async put(key, body, contentType, size) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true });
      const tmp = `${p}.${crypto.randomUUID()}.part`;
      let seen = 0;
      const count = new Transform({
        transform(chunk: Buffer, _enc, done) {
          seen += chunk.length;
          if (seen > size) done(new Error("file is longer than declared"));
          else done(null, chunk);
        },
      });
      const source = body instanceof Uint8Array ? Readable.from([Buffer.from(body)]) : Readable.fromWeb(body as import("node:stream/web").ReadableStream);
      try {
        await pipeline(source, count, createWriteStream(tmp));
        if (seen !== size) throw new Error("file is shorter than declared");
        await writeFile(`${p}.type`, contentType);
        await rename(tmp, p);
      } catch (e) {
        await rm(tmp, { force: true });
        throw e;
      }
    },
    async get(key, range) {
      const p = path(key);
      let size: number;
      let contentType: string;
      try {
        [size, contentType] = await Promise.all([stat(p).then((s) => s.size), readFile(`${p}.type`, "utf8")]);
      } catch {
        return null;
      }
      if (range) {
        const length = Math.min(range.length ?? size - range.offset, size - range.offset);
        const stream = createReadStream(p, { start: range.offset, end: range.offset + length - 1 });
        return { body: Readable.toWeb(stream) as ReadableStream<Uint8Array>, size, contentType, range: { offset: range.offset, length } };
      }
      return { body: Readable.toWeb(createReadStream(p)) as ReadableStream<Uint8Array>, size, contentType };
    },
    async delete(key) {
      const p = path(key);
      await rm(p, { force: true });
      await rm(`${p}.type`, { force: true });
    },
  };
}
