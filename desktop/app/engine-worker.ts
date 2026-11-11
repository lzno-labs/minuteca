// The local engine in an Electron utility process, so the window never freezes while models run
// (ADR 0005). It downloads and checks the models, then transcribes 16 kHz samples it receives.
// Messages in: { type: "models" } | { type: "transcribe", samples: Int16Array }.
// Messages out: { type: "progress", step, done?, total? } | { type: "done", value? } | { type: "error", code, detail }.
import { availableParallelism } from "node:os";
import { defaultModelsDir, ensureModels } from "../engine/models.ts";
import { transcribe } from "../engine/pipeline.ts";
import { DEFAULT_THRESHOLD, sherpaEngine } from "../engine/sherpa.ts";
import { toFloat32 } from "./core.ts";

interface Port {
  on(event: "message", listener: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}
const port = (process as unknown as { parentPort: Port }).parentPort;
const send = (m: unknown) => port.postMessage(m);
const dir = defaultModelsDir();
const threads = Math.max(1, Math.min(8, availableParallelism() - 1));

async function models() {
  await ensureModels(dir, { onProgress: (done, total) => send({ type: "progress", step: "models", done, total }) });
}

port.on("message", async ({ data }) => {
  const m = data as { type: string; samples?: Int16Array };
  try {
    if (m.type === "models") {
      await models().catch((e) => {
        throw Object.assign(new Error((e as Error).message), { code: "models_failed" });
      });
      send({ type: "done" });
    } else if (m.type === "transcribe" && m.samples) {
      await models().catch((e) => {
        throw Object.assign(new Error((e as Error).message), { code: "models_failed" });
      });
      send({ type: "progress", step: "voices" });
      // Bundled as CommonJS; the native module stays outside the bundle, unpacked from the app archive.
      const engine = sherpaEngine(dir, threads, require("sherpa-onnx-node"));
      const t = transcribe(engine, toFloat32(m.samples), DEFAULT_THRESHOLD, {
        recognized: (done, total) => send({ type: "progress", step: "text", done, total }),
      });
      send({ type: "done", value: t });
    }
  } catch (e) {
    send({ type: "error", code: (e as { code?: string }).code ?? "engine_failed", detail: (e as Error).message });
  }
});
