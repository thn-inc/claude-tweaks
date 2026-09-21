#!/usr/bin/env node
// bin/node-eval-file.js — the `node -e` replacement for a multi-line inline
// script (#2564). On Windows Git Bash (5.x, Node 24.11, live-confirmed),
// a multi-line string passed as a `node -e "..."` CLI argument exits 0 but
// produces NO output at all — the argument is silently swallowed before it
// ever reaches Node. A single-line `node -e "console.log('a')"` prints
// fine; the identical two-line form does not. Every downstream step that
// reads the (never-written) output then fails with `unbound variable` or
// `Unexpected end of JSON input` — a silent no-op, not a loud failure, at
// the point of the actual defect.
//
// The verified fix: multi-line JS handed to Node as a real FILE has no such
// limitation on any shell — only the inline-argument form is affected. This
// wrapper reads the JS source from stdin (never argv — arbitrarily complex
// source containing quotes/backticks/newlines needs no shell-quoting
// gymnastics that way), writes it to a temp `.cjs` file, and execs
// `node <file> <args...>` on it — forwarding stdout/stderr/exit code
// unchanged, so a call site swaps `node -e "<code>" <args...> <<'EOF' ...
// EOF'` for what was previously `node -e "\n<code>\n" <args...>` and
// nothing else about the surrounding shell changes.
//
// Argv positions are preserved exactly as the replaced `node -e` form had
// them: `node -e "<code>" a b` sets `process.argv` to `[node, a, b]` (no
// script-path entry — `-e` has no file); running the same source as a real
// file sets `process.argv` to `[node, <tmpfile>, a, b]` — one extra entry
// at index 1. `process.argv.splice(1, 1)` is prepended to the written
// source specifically to remove that injected entry, so every `process.
// argv[N]` reference inside the original block's JS needs no renumbering.
//
// Usage: node bin/node-eval-file.js [<arg> ...] < script.js
// Exit code: whatever the evaluated script itself exits with (or 1 if the
// child process could not be spawned/signaled at all).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { sessionTmpPath } = require('./lib/session-tmp');

// -> a fresh temp .cjs path for this invocation, session-scoped when a
// session id is resolvable (the same convention every other skill-temp file
// in this plugin already follows — session-tmp-root.md), falling back to a
// bare OS-tmpdir path (still unique per invocation) when it is not.
function tempScriptPath() {
  const name = `node-eval-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`;
  return sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, name) || path.join(os.tmpdir(), name);
}

// (source, args, deps) -> the child process's exit code (never throws —
// spawn/read/write failures are reported on stderr and degrade to exit 1,
// matching this file's own "loud, attributable error, never a silent
// no-op" mandate, AC5). All I/O through deps so tests never touch the real
// filesystem or spawn a real node process (gh-api-module-pattern's
// injectable-runner convention).
function run(source, args, deps) {
  let tmpFile;
  try {
    tmpFile = deps.tempScriptPath();
    deps.writeFileSync(tmpFile, `process.argv.splice(1, 1);\n${source}`);
  } catch (err) {
    deps.stderr(`node-eval-file.js: could not write temp script: ${err && err.message ? err.message : err}\n`);
    return 1;
  }
  let result;
  try {
    result = deps.spawnSync(process.execPath, [tmpFile, ...args], { stdio: 'inherit' });
  } finally {
    try { deps.unlinkSync(tmpFile); } catch { /* best-effort cleanup, never fatal */ }
  }
  if (result.error) {
    deps.stderr(`node-eval-file.js: failed to run temp script: ${result.error.message}\n`);
    return 1;
  }
  if (typeof result.status === 'number') return result.status;
  // Killed by a signal rather than exiting normally — no numeric status to
  // propagate; report loudly rather than silently returning 0.
  deps.stderr(`node-eval-file.js: temp script terminated by signal ${result.signal}\n`);
  return 1;
}

const realDeps = {
  tempScriptPath,
  writeFileSync: (p, s) => fs.writeFileSync(p, s, 'utf8'),
  unlinkSync: (p) => fs.unlinkSync(p),
  spawnSync,
  stderr: (s) => process.stderr.write(s),
};

if (require.main === module) {
  const source = fs.readFileSync(0, 'utf8');
  process.exitCode = run(source, process.argv.slice(2), realDeps);
}

module.exports = { run, tempScriptPath, realDeps };
