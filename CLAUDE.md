# OpenUI Mobile Companion

## Architecture

Hook → Server → Client pipeline: the Claude Code status-reporter hook extracts data and POSTs to `/status-update`, the server stores it on the session object, and `/tail` (+ WebSocket broadcasts) return it to mobile clients. **Every new field needs all three links wired** — destructuring from the request body doesn't mean it's stored or returned.

Key files:
- `claude-code-plugin/hooks/status-reporter.sh` — hook that fires on Claude Code events
- `server/routes/api.ts` — `/status-update` (ingress), `/tail` (polling), `/sessions` (list)
- `server/types/index.ts` — `Session` interface (source of truth for session shape)
- `server/services/sessionManager.ts` — session lifecycle, PTY spawn, restore
- `client/src/hooks/useMobileSession.ts` — React hook that polls `/tail`

## Testing

### Requirements

- **Every PR must include tests for new/changed behavior.** No exceptions for "it's just a small change."
- **Tests must pass in CI (Ubuntu), not just locally.** Never use hardcoded local paths (`/Users/...`), macOS-specific assumptions, or rely on local state files. Use `process.cwd()`, `os.homedir()`, and temp directories.
- **Coverage must not regress.** Server ≥70% lines, client ≥70% lines. CI reports coverage in the job summary — check it.
- **Test what you can, mock what you must, skip what needs e2e.** Pure functions → unit test directly. Route handlers → use `app.request()` with mocked services. PTY spawn / WebSocket / real browser → that's e2e territory, don't force it into unit tests.

### How to run

- **Server**: `OPENUI_QUIET=1 bun test --coverage server/tests/`
- **Client**: `cd client && bunx vitest run --coverage`
- **e2e**: `cd client && bunx playwright test` (requires Chromium install)

### CI

GitHub Actions (`.github/workflows/test.yml`) runs server + client unit tests on every push/PR to main. Coverage tables render in the Actions job summary.

**Important**: `server/tests/routes-coverage.test.ts` uses `mock.module()` which poisons Bun's process-wide module cache. It runs in a separate `bun test` invocation in CI. If you add new `mock.module()` calls, they need the same isolation — add them to that file or create a new isolated step.

### Conventions

- Server: Hono's `app.request()` pattern (no HTTP server needed)
- Client: React Testing Library + Vitest, Zustand store tests with direct `getState()`/`setState()`
- Extract pure functions from components into `utils/` for direct unit testing
- Use `fast-check` for property-based tests where the domain supports it

## Git

- Remote `origin` = `samhavens/openui` (Sam's fork)
- Remote `source` = `Fallomai/openui`, `upstream` = `JJ27/openui`
- Push with `git push origin <branch>` — do NOT use `git pp` (it prefixes branch names with `sam-havens_data/` which breaks PR tracking)

## Gotchas

- Tilde paths: `~` doesn't expand in programmatic contexts. Use `homedir()` + `join()` — see `sessionManager.ts` for the pattern.
- PTY security: always use `buildPtyEnv()` for PTY spawn sites — never pass raw `process.env` (leaks secrets).
- Mobile terminal: use 10px font, keep dedicated input bar (iOS virtual keyboard needs it), WebSocket transport only.
