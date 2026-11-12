// The local engine in an Electron utility process, so the window never freezes while models run
// (ADR 0005). It lists, downloads and checks the models, then transcribes 16 kHz samples it receives
// with the speech model the person chose (ADR 0007).
// Messages in: { type: "downloaded" } | { type: "models", model } | { type: "delete", model }
//   | { type: "transcribe", samples: Int16Array, model }.
// Messages out: { type: "progress", step, done?, total? } | { type: "done", value? } | { type: "error", code, detail }.
import { availableParallelism } from "node:os";
import { DEFAULT_SPEECH, defaultModelsDir, deleteSpeechModel, downloadedModels, ensureModels, filesFor, speechModel } from "../engine/models.ts";
import { transcribe } from "../engine/pipeline.ts";
import { threadsFor } from "../engine/recommend.ts";
import { DEFAULT_THRESHOLD, sherpaEngine } from "../engine/sherpa.ts";
import { toFloat32 } from "./core.ts";

interface Port {
  on(event: "message", listener: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}
const port = (process as unknown as { parentPort: Port }).parentPort;
const send = (m: unknown) => port.postMessage(m);
const dir = defaultModelsDir();
const threads = threadsFor(availableParallelism());

async function models(id: string) {
  await ensureModels(dir, { files: filesFor(speechModel(id)!.id), onProgress: (done, total) => send({ type: "progress", step: "models", done, total }) }).catch((e) => {
    throw Object.assign(new Error((e as Error).message), { code: "models_failed" });
  });
}

port.on("message", async ({ data }) => {
  const m = data as { type: string; samples?: Int16Array; model?: unknown };
  try {
    // Only ids from the catalog reach the file system; anything else means the default model.
    const id = speechModel(m.model)?.id ?? DEFAULT_SPEECH;
    if (m.type === "downloaded") {
      send({ type: "done", value: await downloadedModels(dir) });
    } else if (m.type === "models") {
      await models(id);
      send({ type: "done" });
    } else if (m.type === "delete") {
      await deleteSpeechModel(dir, id);
      send({ type: "done" });
    } else if (m.type === "transcribe" && m.samples) {
      await models(id);
      send({ type: "progress", step: "voices" });
      // Bundled as CommonJS; the native module stays outside the bundle, unpacked from the app archive.
      const engine = sherpaEngine(dir, threads, require("sherpa-onnx-node"), id);
      const t = transcribe(engine, toFloat32(m.samples), DEFAULT_THRESHOLD, {
        recognized: (done, total) => send({ type: "progress", step: "text", done, total }),
      });
      send({ type: "done", value: t });
    }
  } catch (e) {
    send({ type: "error", code: (e as { code?: string }).code ?? "engine_failed", detail: (e as Error).message });
  }
});
