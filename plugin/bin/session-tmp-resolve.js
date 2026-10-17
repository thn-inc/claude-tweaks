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
// Output: one `VAR=path` line per argument, in argument order — eval-ready
// (`eval "$(node session-tmp-resolve.js ...)"`). Reads
// process.env.CLAUDE_CODE_SESSION_ID directly; no flags, no other env deps.
'use strict';
const os = require('os');
const path = require('path');
const { sessionTmpPath } = require('./lib/session-tmp');

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

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: session-tmp-resolve.js VAR=filename [VAR=filename ...]');
    process.exitCode = 1;
    return;
  }

  for (const arg of args) {
    const eq = arg.indexOf('=');
    if (eq <= 0) {
      console.error(`Invalid argument (expected VAR=filename): ${arg}`);
      process.exitCode = 1;
      return;
    }
    const varName = arg.slice(0, eq);
    const filename = arg.slice(eq + 1);
    const resolved = sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, filename) || path.join(os.tmpdir(), filename);
    const printed = formatPrintedPath(resolved);
    console.log(`${varName}=${JSON.stringify(printed)}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { formatPrintedPath };
