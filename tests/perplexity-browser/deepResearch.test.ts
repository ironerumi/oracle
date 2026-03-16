import { describe, expect, test } from "vitest";
import {
  DEEP_RESEARCH_ICON_ID,
  DEEP_RESEARCH_TEXTS,
} from "../../src/perplexity-browser/constants.js";

describe("Deep Research constants", () => {
  test("telescope icon ID is correct", () => {
    expect(DEEP_RESEARCH_ICON_ID).toBe("#pplx-icon-telescope");
  });

  test("DR texts include both EN and JP labels", () => {
    expect(DEEP_RESEARCH_TEXTS).toContain("Deep Research");
    expect(DEEP_RESEARCH_TEXTS).toContain("深い研究");
  });
});

describe("Deep Research activation contract", () => {
  test("activateDeepResearch is exported", async () => {
    const mod = await import("../../src/perplexity-browser/actions/deepResearch.js");
    expect(typeof mod.activateDeepResearch).toBe("function");
  });
});
