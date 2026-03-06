/**
 * Tests for stripAnsi() — multi-pass ANSI/VT100 escape sequence stripping.
 * Exercises each pass independently and composed.
 */

import { describe, it, expect } from "bun:test";
import { stripAnsi } from "../routes/api";

// --- Pass 1: cursor-movement sequences ---

describe("stripAnsi — Pass 1: cursor-movement", () => {
  it("converts cursor-home (ESC[H) to newline", () => {
    const result = stripAnsi("line1\x1b[Hline2");
    expect(result).toContain("line1");
    expect(result).toContain("line2");
    expect(result).not.toBe("line1line2");
  });

  it("converts cursor-position with params (ESC[row;colH) to newline", () => {
    const result = stripAnsi("before\x1b[5;10Hafter");
    expect(result).toContain("before");
    expect(result).toContain("after");
  });

  it("strips cursor-up (ESC[NA)", () => {
    const result = stripAnsi("line\x1b[2Amore");
    expect(result).toBe("linemore");
  });

  it("strips cursor-up with no count (ESC[A)", () => {
    const result = stripAnsi("text\x1b[Amore");
    expect(result).toBe("textmore");
  });

  it("converts cursor-forward (ESC[NC) to N spaces", () => {
    const result = stripAnsi("word1\x1b[5Cword2");
    expect(result).toMatch(/word1\s{5}word2/);
  });

  it("converts bare cursor-forward (ESC[C) to single space", () => {
    const result = stripAnsi("a\x1b[Cb");
    expect(result).toBe("a b");
  });

  it("caps cursor-forward spaces at 200", () => {
    const result = stripAnsi("a\x1b[999Cb");
    const spaces = result.length - 2; // minus 'a' and 'b'
    expect(spaces).toBe(200);
  });

  it("converts cursor-to-column (ESC[NG) to single space", () => {
    const result = stripAnsi("text\x1b[10Gmore");
    expect(result).toBe("text more");
  });
});

// --- Pass 2: strip all escape sequences ---

describe("stripAnsi — Pass 2: escape sequence stripping", () => {
  it("strips OSC sequences (ESC] ... BEL)", () => {
    const result = stripAnsi("\x1b]0;window title\x07visible text");
    expect(result).toBe("visible text");
  });

  it("strips OSC sequences (ESC] ... ESC\\)", () => {
    const result = stripAnsi("\x1b]0;title\x1b\\visible");
    expect(result).toBe("visible");
  });

  it("strips CSI color codes (ESC[32m etc)", () => {
    const result = stripAnsi("\x1b[32mgreen\x1b[0m normal");
    expect(result).toBe("green normal");
  });

  it("strips DEC private modes (ESC[?2026h)", () => {
    const result = stripAnsi("\x1b[?2026htext\x1b[?2026l");
    expect(result).toBe("text");
  });

  it("strips other two-byte ESC sequences (ESC=, ESC>)", () => {
    const result = stripAnsi("\x1b=text\x1b>");
    expect(result).toBe("text");
  });

  it("strips lone ESC byte", () => {
    // Note: ESC followed by 'a' is consumed as a two-byte ESC sequence (ESC + non-'[')
    // A truly lone ESC at end-of-string is stripped by the lone ESC pass
    const result = stripAnsi("before\x1b");
    expect(result).toBe("before");
  });

  it("strips NUL bytes", () => {
    const result = stripAnsi("he\x00llo");
    expect(result).toBe("hello");
  });
});

// --- Pass 3: \r overwrite simulation ---

describe("stripAnsi — Pass 3: \\r overwrite", () => {
  it("longer overwrite replaces shorter", () => {
    const result = stripAnsi("loading...\rdone      ");
    expect(result.trim()).toBe("done");
    expect(result).not.toContain("loading");
  });

  it("shorter overwrite replaces beginning, keeps remainder", () => {
    const result = stripAnsi("ABCDEF\rXY");
    expect(result).toBe("XYCDEF");
  });

  it("no \\r leaves line unchanged", () => {
    const result = stripAnsi("no carriage return here");
    expect(result).toBe("no carriage return here");
  });

  it("multiple \\r segments compose correctly", () => {
    const result = stripAnsi("first\rsecond\rthird!");
    // "first" → "second" (longer) → "third!" overwrites first 6 chars of "second"
    expect(result).toBe("third!");
  });
});

// --- Pass 4: spinner line collapse ---

describe("stripAnsi — Pass 4: spinner line collapse", () => {
  it("collapses consecutive *(thinking) lines to last one", () => {
    const input = "*(thinking)\n*(thinking)\n*(thinking)\nDone!";
    const result = stripAnsi(input);
    const thinkingLines = result.split("\n").filter((l: string) => l.includes("thinking"));
    expect(thinkingLines.length).toBe(1);
    expect(result).toContain("Done!");
  });

  it("keeps non-thinking lines between thinking lines", () => {
    const input = "*(thinking)\nreal output\n*(thinking)";
    const result = stripAnsi(input);
    const lines = result.split("\n").filter((l: string) => l.trim());
    expect(lines.length).toBe(3);
  });

  it("handles braille spinner chars in thinking lines", () => {
    const input = "⠋(thinking)\n⠙(thinking)\n⠹(thinking)";
    const result = stripAnsi(input);
    const thinkingLines = result.split("\n").filter((l: string) => l.includes("thinking"));
    expect(thinkingLines.length).toBe(1);
  });
});

