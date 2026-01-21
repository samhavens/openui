#!/usr/bin/env bun

import { $ } from "bun";

const PORT = process.env.PORT || 6969;
const LAUNCH_CWD = process.cwd(); // Capture where user ran openui from

console.log(`
\x1b[38;5;251m  ┌─────────────────────────────────────┐
  │                                     │
  │   \x1b[38;5;141m○\x1b[38;5;251m  \x1b[1mOpenUI\x1b[0m\x1b[38;5;251m                         │
  │      \x1b[38;5;245mAI Agent Canvas\x1b[38;5;251m               │
  │                                     │
  └─────────────────────────────────────┘\x1b[0m
`);

console.log(`\x1b[38;5;245m  Directory:\x1b[0m ${LAUNCH_CWD}`);
console.log(`\x1b[38;5;245m  Server:\x1b[0m    \x1b[38;5;141mhttp://localhost:${PORT}\x1b[0m`);
console.log(`\x1b[38;5;245m  Press\x1b[0m     \x1b[38;5;245mCtrl+C to stop\x1b[0m\n`);

// Start the server with LAUNCH_CWD env var
const server = Bun.spawn(["bun", "run", "server/index.ts"], {
  cwd: import.meta.dir + "/..",
  stdio: ["inherit", "inherit", "inherit"],
  env: { ...process.env, PORT: String(PORT), LAUNCH_CWD }
});

// Open browser
setTimeout(async () => {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  await $`${cmd} http://localhost:${PORT}`.quiet();
}, 1500);

process.on("SIGINT", () => {
  server.kill();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.kill();
  process.exit(0);
});

await server.exited;
