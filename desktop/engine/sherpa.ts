// The Engine backed by sherpa-onnx (Apache-2.0), installed only in desktop/ so the server never
// downloads native binaries. Speaker settings come from the spike in docs/adr/0005.
import { createRequire } from "node:module";
import { SAMPLE_RATE } from "./blocks.ts";
import { modelPath } from "./models.ts";
import type { Engine } from "./pipeline.ts";

/**
 * Clustering threshold: 0.6 merged voices in the spike, 0.4 and 0.5 did not. A fixed number of
 * speakers (numClusters) merged two of three voices, so the count is never passed.
 */
export const DEFAULT_THRESHOLD = 0.5;

/** sherpa-onnx-node from desktop/node_modules (the command line). The desktop app passes its own. */
export function loadSherpa(): unknown {
  const require = createRequire(new URL("../package.json", import.meta.url));
  try {
    return require("sherpa-onnx-node");
  } catch {
    throw new Error("sherpa-onnx-node is not installed: run  npm ci --prefix desktop");
  }
}

export function sherpaEngine(dir: string, threads: number, module: unknown = loadSherpa()): Engine {
  const sherpa = module as any;
  const diarizer = (threshold: number) =>
    new sherpa.OfflineSpeakerDiarization({
      segmentation: { pyannote: { model: modelPath(dir, "segmentation/model.onnx") }, numThreads: threads },
      embedding: { model: modelPath(dir, "embedding/wespeaker_en_voxceleb_resnet34_LM.onnx"), numThreads: threads },
      clustering: { numClusters: -1, threshold },
      minDurationOn: 0.3,
      minDurationOff: 0.5,
    });
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: modelPath(dir, "parakeet/encoder.int8.onnx"),
        decoder: modelPath(dir, "parakeet/decoder.int8.onnx"),
        joiner: modelPath(dir, "parakeet/joiner.int8.onnx"),
      },
      tokens: modelPath(dir, "parakeet/tokens.txt"),
      numThreads: threads,
      provider: "cpu",
      modelType: "nemo_transducer",
    },
  });
  return {
    diarize(samples, threshold = DEFAULT_THRESHOLD) {
      return diarizer(threshold).process(samples).map((s: { start: number; end: number; speaker: number }) => ({ start: s.start, end: s.end, speaker: s.speaker }));
    },
    recognize(samples) {
      const stream = recognizer.createStream();
      stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples });
      recognizer.decode(stream);
      const r = recognizer.getResult(stream);
      return { text: r.text ?? "", tokens: r.tokens ?? [], timestamps: r.timestamps ?? [], durations: r.durations };
    },
  };
}
