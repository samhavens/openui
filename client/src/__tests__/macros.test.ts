/**
 * Tests for parseNumberedOptions and computeMacros — mobile macro generation.
 */

import { describe, it, expect } from "vitest";
import { parseNumberedOptions, computeMacros, FALLBACK_MACROS } from "../utils/macros";

// --- parseNumberedOptions ---

describe("parseNumberedOptions", () => {
  it("returns null for text without numbered list", () => {
    expect(parseNumberedOptions("just plain text")).toBeNull();
  });

  it("returns null for single-item list (need at least 2)", () => {
    expect(parseNumberedOptions("❯ 1) Option One")).toBeNull();
  });

  it("parses numbered list with ❯ cursor indicator", () => {
    const text = "❯ 1) Option One\n  2) Option Two\n  3) Option Three";
    const result = parseNumberedOptions(text);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(3);
    expect(result![0].label).toBe("Option One");
    expect(result![1].label).toBe("Option Two");
    expect(result![2].label).toBe("Option Three");
  });

  it("parses list with 'enter to confirm' text", () => {
    const text = "1) Yes\n2) No\n(enter to confirm)";
    const result = parseNumberedOptions(text);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);
  });

  it("returns null for plain numbered list without selector", () => {
    const text = "1) First item\n2) Second item\n3) Third item";
    const result = parseNumberedOptions(text);
    expect(result).toBeNull(); // No ❯/› cursor, no "enter to confirm"
  });

  it("deduplicates by number", () => {
    const text = "❯ 1) Option A\n  2) Option B\n  1) Option A again";
    const result = parseNumberedOptions(text);
    expect(result).not.toBeNull();
    // Should only have 2 unique items
    expect(result!.length).toBe(2);
  });

  it("truncates labels longer than 30 chars", () => {
    const longLabel = "This is a very long option label that exceeds thirty characters";
    const text = `❯ 1) ${longLabel}\n  2) Short`;
    const result = parseNumberedOptions(text);
    expect(result).not.toBeNull();
    expect(result![0].label.length).toBeLessThanOrEqual(30);
    expect(result![0].label).toContain("…");
  });

  it("first item has primary variant, rest have default", () => {
    const text = "❯ 1) First\n  2) Second\n  3) Third";
    const result = parseNumberedOptions(text);
    expect(result![0].variant).toBe("primary");
    expect(result![1].variant).toBe("default");
    expect(result![2].variant).toBe("default");
  });

  it("generates arrow-down sequences for non-first items", () => {
    const text = "❯ 1) First\n  2) Second";
    const result = parseNumberedOptions(text);
    // First item: just Enter
    expect(result![0].data).toBe("\r");
    // Second item: arrow down + Enter
    expect(result![1].data).toContain("\x1b[B");
    expect(result![1].data).toContain("\r");
  });

  it("only uses last 1500 chars of input", () => {
    const padding = "x".repeat(2000);
    const text = padding + "\n❯ 1) Option A\n  2) Option B";
    const result = parseNumberedOptions(text);
    // Should still find options in the last 1500 chars
    expect(result).not.toBeNull();
  });
});

// --- computeMacros ---

describe("computeMacros", () => {
  it("waiting_input + AskUserQuestion with options → option macros", () => {
    const toolInput = {
      questions: [{
        options: [
          { label: "Option A" },
          { label: "Option B" },
        ],
      }],
    };
    const result = computeMacros("waiting_input", "AskUserQuestion", toolInput, "");
    expect(result.macros.length).toBe(2);
    expect(result.macros[0].label).toBe("Option A");
    expect(result.macros[0].variant).toBe("primary");
    expect(result.macros[1].label).toBe("Option B");
    expect(result.macros[1].variant).toBe("default");
    expect(result.context).toBe("Question");
  });

  it("waiting_input + other tool → permission prompt", () => {
    const result = computeMacros("waiting_input", "Bash", null, "");
    expect(result.macros.length).toBe(2);
    expect(result.macros[0].label).toBe("Allow");
    expect(result.macros[0].variant).toBe("primary");
    expect(result.macros[1].label).toBe("Deny");
    expect(result.macros[1].variant).toBe("danger");
    expect(result.context).toContain("Permission");
    expect(result.context).toContain("Bash");
  });

  it("running → interrupt button", () => {
    const result = computeMacros("running", undefined, null, "");
    expect(result.macros.length).toBe(1);
    expect(result.macros[0].label).toBe("Interrupt");
    expect(result.macros[0].variant).toBe("danger");
    expect(result.macros[0].data).toBe("\x03"); // Ctrl+C
  });

  it("idle status → empty macros", () => {
    const result = computeMacros("idle", undefined, null, "");
    expect(result.macros).toEqual([]);
  });

  it("waiting_input without currentTool + numbered options → parsed options", () => {
    const tailText = "❯ 1) Yes\n  2) No";
    const result = computeMacros(undefined, undefined, null, tailText);
    expect(result.macros.length).toBeGreaterThan(0);
    expect(result.context).toBe("Choose");
  });

  it("unknown status without tail → fallback macros", () => {
    const result = computeMacros("disconnected", undefined, null, "");
    expect(result.macros).toEqual(FALLBACK_MACROS);
  });

  it("waiting_input without currentTool → empty macros", () => {
    const result = computeMacros("waiting_input", undefined, null, "");
    expect(result.macros).toEqual([]);
  });
});
