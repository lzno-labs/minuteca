// Bundles the desktop app into dist/ (CommonJS for Electron). sherpa-onnx-node and electron stay
// outside: the first is native and unpacked from the app archive, the second is the runtime.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

// MINUTECA_MAC_SIGNED=1 only for builds signed with a Developer ID (none yet; see the README).
const signed = process.env.MINUTECA_MAC_SIGNED === "1";
const common = { bundle: true, platform: "node", format: "cjs", target: "node22", sourcemap: false, logLevel: "warning", external: ["electron", "sherpa-onnx-node", "electron-updater"], define: { __MAC_SIGNED__: String(signed) } };
mkdirSync("dist", { recursive: true });
await Promise.all([
  build({ ...common, entryPoints: ["app/main.ts"], outfile: "dist/main.cjs" }),
  build({ ...common, entryPoints: ["app/preload.ts"], outfile: "dist/preload.cjs" }),
  build({ ...common, entryPoints: ["app/decode-preload.ts"], outfile: "dist/decode-preload.cjs" }),
  // engine/sherpa.ts reads import.meta.url only for the command line; the app passes its own module.
  build({ ...common, entryPoints: ["app/engine-worker.ts"], outfile: "dist/engine-worker.cjs", define: { ...common.define, "import.meta.url": '"file:///"' } }),
]);
copyFileSync("app/decode.html", "dist/decode.html");
