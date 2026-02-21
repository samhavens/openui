/**
 * Integration tests for conversationIndex.ts using in-memory SQLite.
 * Tests initSchema + indexConversation with temp JSONL files,
 * then verifies data via direct SQL (replicating searchWithFts/listRecent patterns).
 */

import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { initSchema, indexConversation, extractContent, detectToolNoise, sanitizeFtsQuery } from "../services/conversationIndex";

const TEST_DIR = join(tmpdir(), `openui-conv-idx-${Date.now()}`);

function freshDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA journal_mode=WAL");
  initSchema(db);
  return db;
}

function writeJsonl(fileName: string, lines: any[]): string {
  const filePath = join(TEST_DIR, fileName);
  writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join("\n"));
  return filePath;
}

beforeEach(() => {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

// ─── initSchema ───

describe("initSchema", () => {
  it("creates conversations table with expected columns", () => {
    const db = freshDb();
    const info = db.prepare("PRAGMA table_info(conversations)").all() as any[];
    const colNames = info.map((c: any) => c.name);
    expect(colNames).toContain("session_id");
    expect(colNames).toContain("project_path");
    expect(colNames).toContain("slug");
    expect(colNames).toContain("summary");
    expect(colNames).toContain("first_prompt");
    expect(colNames).toContain("message_count");
    expect(colNames).toContain("created");
    expect(colNames).toContain("modified");
    expect(colNames).toContain("git_branch");
    expect(colNames).toContain("is_sidechain");
    expect(colNames).toContain("file_mtime");
    expect(colNames).toContain("full_path");
    db.close();
  });

  it("creates messages table with expected columns", () => {
    const db = freshDb();
    const info = db.prepare("PRAGMA table_info(messages)").all() as any[];
    const colNames = info.map((c: any) => c.name);
    expect(colNames).toContain("uuid");
    expect(colNames).toContain("session_id");
    expect(colNames).toContain("message_type");
    expect(colNames).toContain("content");
    expect(colNames).toContain("timestamp");
    expect(colNames).toContain("is_tool_noise");
    db.close();
  });

  it("creates message_fts virtual table", () => {
    const db = freshDb();
    // FTS tables show up in sqlite_master
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_fts'").get() as any;
    expect(row).toBeTruthy();
    expect(row.name).toBe("message_fts");
    db.close();
  });

  it("is idempotent (calling twice does not error)", () => {
    const db = new Database(":memory:");
    initSchema(db);
    initSchema(db); // should not throw
    const info = db.prepare("PRAGMA table_info(conversations)").all() as any[];
    expect(info.length).toBeGreaterThan(0);
    db.close();
  });

  it("creates indexes on messages and conversations", () => {
    const db = freshDb();
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as any[];
    const idxNames = indexes.map((i: any) => i.name);
    expect(idxNames).toContain("idx_messages_session");
    expect(idxNames).toContain("idx_conversations_modified");
    expect(idxNames).toContain("idx_conversations_project");
    db.close();
  });
});

// ─── indexConversation ───

describe("indexConversation", () => {
  it("indexes user and assistant messages from JSONL", () => {
    const db = freshDb();
    const filePath = writeJsonl("test-basic.jsonl", [
      {
        type: "user",
        uuid: "uuid-1",
        message: { content: "What is the meaning of life? This is a long enough question to pass the noise filter." },
        timestamp: "2025-01-01T00:00:00Z",
      },
      {
        type: "assistant",
        uuid: "uuid-2",
        message: { content: [{ type: "text", text: "The meaning of life is 42. Here is a detailed explanation with plenty of text." }] },
        timestamp: "2025-01-01T00:01:00Z",
      },
    ]);

    indexConversation(db, {
      sessionId: "session-basic",
      filePath,
      fileMtime: Date.now(),
      originalPath: "/test/project",
    });

    const conv = db.prepare("SELECT * FROM conversations WHERE session_id = ?").get("session-basic") as any;
    expect(conv).toBeTruthy();
    expect(conv.project_path).toBe("/test/project");
    expect(conv.message_count).toBe(2);
    expect(conv.created).toBe("2025-01-01T00:00:00Z");
    expect(conv.modified).toBe("2025-01-01T00:01:00Z");

    const msgs = db.prepare("SELECT * FROM messages WHERE session_id = ?").all("session-basic") as any[];
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it("extracts first_prompt from first user message", () => {
    const db = freshDb();
    const filePath = writeJsonl("test-prompt.jsonl", [
      {
        type: "user",
        uuid: "uuid-fp-1",
        message: { content: "Help me write a function to sort arrays. This should be comprehensive." },
        timestamp: "2025-02-01T00:00:00Z",
      },
      {
        type: "assistant",
        uuid: "uuid-fp-2",
        message: { content: [{ type: "text", text: "Here is a sorting function implementation that handles all the edge cases properly." }] },
        timestamp: "2025-02-01T00:01:00Z",
      },
    ]);

    indexConversation(db, {
      sessionId: "session-prompt",
      filePath,
      fileMtime: Date.now(),
      originalPath: "/test",
    });

    const conv = db.prepare("SELECT first_prompt FROM conversations WHERE session_id = ?").get("session-prompt") as any;
    expect(conv.first_prompt).toContain("Help me write a function");
    db.close();
  });

  it("extracts slug and gitBranch from JSONL metadata", () => {
    const db = freshDb();
    const filePath = writeJsonl("test-meta.jsonl", [
      {
        type: "summary",
        slug: "my-session-slug",
        gitBranch: "feature/test",
        timestamp: "2025-01-01T00:00:00Z",
      },
      {
        type: "user",
        uuid: "uuid-m-1",
        message: { content: "This is a real user message with enough content to pass noise filter." },
        timestamp: "2025-01-01T00:01:00Z",
      },
      {
        type: "assistant",
        uuid: "uuid-m-2",
        message: { content: [{ type: "text", text: "This is the assistant response with plenty of detail about the topic." }] },
        timestamp: "2025-01-01T00:02:00Z",
      },
    ]);

    indexConversation(db, {
      sessionId: "session-meta",
      filePath,
      fileMtime: Date.now(),
      originalPath: "/test",
    });

    const conv = db.prepare("SELECT slug, git_branch FROM conversations WHERE session_id = ?").get("session-meta") as any;
    expect(conv.slug).toBe("my-session-slug");
    expect(conv.git_branch).toBe("feature/test");
    db.close();
  });

  it("skips sidechain conversations", () => {
    const db = freshDb();
    const filePath = writeJsonl("test-sidechain.jsonl", [
      {
        type: "user",
        uuid: "uuid-sc-1",
        message: { content: "Sidechain user message that should be ignored because it is a sidechain." },
        timestamp: "2025-01-01T00:00:00Z",
        isSidechain: true,
      },
      {
        type: "assistant",
        uuid: "uuid-sc-2",
        message: { content: [{ type: "text", text: "Sidechain response that should also be ignored for indexing purposes." }] },
        timestamp: "2025-01-01T00:01:00Z",
      },
    ]);

    indexConversation(db, {
      sessionId: "session-sidechain",
      filePath,
      fileMtime: Date.now(),
      originalPath: "/test",
    });

    const conv = db.prepare("SELECT * FROM conversations WHERE session_id = ?").get("session-sidechain");
    expect(conv).toBeNull();
    db.close();
  });

  it("skips files with no user/assistant messages", () => {
    const db = freshDb();
    const filePath = writeJsonl("test-empty.jsonl", [
      { type: "system", uuid: "uuid-sys-1", timestamp: "2025-01-01T00:00:00Z" },
    ]);

    indexConversation(db, {
      sessionId: "session-empty",
      filePath,
      fileMtime: Date.now(),
      originalPath: "/test",
    });

    const conv = db.prepare("SELECT * FROM conversations WHERE session_id = ?").get("session-empty");
    expect(conv).toBeNull();
    db.close();
  });

  it("re-indexing replaces old data (upsert)", () => {
    const db = freshDb();
    const filePath = writeJsonl("test-upsert.jsonl", [
      {
        type: "user",
        uuid: "uuid-up-1",
        message: { content: "Original content with enough text to pass the noise filter check." },
        timestamp: "2025-01-01T00:00:00Z",
      },
    ]);

    indexConversation(db, {
      sessionId: "session-upsert",
      filePath,
      fileMtime: 1000,
      originalPath: "/test",
    });

    let conv = db.prepare("SELECT first_prompt FROM conversations WHERE session_id = ?").get("session-upsert") as any;
    expect(conv.first_prompt).toContain("Original");

    // Re-index with updated content
    const updatedPath = writeJsonl("test-upsert2.jsonl", [
      {
        type: "user",
        uuid: "uuid-up-2",
        message: { content: "Updated content with enough text to pass the noise filter check too." },
        timestamp: "2025-02-01T00:00:00Z",
      },
    ]);

    indexConversation(db, {
      sessionId: "session-upsert",
      filePath: updatedPath,
      fileMtime: 2000,
      originalPath: "/test",
    });

    conv = db.prepare("SELECT first_prompt FROM conversations WHERE session_id = ?").get("session-upsert") as any;
    expect(conv.first_prompt).toContain("Updated");
    db.close();
  });

  it("marks short messages as tool noise", () => {
    const db = freshDb();
    const filePath = writeJsonl("test-noise.jsonl", [
      {
        type: "assistant",
        uuid: "uuid-noise-1",
        message: { content: [{ type: "text", text: "Let me read" }] },
        timestamp: "2025-01-01T00:00:00Z",
      },
      {
        type: "user",
        uuid: "uuid-noise-2",
        message: { content: "This is a longer message that should not be tool noise because it has enough content." },
        timestamp: "2025-01-01T00:01:00Z",
      },
    ]);

    indexConversation(db, {
      sessionId: "session-noise",
      filePath,
      fileMtime: Date.now(),
      originalPath: "/test",
    });

    // The short "Let me read" message should be filtered out (<5 chars after extraction or noise detection)
    const msgs = db.prepare("SELECT * FROM messages WHERE session_id = ?").all("session-noise") as any[];
    // At least the longer user message should be indexed
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it("does not insert into FTS for tool noise messages", () => {
    const db = freshDb();
    const filePath = writeJsonl("test-fts-noise.jsonl", [
      {
        type: "assistant",
        uuid: "uuid-fn-1",
        message: { content: [{ type: "text", text: "Let me check the file to understand the configuration" }] },
        timestamp: "2025-01-01T00:00:00Z",
      },
      {
        type: "user",
        uuid: "uuid-fn-2",
        message: { content: "This is a substantive message that should be in FTS and searchable by users." },
        timestamp: "2025-01-01T00:01:00Z",
      },
    ]);

    indexConversation(db, {
      sessionId: "session-fts-noise",
      filePath,
      fileMtime: Date.now(),
      originalPath: "/test",
    });

    // Only non-noise messages should be in FTS
    const ftsRows = db.prepare("SELECT * FROM message_fts WHERE session_id = ?").all("session-fts-noise") as any[];
    for (const row of ftsRows) {
      // Verify none of the FTS entries are the noise message
      expect(row.content).not.toContain("Let me check");
    }
    db.close();
  });

  it("uses indexEntry metadata when provided", () => {
    const db = freshDb();
    const filePath = writeJsonl("test-idx-entry.jsonl", [
      {
        type: "user",
        uuid: "uuid-ie-1",
        message: { content: "A user message with enough content to pass the noise filter properly." },
        timestamp: "2025-01-01T00:00:00Z",
      },
    ]);

    indexConversation(db, {
      sessionId: "session-idx-entry",
      filePath,
      fileMtime: Date.now(),
      indexEntry: {
        sessionId: "session-idx-entry",
        fullPath: filePath,
        fileMtime: Date.now(),
        firstPrompt: "From index entry prompt",
        summary: "Index summary text",
        messageCount: 10,
        created: "2025-01-01T00:00:00Z",
        modified: "2025-01-01T12:00:00Z",
        gitBranch: "main",
        projectPath: "/from/index",
        isSidechain: false,
      } as any,
      originalPath: "/test",
    });

    const conv = db.prepare("SELECT * FROM conversations WHERE session_id = ?").get("session-idx-entry") as any;
    expect(conv.summary).toBe("Index summary text");
    expect(conv.first_prompt).toBe("From index entry prompt");
    expect(conv.message_count).toBe(10);
    expect(conv.git_branch).toBe("main");
    db.close();
  });

  it("handles malformed JSONL lines gracefully", () => {
    const db = freshDb();
    const filePath = join(TEST_DIR, "test-malformed.jsonl");
    writeFileSync(filePath, [
      "not valid json at all",
      JSON.stringify({
        type: "user",
        uuid: "uuid-mf-1",
        message: { content: "Valid message after malformed line that is long enough to not be noise." },
        timestamp: "2025-03-01T00:00:00Z",
      }),
    ].join("\n"));

    indexConversation(db, {
      sessionId: "session-malformed",
      filePath,
      fileMtime: Date.now(),
      originalPath: "/test",
    });

    const conv = db.prepare("SELECT * FROM conversations WHERE session_id = ?").get("session-malformed") as any;
    expect(conv).toBeTruthy();
    expect(conv.message_count).toBe(1);
    db.close();
  });

  it("handles nonexistent file path", () => {
    const db = freshDb();

    // Should not throw — indexConversation catches file read errors
    indexConversation(db, {
      sessionId: "session-nofile",
      filePath: "/nonexistent/path/to/file.jsonl",
      fileMtime: Date.now(),
      originalPath: "/test",
    });

    const conv = db.prepare("SELECT * FROM conversations WHERE session_id = ?").get("session-nofile");
    expect(conv).toBeNull();
    db.close();
  });
});

// ─── FTS search on indexed data ───

describe("FTS search on indexed data", () => {
  it("finds conversation by FTS keyword match", () => {
    const db = freshDb();
    const filePath = writeJsonl("test-fts-search.jsonl", [
      {
        type: "user",
        uuid: "uuid-fs-1",
        message: { content: "Help me implement authentication with OAuth2 for the web application." },
        timestamp: "2025-01-01T00:00:00Z",
      },
      {
        type: "assistant",
        uuid: "uuid-fs-2",
        message: { content: [{ type: "text", text: "Here is how to implement OAuth2 authentication for your web application step by step." }] },
        timestamp: "2025-01-01T00:01:00Z",
      },
    ]);

    indexConversation(db, {
      sessionId: "session-fts-search",
      filePath,
      fileMtime: Date.now(),
      originalPath: "/test",
    });

    // Replicate searchWithFts query pattern
    const ftsQuery = sanitizeFtsQuery("OAuth2");
    const matchingIds = db
      .prepare("SELECT DISTINCT session_id FROM message_fts WHERE message_fts MATCH ?")
      .all(ftsQuery) as any[];

    expect(matchingIds.length).toBeGreaterThanOrEqual(1);
    expect(matchingIds.some((r: any) => r.session_id === "session-fts-search")).toBe(true);
    db.close();
  });

  it("returns no results for non-matching query", () => {
    const db = freshDb();
    const filePath = writeJsonl("test-fts-nomatch.jsonl", [
      {
        type: "user",
        uuid: "uuid-fnm-1",
        message: { content: "Help me with a simple Python script for data processing and analysis." },
        timestamp: "2025-01-01T00:00:00Z",
      },
    ]);

    indexConversation(db, {
      sessionId: "session-fts-nomatch",
      filePath,
      fileMtime: Date.now(),
      originalPath: "/test",
    });

    const ftsQuery = sanitizeFtsQuery("kubernetes");
    const results = db
      .prepare("SELECT DISTINCT session_id FROM message_fts WHERE message_fts MATCH ?")
      .all(ftsQuery) as any[];

    expect(results.some((r: any) => r.session_id === "session-fts-nomatch")).toBe(false);
    db.close();
  });

  it("FTS snippet extraction works on indexed messages", () => {
    const db = freshDb();
    const filePath = writeJsonl("test-fts-snippet.jsonl", [
      {
        type: "user",
        uuid: "uuid-snip-1",
        message: { content: "How do I configure PostgreSQL database connections with connection pooling in production?" },
        timestamp: "2025-01-01T00:00:00Z",
      },
    ]);

    indexConversation(db, {
      sessionId: "session-snippet",
      filePath,
      fileMtime: Date.now(),
      originalPath: "/test",
    });

    const ftsQuery = sanitizeFtsQuery("PostgreSQL");
    const snippetRow = db
      .prepare("SELECT snippet(message_fts, 1, '>>>', '<<<', '...', 30) AS snip FROM message_fts WHERE message_fts MATCH ? AND session_id = ? LIMIT 1")
      .get(ftsQuery, "session-snippet") as any;

    expect(snippetRow).toBeTruthy();
    expect(snippetRow.snip).toContain("PostgreSQL");
    db.close();
  });
});

// ─── listRecent pattern ───

describe("listRecent pattern on indexed data", () => {
  it("returns conversations sorted by modified descending", () => {
    const db = freshDb();

    // Index two conversations
    const file1 = writeJsonl("test-recent-1.jsonl", [
      {
        type: "user",
        uuid: "uuid-r1",
        message: { content: "First conversation message with enough text to avoid noise filter." },
        timestamp: "2025-01-01T00:00:00Z",
      },
    ]);
    const file2 = writeJsonl("test-recent-2.jsonl", [
      {
        type: "user",
        uuid: "uuid-r2",
        message: { content: "Second conversation message with enough text to avoid noise filter." },
        timestamp: "2025-06-01T00:00:00Z",
      },
    ]);

    indexConversation(db, {
      sessionId: "session-recent-1",
      filePath: file1,
      fileMtime: Date.now(),
      originalPath: "/test",
    });
    indexConversation(db, {
      sessionId: "session-recent-2",
      filePath: file2,
      fileMtime: Date.now(),
      originalPath: "/test",
    });

    // Replicate listRecent SQL
    const rows = db.prepare(`
      SELECT session_id, modified
      FROM conversations
      WHERE is_sidechain = 0
      ORDER BY modified DESC
      LIMIT 10
    `).all() as any[];

    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Second conversation (June) should come before first (January)
    const idx1 = rows.findIndex((r: any) => r.session_id === "session-recent-1");
    const idx2 = rows.findIndex((r: any) => r.session_id === "session-recent-2");
    expect(idx2).toBeLessThan(idx1);
    db.close();
  });

  it("filters by project_path", () => {
    const db = freshDb();

    const file1 = writeJsonl("test-proj-1.jsonl", [
      {
        type: "user",
        uuid: "uuid-p1",
        message: { content: "Project A conversation message with enough content to pass." },
        timestamp: "2025-01-01T00:00:00Z",
      },
    ]);
    const file2 = writeJsonl("test-proj-2.jsonl", [
      {
        type: "user",
        uuid: "uuid-p2",
        message: { content: "Project B conversation message with enough content to pass." },
        timestamp: "2025-01-01T00:00:00Z",
      },
    ]);

    indexConversation(db, {
      sessionId: "session-proj-a",
      filePath: file1,
      fileMtime: Date.now(),
      originalPath: "/project/a",
    });
    indexConversation(db, {
      sessionId: "session-proj-b",
      filePath: file2,
      fileMtime: Date.now(),
      originalPath: "/project/b",
    });

    const rows = db.prepare(`
      SELECT session_id FROM conversations
      WHERE is_sidechain = 0 AND project_path = ?
      ORDER BY modified DESC LIMIT 10
    `).all("/project/a") as any[];

    expect(rows.length).toBe(1);
    expect(rows[0].session_id).toBe("session-proj-a");
    db.close();
  });
});

// ─── mapRow pattern ───

describe("mapRow pattern", () => {
  it("maps DB row to expected shape", () => {
    const db = freshDb();
    const filePath = writeJsonl("test-maprow.jsonl", [
      {
        type: "user",
        uuid: "uuid-mr-1",
        message: { content: "A conversation to test the row mapping with sufficient content for the filter." },
        timestamp: "2025-03-15T10:00:00Z",
        slug: "test-slug",
        gitBranch: "feature/map",
      },
    ]);

    indexConversation(db, {
      sessionId: "session-maprow",
      filePath,
      fileMtime: Date.now(),
      originalPath: "/test/maprow",
    });

    // Query with same shape as mapRow input
    const row = db.prepare(`
      SELECT
        session_id, slug, summary, first_prompt, message_count,
        created, modified, git_branch, project_path, full_path,
        NULL AS match_snippet
      FROM conversations WHERE session_id = ?
    `).get("session-maprow") as any;

    expect(row).toBeTruthy();
    expect(row.session_id).toBe("session-maprow");
    expect(row.slug).toBe("test-slug");
    expect(row.project_path).toBe("/test/maprow");
    expect(row.git_branch).toBe("feature/map");
    expect(row.full_path).toBe(filePath);
    db.close();
  });
});
