#!/usr/bin/env node
// bin/session-tmp-resolve.js
//
// Thin CLI wrapper over lib/session-tmp.js#sessionTmpPath, for skill
// snippets that need several session-scoped temp paths in one bash fence
// without inlining the same `node -e "..."` resolution boilerplate per
// call site (#266 shipped that inline form first; this is the byte-cheaper
// follow-up for files pushed near the then-40 KB skill-file ceiling by it).
//
// Usage: session-tmp-resolve.js VAR=filename [VAR=filename ...]
//        session-tmp-resolve.js --value filename
// Output: the VAR= form prints one `VAR="path"` line per argument, in argument
// order (evaluable shell assignments); `--value` prints exactly the one resolved
// path plus a newline, for a per-variable `VAR="$(node … --value file)"`
// substitution — the eval-free multi-path form, since the worktree guard refuses
// `eval` (`_shared/scratch-worktree.md` §7, #4028). The two forms do not mix.
// Reads CLAUDE_CODE_SESSION_ID and the temp directory (TMPDIR/TMP/TEMP) from `deps.env`; no other env deps.
'use strict';
const path = require('path');
const { sessionTmpPath, envTmpdir } = require('./lib/session-tmp');

// Print-only: on win32 emit forward slashes (`C:/Users/…`). The value is interpolated by skill
// snippets into JS string literals inside `node -e "…"`, where `C:\Users\…` would be read as
// escape sequences (`\U`, `\t`). Node, Git Bash and the Windows fs APIs all accept `/`; the
// library's return value stays native. Posix output is unchanged. `platform`/`sep` are
// injectable (default to the real `process.platform`/`path.sep`) so a test can pin the win32
// branch's behavior on any OS, mirroring `lib/atomic-write.js`'s `platform = process.platform`
// convention.
function formatPrintedPath(resolved, { platform = process.platform, sep = path.sep } = {}) {
  return platform === 'win32' ? resolved.split(sep).join('/') : resolved;
}

const USAGE = 'Usage: session-tmp-resolve.js VAR=filename [VAR=filename ...] | --value filename';

function resolvePrinted(filename, { env = process.env } = {}) {
  const tmpdir = envTmpdir(env);
  const resolved = sessionTmpPath(env.CLAUDE_CODE_SESSION_ID, filename, { tmpdir }) || path.join(tmpdir, filename);
  return formatPrintedPath(resolved);
}

function run(argv, deps = {}) {
  const d = { ...realDeps, ...deps };
  const out = (line) => d.stdout(line + '\n');
  const err = (line) => d.stderr(line + '\n');
  const env = d.env;
  if (argv.length === 0) {
    err(USAGE);
    return 1;
  }

  if (argv.includes('--value')) {
    // Exactly `--value <filename>`: no missing operand, no VAR= pairs mixed in.
    if (argv.length !== 2 || argv[0] !== '--value' || argv[1].includes('=') || argv[1] === '') {
      err(USAGE);
      return 1;
    }
    out(resolvePrinted(argv[1], { env }));
    return 0;
  }

  for (const arg of argv) {
    const eq = arg.indexOf('=');
    if (eq <= 0) {
      err(`Invalid argument (expected VAR=filename): ${arg}`);
      return 1;
    }
    const varName = arg.slice(0, eq);
    const filename = arg.slice(eq + 1);
    out(`${varName}=${JSON.stringify(resolvePrinted(filename, { env }))}`);
  }
  return 0;
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  get env() { return process.env; },
};

module.exports = { run, realDeps, formatPrintedPath, resolvePrinted };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
