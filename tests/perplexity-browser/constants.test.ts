import { describe, expect, test } from "vitest";
import { buildSpaceUrl, PERPLEXITY_URL } from "../../src/perplexity-browser/constants.js";

describe("buildSpaceUrl", () => {
  test("constructs URL from slug", () => {
    expect(buildSpaceUrl("llmcli-0s6TGbvNSfe6kPyQRKdFww")).toBe(
      "https://www.perplexity.ai/spaces/llmcli-0s6TGbvNSfe6kPyQRKdFww",
    );
  });

  test("handles slug with no hash suffix", () => {
    expect(buildSpaceUrl("my-space")).toBe("https://www.perplexity.ai/spaces/my-space");
  });
});

describe("PERPLEXITY_URL", () => {
  test("is a valid URL with trailing slash", () => {
    expect(PERPLEXITY_URL).toBe("https://www.perplexity.ai/");
  });
});
