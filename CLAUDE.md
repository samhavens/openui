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

- Runtime: Bun (`~/.bun/bin/bun` — not always on PATH)
- Run tests: `~/.bun/bin/bun test server/tests/mobile-api.test.ts`
- Convention: Hono's `app.request()` pattern (no HTTP server needed)
- Test file: `server/tests/mobile-api.test.ts`

## Git

- Remote `origin` = `samhavens/openui` (Sam's fork)
- Remote `source` = `Fallomai/openui`, `upstream` = `JJ27/openui`
- Push with `git push origin <branch>` — do NOT use `git pp` (it prefixes branch names with `sam-havens_data/` which breaks PR tracking)

## Gotchas

- Tilde paths: `~` doesn't expand in programmatic contexts. Use `homedir()` + `join()` — see `sessionManager.ts` for the pattern.
- PTY security: always use `buildPtyEnv()` for PTY spawn sites — never pass raw `process.env` (leaks secrets).
- Mobile terminal: use 10px font, keep dedicated input bar (iOS virtual keyboard needs it), WebSocket transport only.
