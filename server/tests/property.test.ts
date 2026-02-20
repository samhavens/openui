/**
 * Property-based tests for server pure functions using fast-check.
 *
 * Each property is designed to be adversarial — the generators target
 * the actual edge cases in the implementation, not just random noise.
 */

import { describe, it, expect, afterAll } from "bun:test";
import fc from "fast-check";
import { normalizeAgentCommand, buildPtyEnv } from "../services/sessionManager";
import { buildRestartCommand } from "../routes/api";
import { parseGitHubUrl } from "../services/github";
import { atomicWriteJson } from "../services/persistence";
import { readFileSync, existsSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const PROP_DIR = join(tmpdir(), `openui-prop-test-${Date.now()}`);
mkdirSync(PROP_DIR, { recursive: true });

afterAll(() => {
  if (existsSync(PROP_DIR)) rmSync(PROP_DIR, { recursive: true });
});

// --- normalizeAgentCommand ---

describe("normalizeAgentCommand properties", () => {
  // Generator that produces commands likely to exercise the regex replacements
  const claudeCommandArb = fc.oneof(
    fc.constant("isaac claude"),
    fc.constant("llm agent claude"),
    fc.constant("claude"),
    fc.constant("isaac claude --dangerously-skip-permissions"),
    fc.constant("llm agent claude --resume abc"),
    // Commands with multiple occurrences (regex uses /g flag)
    fc.constant("isaac claude && isaac claude"),
    // Partial matches that should NOT be replaced
    fc.constant("isaac claudex"),
    fc.constant("xisaac claude"),
    // Random strings for baseline
    fc.string(),
  );

  it("is idempotent: f(f(x, claude, false), claude, false) === f(x, claude, false)", () => {
    fc.assert(
      fc.property(claudeCommandArb, (cmd) => {
        const once = normalizeAgentCommand(cmd, "claude", false);
        const twice = normalizeAgentCommand(once, "claude", false);
        return once === twice;
      }),
      { numRuns: 500 }
    );
  });

  it("when hasIsaac=true, output always equals input (early return)", () => {
    fc.assert(
      fc.property(claudeCommandArb, (cmd) => {
        return normalizeAgentCommand(cmd, "claude", true) === cmd;
      }),
      { numRuns: 200 }
    );
  });

  it("output never contains 'isaac claude' when hasIsaac=false and agentId='claude'", () => {
    fc.assert(
      fc.property(claudeCommandArb, (cmd) => {
        const result = normalizeAgentCommand(cmd, "claude", false);
        // After normalization, 'isaac claude' (as a word boundary match) should be gone
        return !/\bisaac claude\b/.test(result);
      }),
      { numRuns: 500 }
    );
  });

  it("output never contains 'llm agent claude' when hasIsaac=false and agentId='claude'", () => {
    fc.assert(
      fc.property(claudeCommandArb, (cmd) => {
        const result = normalizeAgentCommand(cmd, "claude", false);
        return !/\bllm agent claude\b/.test(result);
      }),
      { numRuns: 500 }
    );
  });
});

// --- buildPtyEnv ---

describe("buildPtyEnv properties", () => {
  it("never leaks any key from PTY_STRIP_ENV_KEYS regardless of process.env state", () => {
    // Temporarily set CLAUDECODE and CLAUDE_CODE_ENTRYPOINT to various values
    const envValueArb = fc.oneof(fc.constant("1"), fc.constant(""), fc.string());

    fc.assert(
      fc.property(fc.string(), envValueArb, (sessionId, envVal) => {
        const origCC = process.env.CLAUDECODE;
        const origCE = process.env.CLAUDE_CODE_ENTRYPOINT;

        process.env.CLAUDECODE = envVal;
        process.env.CLAUDE_CODE_ENTRYPOINT = envVal;

        try {
          const env = buildPtyEnv(sessionId);
          return !("CLAUDECODE" in env) && !("CLAUDE_CODE_ENTRYPOINT" in env);
        } finally {
          if (origCC === undefined) delete process.env.CLAUDECODE;
          else process.env.CLAUDECODE = origCC;
          if (origCE === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT;
          else process.env.CLAUDE_CODE_ENTRYPOINT = origCE;
        }
      }),
      { numRuns: 100 }
    );
  });

  it("OPENUI_SESSION_ID always matches the input sessionId exactly", () => {
    // Use strings with special chars, unicode, etc
    const sessionIdArb = fc.oneof(
      fc.string(),
      fc.constant("session-with spaces"),
      fc.constant("session\nwith\nnewlines"),
      fc.constant(""),
      fc.constant("session-123-abc-" + "x".repeat(1000)),
    );

    fc.assert(
      fc.property(sessionIdArb, (sessionId) => {
        const env = buildPtyEnv(sessionId);
        return env.OPENUI_SESSION_ID === sessionId && env.TERM === "xterm-256color";
      }),
      { numRuns: 200 }
    );
  });

  it("no env value is undefined (would break child process spawn)", () => {
    fc.assert(
      fc.property(fc.string(), (sessionId) => {
        const env = buildPtyEnv(sessionId);
        return Object.values(env).every((v) => v !== undefined);
      }),
      { numRuns: 100 }
    );
  });
});

// --- buildRestartCommand ---

describe("buildRestartCommand properties", () => {
  // Generator for commands that already have --resume flags (the bug vector)
  const commandWithResumeArb = fc.oneof(
    fc.constant("claude"),
    fc.constant("isaac claude"),
    fc.constant("llm agent claude"),
    fc.constant("claude --resume aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    fc.constant("isaac claude --resume old-stale-id"),
    fc.constant("claude --resume bad --resume double"),
    fc.constant("claude --dangerously-skip-permissions"),
    fc.constant("claude --resume"),
  );

  const uuidArb = fc.uuid().map((u) => u.toString());

  it("output has at most one --resume flag (regardless of claudeSessionId)", () => {
    // This property originally caught a real bug: when claudeSessionId was null,
    // stale --resume flags passed through unstripped. Fixed by moving the strip
    // logic outside the UUID-injection conditional.
    fc.assert(
      fc.property(commandWithResumeArb, fc.option(uuidArb), fc.boolean(), (cmd, uuid, hasIsaac) => {
        const result = buildRestartCommand(cmd, "claude", uuid ?? undefined, hasIsaac);
        const count = (result.match(/--resume/g) || []).length;
        return count <= 1;
      }),
      { numRuns: 500 }
    );
  });

  it("regression: stale --resume flags are stripped even when claudeSessionId is null", () => {
    // Regression test for bug found by property testing.
    // Previously, "claude --resume bad --resume double" with null claudeSessionId
    // passed through with both stale flags intact.
    const result = buildRestartCommand("claude --resume bad --resume double", "claude", undefined, false);
    const count = (result.match(/--resume/g) || []).length;
    expect(count).toBe(0);
    expect(result).toBe("claude");
  });

  it("when claudeSessionId provided, it appears in output (for claude agents)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("claude", "isaac claude", "llm agent claude"),
        uuidArb,
        fc.boolean(),
        (cmd, uuid, hasIsaac) => {
          const result = buildRestartCommand(cmd, "claude", uuid, hasIsaac);
          return result.includes(uuid);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("stale --resume is always replaced, never preserved alongside new one", () => {
    const staleUuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    fc.assert(
      fc.property(
        fc.constantFrom(
          `claude --resume ${staleUuid}`,
          `isaac claude --resume ${staleUuid}`,
          `claude --resume ${staleUuid} --dangerously-skip-permissions`,
        ),
        uuidArb.filter((u) => u !== staleUuid),
        fc.boolean(),
        (cmd, freshUuid, hasIsaac) => {
          const result = buildRestartCommand(cmd, "claude", freshUuid, hasIsaac);
          return !result.includes(staleUuid) && result.includes(freshUuid);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("non-claude agents never get --resume injected", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string().filter((s) => s !== "claude"),
        fc.option(uuidArb),
        fc.boolean(),
        (cmd, agentId, uuid, hasIsaac) => {
          const result = buildRestartCommand(cmd, agentId, uuid ?? undefined, hasIsaac);
          // For non-claude agents, buildRestartCommand calls normalizeAgentCommand
          // which returns cmd unchanged (agentId !== "claude"), then skips --resume injection
          return result === cmd || result === normalizeAgentCommand(cmd, agentId, hasIsaac);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// --- parseGitHubUrl ---

describe("parseGitHubUrl properties", () => {
  it("roundtrip: parse(github.com/owner/repo) recovers owner and repo", () => {
    // GitHub usernames: alphanumeric + hyphens, no leading/trailing/consecutive hyphens
    const ghName = fc.stringMatching(/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/)
      .filter((s) => s.length > 0 && s.length < 40 && !s.includes("--"));

    fc.assert(
      fc.property(ghName, ghName, (owner, repo) => {
        const url = `https://github.com/${owner}/${repo}`;
        const result = parseGitHubUrl(url);
        return result !== null && result.owner === owner && result.repo === repo;
      }),
      { numRuns: 500 }
    );
  });

  it(".git suffix is always stripped from repo name", () => {
    const ghName = fc.stringMatching(/^[a-zA-Z0-9-]+$/).filter((s) => s.length > 0);

    fc.assert(
      fc.property(ghName, ghName, (owner, repo) => {
        const url = `https://github.com/${owner}/${repo}.git`;
        const result = parseGitHubUrl(url);
        return result !== null && result.repo === repo && !result.repo.endsWith(".git");
      }),
      { numRuns: 200 }
    );
  });

  it("trailing path segments don't affect owner/repo extraction", () => {
    const ghName = fc.stringMatching(/^[a-zA-Z0-9-]+$/).filter((s) => s.length > 0);
    const pathSuffix = fc.constantFrom(
      "/issues/42",
      "/pull/1",
      "/tree/main/src",
      "/blob/main/README.md",
      "/actions/runs/12345",
      "",
    );

    fc.assert(
      fc.property(ghName, ghName, pathSuffix, (owner, repo, suffix) => {
        const url = `https://github.com/${owner}/${repo}${suffix}`;
        const result = parseGitHubUrl(url);
        return result !== null && result.owner === owner && result.repo === repo;
      }),
      { numRuns: 300 }
    );
  });

  it("URLs without github.com always return null", () => {
    // Generate arbitrary URLs that definitely don't contain github.com
    const domain = fc.stringMatching(/^[a-z0-9-]+\.[a-z]{2,4}$/)
      .filter((d) => !d.includes("github"));

    fc.assert(
      fc.property(domain, fc.string(), (d, path) => {
        const url = `https://${d}/${path}`;
        return parseGitHubUrl(url) === null;
      }),
      { numRuns: 200 }
    );
  });
});

// --- atomicWriteJson ---

describe("atomicWriteJson properties", () => {
  let fileCounter = 0;

  it("roundtrip: JSON.parse(readFileSync(write(data))) deep-equals data for all JSON values", () => {
    const jsonArb = fc.jsonValue();

    fc.assert(
      fc.property(jsonArb, (data) => {
        const filePath = join(PROP_DIR, `rt-${fileCounter++}.json`);
        atomicWriteJson(filePath, data);
        const read = JSON.parse(readFileSync(filePath, "utf-8"));
        return JSON.stringify(read) === JSON.stringify(data);
      }),
      { numRuns: 200 }
    );
  });

  it("no .tmp file remains after write (atomic rename succeeded)", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (data) => {
        const filePath = join(PROP_DIR, `tmp-check-${fileCounter++}.json`);
        atomicWriteJson(filePath, data);
        return existsSync(filePath) && !existsSync(filePath + ".tmp");
      }),
      { numRuns: 100 }
    );
  });

  it("overwrite preserves only the latest data (no stale reads)", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (data1, data2) => {
        const filePath = join(PROP_DIR, `overwrite-${fileCounter++}.json`);
        atomicWriteJson(filePath, data1);
        atomicWriteJson(filePath, data2);
        const read = JSON.parse(readFileSync(filePath, "utf-8"));
        return JSON.stringify(read) === JSON.stringify(data2);
      }),
      { numRuns: 100 }
    );
  });
});