// --- Pass 5: consecutive identical line dedup ---

describe("stripAnsi — Pass 5: consecutive identical line dedup", () => {
  it("deduplicates consecutive identical non-empty lines", () => {
    const input = "same line\nsame line\nsame line\ndifferent";
    const result = stripAnsi(input);
    const lines = result.split("\n").filter((l: string) => l.trim());
    expect(lines.filter((l: string) => l === "same line").length).toBe(1);
    expect(result).toContain("different");
  });

  it("keeps non-consecutive identical lines", () => {
    const input = "A\nB\nA";
    const result = stripAnsi(input);
    const lines = result.split("\n").filter((l: string) => l.trim());
    expect(lines).toEqual(["A", "B", "A"]);
  });

  it("preserves blank lines (only non-empty lines dedup)", () => {
    const input = "text\n\n\ntext";
    const result = stripAnsi(input);
    // blank lines are preserved, consecutive blank lines collapsed by pass 9
    expect(result).toContain("text");
  });
});

// --- Pass 6: single-char artifact line removal ---

describe("stripAnsi — Pass 6: single-char artifact removal", () => {
  it("removes runs of 4+ single-char lines", () => {
    const input = "real\na\nb\nc\nd\ne\nreal";
    const result = stripAnsi(input);
    expect(result).toContain("real");
    const singleCharLines = result.split("\n").filter((l: string) => l.trim().length === 1);
    expect(singleCharLines.length).toBe(0);
  });

  it("keeps runs of less than 4 single-char lines", () => {
    const input = "real\na\nb\nc\nreal";
    const result = stripAnsi(input);
    expect(result).toContain("a");
    expect(result).toContain("b");
    expect(result).toContain("c");
  });

  it("removes 2-char artifact lines in runs of 4+", () => {
    const input = "real\nab\ncd\nef\ngh\nij\nreal";
    const result = stripAnsi(input);
    const shortLines = result.split("\n").filter((l: string) => {
      const t = l.trim();
      return t.length > 0 && t.length <= 2;
    });
    expect(shortLines.length).toBe(0);
  });
});

// --- Pass 8: multi-line block dedup ---

describe("stripAnsi — Pass 8: multi-line block dedup", () => {
  it("deduplicates repeated 5-line blocks", () => {
    const block = "line1\nline2\nline3\nline4\nline5";
    const input = block + "\n" + block;
    const result = stripAnsi(input);
    const count = (result.match(/line3/g) || []).length;
    expect(count).toBe(1);
  });

  it("does not remove non-duplicate blocks", () => {
    // Use longer lines to avoid Pass 6 artifact removal (which strips single-char lines)
    const block1 = "alpha\nbravo\ncharlie\ndelta\necho";
    const block2 = "foxtrot\ngolf\nhotel\nindia\njuliet";
    const input = block1 + "\n" + block2;
    const result = stripAnsi(input);
    expect(result).toContain("alpha");
    expect(result).toContain("foxtrot");
  });
});

// --- Pass 9: blank line collapse ---

describe("stripAnsi — Pass 9: blank line collapse", () => {
  it("collapses 3+ consecutive blank lines to 2", () => {
    const input = "before\n\n\n\n\nafter";
    const result = stripAnsi(input);
    // Should have at most 2 consecutive newlines
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain("before");
    expect(result).toContain("after");
  });

  it("leaves 2 consecutive blank lines alone", () => {
    const input = "before\n\nafter";
    const result = stripAnsi(input);
    expect(result).toBe("before\n\nafter");
  });
});

// --- Integration tests ---

describe("stripAnsi — integration", () => {
  it("empty string returns empty", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("already-clean string passes through", () => {
    const clean = "Hello, this is plain text.\nWith a second line.";
    const result = stripAnsi(clean);
    expect(result).toBe(clean);
  });

  it("composes all passes on complex TUI output", () => {
    // Simulate: color codes + cursor moves + spinner + duplicates + artifact lines
    const input = [
      "\x1b[32m*(thinking)\x1b[0m",
      "\x1b[32m*(thinking)\x1b[0m",
      "\x1b[32m*(thinking)\x1b[0m",
      "Result: 42",
      "Result: 42",
      "\x1b[Ha\nb\nc\nd\ne",
      "",
      "",
      "",
      "Final output",
    ].join("\n");

    const result = stripAnsi(input);
    // Spinners collapsed, duplicates removed, artifact lines removed, blanks collapsed
    expect(result).toContain("thinking");
    expect(result).toContain("Result: 42");
    expect(result).toContain("Final output");
    expect(result).not.toContain("\x1b");
    // Only one "Result: 42"
    expect((result.match(/Result: 42/g) || []).length).toBe(1);
  });

  it("handles OSC hyperlinks - keeps visible text, strips URL", () => {
    const input = "before \x1b]8;;https://example.com\x07link text\x1b]8;;\x07 after";
    const result = stripAnsi(input);
    expect(result).toContain("before");
    expect(result).toContain("link text");
    expect(result).toContain("after");
    expect(result).not.toContain("https://");
    expect(result).not.toContain("\x1b");
  });
});
