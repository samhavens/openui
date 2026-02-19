# Known Issues — mobile-companion-ui branch

## 1. ~~CLAUDECODE env var blocks new session launch~~ ✅ FIXED

**Was:** PTY child inherited `CLAUDECODE` from the server process, triggering Claude Code's
nested-session guard.

**Fix:** Extracted `buildPtyEnv(sessionId)` in `server/services/sessionManager.ts` which
strips `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` before passing env to both PTY spawn sites
(`createSession` and `autoResumeSessions`). 7 unit tests cover this invariant — see
`server/tests/mobile-api.test.ts` `describe("buildPtyEnv", ...)`.


---

## 2. ~~Bottom sheet content cut off on iOS / input inaccessible in full terminal~~ ✅ FIXED

**Was:** Two independent layout bugs:
1. `BottomSheet` used a JS-computed inline `maxHeight: calc(${px}px - env(safe-area-inset-bottom))`.
   `env()` in inline styles is unreliable in older Mobile Safari — content clipped.
2. `MobileLiteTerminal` root div had `h-full` inside a flex container with no `flex-1`, so
   `h-full` resolved to 100vh. The outer `overflow-hidden` clipped the input row below the fold.

**Fix:**
- `BottomSheet`: replaced inline style with CSS flexbox + `pb-safe` class on the content div
  (`flex-1 overflow-y-auto min-h-0 pb-safe`). `pb-safe` is evaluated in stylesheet context —
  reliable in all Mobile Safari versions.
- `MobileApp` terminal container: added `flex-none` to header, wrapped `MobileLiteTerminal`
  in `<div className="flex-1 min-h-0">` so its `h-full` correctly refers to remaining height.

**Regression tests:** `client/e2e/mobile-layout.test.ts` — 6 Playwright tests that measure
real element geometry in a 390×844 Chromium viewport. These tests would have caught both bugs.
Run with: `cd client && bunx playwright test`

---

## Status

Both known issues resolved. All 46 server unit tests and 6 Playwright e2e layout tests pass.
