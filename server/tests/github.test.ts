import { describe, it, expect, afterEach } from "bun:test";
import {
  parseGitHubUrl,
  fetchGitHubIssues,
  fetchGitHubIssue,
  searchGitHubIssues,
} from "../services/github";

// --- Helpers: mock globalThis.fetch ---

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = handler as any;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// --- parseGitHubUrl (pure) ---

describe("parseGitHubUrl", () => {
  it("parses standard github.com URL", () => {
    expect(parseGitHubUrl("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("strips .git suffix", () => {
    expect(parseGitHubUrl("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("handles trailing path segments", () => {
    expect(parseGitHubUrl("https://github.com/owner/repo/issues/42")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("handles SSH-style URLs with github.com", () => {
    // The regex looks for github.com/ so SSH git@github.com:owner/repo won't match
    expect(parseGitHubUrl("git@github.com:owner/repo")).toBeNull();
  });

  it("returns null for non-GitHub URLs", () => {
    expect(parseGitHubUrl("https://gitlab.com/owner/repo")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseGitHubUrl("")).toBeNull();
  });

  it("returns null for random text", () => {
    expect(parseGitHubUrl("not a url at all")).toBeNull();
  });
});

// --- fetchGitHubIssues ---

const MOCK_ISSUES_RESPONSE = [
  {
    id: 1,
    number: 10,
    title: "Bug report",
    html_url: "https://github.com/o/r/issues/10",
    state: "open",
    labels: [{ name: "bug", color: "d73a4a" }],
    assignee: { login: "alice" },
    created_at: "2024-01-01T00:00:00Z",
  },
  {
    id: 2,
    number: 11,
    title: "Pull request (should be filtered)",
    html_url: "https://github.com/o/r/pull/11",
    state: "open",
    labels: [],
    assignee: null,
    created_at: "2024-01-02T00:00:00Z",
    pull_request: { url: "..." },
  },
];

describe("fetchGitHubIssues", () => {
  it("returns issues and filters out pull requests", async () => {
    mockFetch(() => new Response(JSON.stringify(MOCK_ISSUES_RESPONSE), { status: 200 }));

    const issues = await fetchGitHubIssues("o", "r");
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(10);
    expect(issues[0].title).toBe("Bug report");
    expect(issues[0].labels).toEqual([{ name: "bug", color: "d73a4a" }]);
    expect(issues[0].assignee).toEqual({ login: "alice" });
  });

  it("throws on non-200 response", async () => {
    mockFetch(() => new Response("rate limited", { status: 403 }));

    await expect(fetchGitHubIssues("o", "r")).rejects.toThrow("GitHub API error: 403");
  });

  it("sends correct headers", async () => {
    let capturedHeaders: Record<string, string> = {};
    mockFetch((url, init) => {
      capturedHeaders = Object.fromEntries(
        Object.entries(init?.headers || {})
      );
      return new Response(JSON.stringify([]), { status: 200 });
    });

    await fetchGitHubIssues("o", "r");
    expect(capturedHeaders["Accept"]).toBe("application/vnd.github.v3+json");
    expect(capturedHeaders["User-Agent"]).toBe("OpenUI-Agent-Manager");
  });

  it("passes state parameter in URL", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return new Response(JSON.stringify([]), { status: 200 });
    });

    await fetchGitHubIssues("o", "r", "closed");
    expect(capturedUrl).toContain("state=closed");
  });
});

// --- fetchGitHubIssue ---

const MOCK_SINGLE_ISSUE = {
  id: 1,
  number: 42,
  title: "Feature request",
  html_url: "https://github.com/o/r/issues/42",
  state: "open",
  labels: [],
  assignee: null,
  created_at: "2024-01-01T00:00:00Z",
};

describe("fetchGitHubIssue", () => {
  it("returns issue on 200", async () => {
    mockFetch(() => new Response(JSON.stringify(MOCK_SINGLE_ISSUE), { status: 200 }));

    const issue = await fetchGitHubIssue("o", "r", 42);
    expect(issue).not.toBeNull();
    expect(issue!.number).toBe(42);
    expect(issue!.title).toBe("Feature request");
  });

  it("returns null on 404", async () => {
    mockFetch(() => new Response("not found", { status: 404 }));

    const issue = await fetchGitHubIssue("o", "r", 999);
    expect(issue).toBeNull();
  });

  it("throws on other errors", async () => {
    mockFetch(() => new Response("server error", { status: 500 }));

    await expect(fetchGitHubIssue("o", "r", 42)).rejects.toThrow("GitHub API error: 500");
  });
});

// --- searchGitHubIssues ---

describe("searchGitHubIssues", () => {
  it("returns mapped issues from search API", async () => {
    mockFetch(() =>
      new Response(
        JSON.stringify({
          items: [MOCK_SINGLE_ISSUE],
        }),
        { status: 200 }
      )
    );

    const results = await searchGitHubIssues("o", "r", "feature");
    expect(results).toHaveLength(1);
    expect(results[0].number).toBe(42);
  });

  it("encodes query in URL", async () => {
    let capturedUrl = "";
    mockFetch((url) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });

    await searchGitHubIssues("o", "r", "has spaces & special=chars");
    expect(capturedUrl).toContain(encodeURIComponent("has spaces & special=chars"));
  });

  it("throws on error response", async () => {
    mockFetch(() => new Response("error", { status: 422 }));

    await expect(searchGitHubIssues("o", "r", "q")).rejects.toThrow("GitHub API error: 422");
  });
});
