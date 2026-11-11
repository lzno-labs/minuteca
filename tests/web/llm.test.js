import { describe, expect, it } from "vitest";
import { llmMissing, readyLlms, startingLlm } from "../../src/web/lib/llm";

const me = (provider, providers) => ({ llm: { provider, providers } });
const p = (id, ownKey = false, needsKey = true) => ({ id, needsKey, ownKey: ownKey ? { last4: "1234" } : null });

describe("language models ready to choose", () => {
  it("lists the configured ones in the app's order and starts with the default", () => {
    const m = me("gemini", [p("gemini", true), p("anthropic", true), p("openai"), p("local", false, false)]);
    expect(readyLlms(m)).toEqual(["anthropic", "gemini", "local"]);
    expect(startingLlm(m)).toBe("gemini");
  });

  it("starts with the first ready one when the default has no key", () => {
    const m = me("openai", [p("openai"), p("anthropic", true)]);
    expect(startingLlm(m)).toBe("anthropic");
    expect(llmMissing(m)).toBe("key");
    expect(llmMissing(m, "anthropic")).toBeNull();
    expect(llmMissing(m, "gemini")).toBe("provider");
    expect(startingLlm(me(null, [p("openai")]))).toBeNull();
  });
});
