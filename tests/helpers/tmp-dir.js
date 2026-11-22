'use strict';
// Self-cleaning scratch directories for tests.
//
// `tools/run-tests.js` gives a run a private TMPDIR it removes on exit, so a fixture that never removes its
// own directory is invisible there. A direct `node --test <file>` (one literal file is allowed by the
// direct-test-run guard, #5547) writes to the real tmpdir instead, and every such run left its fixtures
// behind: 597,912 top-level entries in one dev machine's $TMPDIR on 2026-11-18, which made `ls` on it take
// minutes. A test creates its directory with `scratchDir(prefix)` and never has to remember to remove it.
//
// Every directory made here is removed when the test process exits: `node --test` runs each file in its own
// process, so that is the end of the file. A test that wants one gone earlier (or checks it is gone) calls
// `removeScratchDir(dir)`; removing a directory twice is fine.
const fs = require('fs');
const os = require('os');
const path = require('path');

const made = new Set();
let registered = false;

function removeTree(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch (_) {
    // best effort: a directory a still-running child holds open must not fail the test run
  }
}

function removeAll() {
  for (const dir of made) removeTree(dir);
  made.clear();
}

// A fresh directory under `parent` (default os.tmpdir(), read at call time so a TMPDIR the test or the runner
// set is honored) named `prefix` + six random characters, removed when the process exits. `realpath: true`
// returns the symlink-resolved path (macOS /var -> /private/var), the form a path a child reports compares equal to.
function scratchDir(prefix, { parent = os.tmpdir(), realpath = false } = {}) {
  const dir = fs.mkdtempSync(path.join(parent, prefix));
  made.add(dir);
  if (!registered) {
    registered = true;
    process.on('exit', removeAll);
  }
  return realpath ? fs.realpathSync(dir) : dir;
}

// Points this process's TMPDIR/TMP/TEMP at a fresh scratchDir, so everything the test process or a child it
// spawns with an inherited environment writes to the tmpdir (a session-tmp root, a hook's scratch file, a
// product CLI's fallback directory) lands inside it and is removed at exit. For a test that exercises code which
// makes temp directories itself, where naming each one for removal is brittle. Call it once, near the top of the
// file; `os.tmpdir()` reads the variable at call time, so every later call sees the new location.
function isolateTmpdir(prefix = 'ct-iso-') {
  const dir = scratchDir(prefix);
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) process.env[key] = dir;
  return dir;
}

// Removes `dir` now. The exit hook still holds the original name, so a later removal of it is a no-op.
function removeScratchDir(dir) {
  removeTree(dir);
  made.delete(dir);
}

// #6006: the factory policy layer reads ~/.claude-tweaks/factory-policy.yml. tools/run-tests.js points
// CT_FACTORY_POLICY_FILE at a file inside its run root that never exists; a bare `node --test` has no runner, so a
// suite that loads this helper gets such a path here (children inherit it), the same fallback git-template.js
// gives CT_HOOKS_REPO_INFO_STORE. Nothing is created: the path only has to be absent. A value already set wins.
// tmp-dir.js is the helper chosen because most suites that resolve policy load it (98 of 120 policy-touching
// suites reach it, against 24 for git-template.js); the rest are the unit suites that inject their own env.
function applyFactoryFileFallback(env = process.env) {
  if (!env.CT_FACTORY_POLICY_FILE) {
    env.CT_FACTORY_POLICY_FILE = path.join(os.tmpdir(), `ct-no-factory-policy-${process.pid}`, 'factory-policy.yml');
  }
  return env;
}
applyFactoryFileFallback();

module.exports = { scratchDir, removeScratchDir, isolateTmpdir, applyFactoryFileFallback };
