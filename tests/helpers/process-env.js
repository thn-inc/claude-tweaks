'use strict';
// Real-process.env fixtures for the #5377 in-process hook tests (not a test file: no .test.js suffix).
//
// A test that hands a CLI or a hook event its own `env` proves the code reads that env, not the
// process's, by breaking the real process.env for the length of the call: a child that inherits
// instead of using the passed env then fails. Both helpers restore the real values in `finally`,
// and take a sync or an async `fn` (an async one is awaited before the restore, so the broken
// value stays in place until the call settles).
const os = require('os');
const path = require('path');

function restore(before) {
  for (const key of Object.keys(before)) {
    if (before[key] === undefined) delete process.env[key];
    else process.env[key] = before[key];
  }
}

// Sets process.env keys for the body of `fn` (a value of undefined deletes the key) and puts the
// previous values back afterwards. Returns what `fn` returns: its value, or a promise of it.
function withProcessEnv(overrides, fn) {
  const before = {};
  for (const key of Object.keys(overrides)) {
    before[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  let result;
  try {
    result = fn();
  } catch (err) {
    restore(before);
    throw err;
  }
  if (result && typeof result.then === 'function') return result.finally(() => restore(before));
  restore(before);
  return result;
}

// The real process.env names no repository (GIT_DIR points nowhere) for the length of `fn`.
function withBrokenGitDir(fn) {
  return withProcessEnv({ GIT_DIR: path.join(os.tmpdir(), 'ct-5377-no-such-git-dir') }, fn);
}

module.exports = { withProcessEnv, withBrokenGitDir };
