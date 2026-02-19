# Known Issues — mobile-companion-ui branch

## 1. CLAUDECODE env var blocks new session launch

**Symptom:**
```
bash-3.2$ claude --plugin-dir /Users/.../.openui/claude-code-plugin
Error: Claude Code cannot be launched inside another Claude Code session.
Nested sessions share runtime resources and will crash all active sessions.
To bypass this check, unset the CLAUDECODE environment variable.
```

**Root cause:** The server process runs inside a Claude Code session (the one that launched
OpenUI). When a new PTY is spawned via `createSession`, it inherits the parent's env including
`CLAUDECODE`. Claude Code's startup check sees this and refuses to launch.

**Fix needed:** Unset `CLAUDECODE` (and possibly `CLAUDE_*`) from the env passed to the PTY
in `server/services/sessionManager.ts` (~line 200):
```typescript
const { CLAUDECODE, ...cleanEnv } = process.env;
env: { ...cleanEnv, TERM: "xterm-256color", ... }
```

---

## 2. Bottom sheet content cut off on iOS / input inaccessible in full terminal

**Symptom:**
- Session detail bottom sheet: bottom portion of content (macros, input, notes) clipped
- Full terminal view: input field not reachable, appears below viewport

**Root cause:** `BottomSheet` computes `maxHeight` using `window.innerHeight` which in
Mobile Safari includes the safe-area zones (notch + home indicator). Content renders
under the home indicator bar. The `calc(Npx - env(safe-area-inset-bottom))` fix applied
to `maxHeight` may not be taking effect because:
- `env()` in CSS `calc()` via inline `style=` attribute may not be evaluated correctly
  in all Mobile Safari versions
- The full terminal (`MobileLiteTerminal`) doesn't use BottomSheet and has its own
  height/layout that independently clips the input

**Fix needed:**
- BottomSheet: switch from inline style to a CSS custom property or Tailwind `pb-safe`
  class on the content wrapper; verify with device testing
- MobileLiteTerminal: audit the flex layout for the input row; add
  `padding-bottom: env(safe-area-inset-bottom)` to the input container

---

## Status

Both issues block basic mobile usability. Fix #1 first (nothing works without it).
