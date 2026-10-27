'use strict';
// Shared PATH stand-in helpers for tests that fake or narrow `git`/`gh` (#4285).
//
// Many tests write a `#!/bin/sh` script named `git` or `gh` into a temp dir,
// prepend that dir to PATH, and let the code under test spawn it. On a
// Windows checkout that stub never resolves: libuv's PATH search tries only
// the bare `name`, `name.com` and `name.exe` — never PATHEXT's `.bat`/`.cmd`
// — and a `.cmd` shim spawned without a shell is refused with EINVAL
// (Node's CVE-2024-27980 hardening). The real `git.exe` further down PATH
// answers instead, so the test asserts against the wrong process.
//
// Converting such a test would mean either a shell-mode spawn in production
// code (a behavior change made only for tests) or a compiled .exe stub, so a
// stub test skips on win32 instead: STUB_SKIP is node:test's `skip` value —
// false off win32 (never skipped), STUB_SKIP_REASON on win32 — an explicit
// skip that the TAP output names, never a silent early `return`.
// installStub(name, script) is the shared way such a test installs its stub,
// and its restore() removes the stub dir and only its own PATH entry, so
// stubs can be restored in any order (an unset PATH is unset again).
//
// pathWithOnly(names, { exclude }) serves the other shape: a test that needs
// a PATH holding a real binary (e.g. `git`) but not another (e.g. `gh`). The
// old way symlinked the binary into a temp dir, which needs a privilege on
// Windows; pathWithOnly uses the binary's own directory when that directory
// holds no excluded name — so the test keeps running on Windows — and falls
// back to a symlink dir only when it does (on Windows, Git for Windows and
// the GitHub CLI install into separate directories, so no symlink is made).
// On win32 the binary lookup tries only what libuv spawns, in its order —
// `name.com`, `name.exe`, then the bare `name` — so a `git.CMD` earlier on
// PATH is passed over for the `git.EXE` that would actually run. The exclude
// check tests every PATHEXT extension instead: an excluded `gh.CMD` still
// means gh might resolve through a shell, so that check stays conservative.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STUB_SKIP_REASON = 'win32: execFile resolves only .exe/.com on PATH, so a script stub is never spawned';
const STUB_SKIP = process.platform === 'win32' && STUB_SKIP_REASON;

function installStub(name, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-stub-'));
  const file = path.join(dir, name);
  try {
    fs.writeFileSync(file, script);
    fs.chmodSync(file, 0o755); // root-safe: exec-bit stub, not a denial simulation
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  const hadPath = process.env.PATH !== undefined;
  process.env.PATH = hadPath ? dir + path.delimiter + process.env.PATH : dir;
  let restored = false;
  return function restore() {
    if (restored) return;
    restored = true;
    const rest = (process.env.PATH ?? '').split(path.delimiter);
    const at = rest.indexOf(dir);
    if (at !== -1) rest.splice(at, 1);
    if (!hadPath && rest.length === 0) delete process.env.PATH;
    else process.env.PATH = rest.join(path.delimiter);
    fs.rmSync(dir, { recursive: true, force: true });
  };
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// findEntry(dir, candidates, isWin) returns the first candidate file in dir.
// win32 file names are case-insensitive, so there it folds case — also on a
// POSIX host simulating win32 — and returns the entry's real name.
function findEntry(dir, candidates, isWin) {
  if (!isWin) return candidates.find((c) => isFile(path.join(dir, c)));
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return undefined;
  }
  for (const c of candidates) {
    const hit = entries.find((e) => e.toLowerCase() === c.toLowerCase() && isFile(path.join(dir, e)));
    if (hit) return hit;
  }
  return undefined;
}

function pathWithOnly(names, { exclude = [], env = process.env, platform = process.platform } = {}) {
  const isWin = platform === 'win32';
  const exts = isWin ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';') : [];
  const spawnable = (name) => (isWin ? [name + '.com', name + '.exe', name] : [name]);
  const anyExt = (name) => (isWin ? [...exts.map((ext) => name + ext), name] : [name]);
  const dirs = (env.PATH ?? env.Path ?? '').split(isWin ? ';' : ':').filter(Boolean);
  const excluded = (dir) => exclude.some((ex) => findEntry(dir, anyExt(ex), isWin));

  const result = [];
  let linkDir = null;
  for (const name of names) {
    let found = null;
    for (const dir of dirs) {
      const hit = findEntry(dir, spawnable(name), isWin);
      if (hit) {
        found = path.join(dir, hit);
        break;
      }
    }
    if (!found) throw new Error(`pathWithOnly: ${name} not found on PATH (searched ${dirs.length} dirs: ${dirs.join(', ') || 'none'})`);
    let dir = path.dirname(found);
    if (excluded(dir)) {
      if (!linkDir) linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-path-only-'));
      fs.symlinkSync(found, path.join(linkDir, path.basename(found)));
      dir = linkDir;
    }
    if (!result.includes(dir)) result.push(dir);
  }
  return result.join(path.delimiter);
}

// findColonPathJoins(text) returns the 1-based line numbers where a PATH is
// joined with a literal colon — a template literal whose pieces meet at a
// colon, or a .join with a colon argument — instead of path.delimiter, which
// is ';' on win32. Case-sensitive on PATH, and PATH must stand as a word, so
// a non-PATH join or an identifier that merely ends in PATH is not flagged.
const COLON_TEMPLATE_JOIN = /\bPATH\b[^\n]*`[^`\n]*\}:\$\{/;
const COLON_ARRAY_JOIN = /\bPATH\b[^\n]*\.join\(\s*['"]:['"]\s*\)/;

function findColonPathJoins(text) {
  const lines = [];
  text.split('\n').forEach((line, i) => {
    if (COLON_TEMPLATE_JOIN.test(line) || COLON_ARRAY_JOIN.test(line)) lines.push(i + 1);
  });
  return lines;
}

module.exports = {
  STUB_SKIP_REASON,
  STUB_SKIP,
  installStub,
  pathWithOnly,
  findColonPathJoins,
};
