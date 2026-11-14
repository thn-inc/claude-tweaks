'use strict';
// In-process runner for the health-sweep CLIs' tests (#5380).
//
// `sweepCli` runs a CLI through runCliSync, with two guards against a cwd or
// --root thread-through regression reaching anything real:
// - Network transports: the ambient environment plus GIT_ALLOW_PROTOCOL=file
//   (spread last, so a caller's own env cannot restore a looser value). The
//   CLIs' durable-state code runs real `git fetch` and `git push origin`; with
//   this, any https/ssh fetch or push fails fast. Local bare-repo `file`
//   remotes, which the fixtures use, keep working.
// - The real process cwd: moved to a fresh empty throwaway directory (created per
//   call, removed afterwards) outside any repo for the duration of each call (and
//   put back afterwards). "Outside any repo" holds only while os.tmpdir() is not
//   itself inside a git repo. A CLI that
//   ignores its injected cwd then falls back to a non-repo directory, so it can
//   neither commit to a shared git ref (refs are shared by every worktree, and a
//   later push-cursor would publish them) nor write .claude-tweaks/ files into
//   whichever checkout the test happens to run from.
// `code` is mapped to `status` to match the spawnSync shape.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCliSync } = require('./run-cli');

function sweepCli(cliPath, argv, opts = {}) {
  const emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'health-sweep-cwd-'));
  const prev = process.cwd();
  process.chdir(emptyCwd);
  try {
    const res = runCliSync(cliPath, argv, {
      env: { ...process.env, ...opts.env, GIT_ALLOW_PROTOCOL: 'file' },
      cwd: opts.cwd,
      fresh: opts.fresh,
    });
    return { status: res.code, stdout: res.stdout, stderr: res.stderr };
  } finally {
    process.chdir(prev);
    // After the chdir back: Windows cannot remove the current directory.
    fs.rmSync(emptyCwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

module.exports = { sweepCli };
