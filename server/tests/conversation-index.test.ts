/**
 * Tests for pure functions in conversationIndex.ts:
 * extractContent, detectToolNoise, sanitizeFtsQuery
 */

import { describe, it, expect } from "bun:test";
import { extractContent, detectToolNoise, sanitizeFtsQuery } from "../services/conversationIndex";

// --- extractContent ---

describe("extractContent", () => {
  it("returns empty string when message is missing", () => {
    expect(extractContent({})).toBe("");
    expect(extractContent({ type: "user" })).toBe("");
  });

  // User messages
  it("extracts string content from user message", () => {
    const parsed = {
      type: "user",
      message: { content: "Hello, world!" },
    };
    expect(extractContent(parsed)).toBe("Hello, world!");
  });

  it("extracts text blocks from user message array content", () => {
    const parsed = {
      type: "user",
      message: {
        content: [
          { type: "text", text: "Part 1" },
          { type: "tool_result", content: "ignored" },
          { type: "text", text: "Part 2" },
        ],
      },
    };
    expect(extractContent(parsed)).toBe("Part 1\nPart 2");
  });

  it("returns empty for user message with non-string non-array content", () => {
    const parsed = {
      type: "user",
      message: { content: 42 },
    };
    expect(extractContent(parsed)).toBe("");
  });

  // Assistant messages
  it("extracts short assistant text content", () => {
    const parsed = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Here's the answer." }],
      },
    };
    expect(extractContent(parsed)).toBe("Here's the answer.");
  });

  it("truncates long assistant text (>800 chars → first 500 + last 200)", () => {
    const longText = "A".repeat(500) + "B".repeat(400);
    const parsed = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: longText }],
      },
    };
    const result = extractContent(parsed);
    expect(result).toContain("A".repeat(500));
    expect(result).toContain("...");
    expect(result).toContain("B".repeat(200));
    expect(result.length).toBeLessThan(longText.length);
  });

  it("handles assistant message with string content (not array)", () => {
    const parsed = {
      type: "assistant",
      message: { content: "plain string response" },
    };
    expect(extractContent(parsed)).toBe("plain string response");
  });

  it("handles assistant message with non-string non-array content", () => {
    const parsed = {
      type: "assistant",
      message: { content: 123 },
    };
    expect(extractContent(parsed)).toBe("");
  });

  // Unknown type
  it("returns empty for unknown type", () => {
    const parsed = {
      type: "system",
      message: { content: "system message" },
    };
    expect(extractContent(parsed)).toBe("");
  });
});

// --- detectToolNoise ---

describe("detectToolNoise", () => {
  it("returns true for short messages (<50 chars)", () => {
    expect(detectToolNoise("short")).toBe(true);
    expect(detectToolNoise("a".repeat(49))).toBe(true);
  });

  it("returns true for tool marker with stripped content <50 chars", () => {
    expect(detectToolNoise("[Tool: Read] checking file")).toBe(true);
  });

  it("returns true for 'Let me read...' pattern under 100 chars", () => {
    expect(detectToolNoise("Let me read the file to understand the context here")).toBe(true);
  });

  it("returns true for 'I'll check...' pattern under 100 chars", () => {
    expect(detectToolNoise("I'll check the configuration file for the settings")).toBe(true);
  });

  it("returns false for substantive content", () => {
    const substantive = "The implementation uses a factory pattern to create instances. " +
      "Each instance manages its own lifecycle and cleanup. " +
      "Here's how the initialization works in detail...";
    expect(detectToolNoise(substantive)).toBe(false);
  });

  it("returns true for exactly 49-char message", () => {
    expect(detectToolNoise("a".repeat(49))).toBe(true);
  });

  it("returns false for exactly 50-char substantive message", () => {
    // 50 chars, no tool patterns → false
    expect(detectToolNoise("a".repeat(50))).toBe(false);
  });

  it("returns true for 'Let me search...' at exactly 99 chars", () => {
    const msg = "Let me search " + "x".repeat(85);
    expect(msg.length).toBe(99);
    expect(detectToolNoise(msg)).toBe(true);
  });

  it("returns false for 'Let me search...' at 100+ chars", () => {
    const msg = "Let me search " + "x".repeat(86);
    expect(msg.length).toBe(100);
    expect(detectToolNoise(msg)).toBe(false);
  });
});

// --- sanitizeFtsQuery ---

describe("sanitizeFtsQuery", () => {
  it("wraps single term with quotes and wildcard", () => {
    expect(sanitizeFtsQuery("hello")).toBe('"hello"*');
  });

  it("wraps multi-term query, each with quotes and wildcard", () => {
    expect(sanitizeFtsQuery("hello world")).toBe('"hello"* "world"*');
  });

  it("strips FTS5 special characters and splits into terms", () => {
    const result = sanitizeFtsQuery('test"query{with}[special]');
    // Special chars are replaced with spaces, then each term gets quoted + wildcard
    expect(result).not.toContain("{");
    expect(result).not.toContain("[");
    expect(result).not.toContain("}");
    expect(result).not.toContain("]");
    // Each term is individually quoted
    expect(result).toContain('"test"*');
    expect(result).toContain('"query"*');
    expect(result).toContain('"with"*');
    expect(result).toContain('"special"*');
  });

  it("returns empty quoted string when input is all special chars", () => {
    expect(sanitizeFtsQuery('"{}()[]^~*')).toBe('""');
  });

  it("strips parentheses and carets", () => {
    const result = sanitizeFtsQuery("foo(bar)^baz");
    expect(result).toContain("foo");
    expect(result).toContain("bar");
    expect(result).toContain("baz");
  });
});
