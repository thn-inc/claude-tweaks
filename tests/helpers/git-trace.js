'use strict';
// The shared "a second call starts no git process" check (#5846). Templates are
// cached per process, so a builder's warm-call test belongs in a test file that
// already builds that template (see the header of tests/helpers/git-template.js).
//
// warmCallStartsNoGit(warm, opts = {}) -> { warm, traced }
//   warm:        () => any   called once first; it may build a template and start git
//   opts.traced: () => any   called under GIT_TRACE2_EVENT=<fresh empty dir>; defaults to `warm`
//   opts.track:  (result) => void   called with warm's result, then with traced's result,
//                                   before the assertion, so the caller can register cleanup
// Asserts that no trace file was written (a git process writes one each), removes the
// trace dir, and returns both results for the caller's further assertions.
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function warmCallStartsNoGit(warm, opts = {}) {
  const { traced = warm, track } = opts;
  const warmResult = warm();
  if (track) track(warmResult);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-gt-trace-'));
  const prev = process.env.GIT_TRACE2_EVENT;
  let tracedResult;
  let files;
  try {
    process.env.GIT_TRACE2_EVENT = dir;
    try {
      tracedResult = traced();
    } finally {
      if (prev === undefined) delete process.env.GIT_TRACE2_EVENT; else process.env.GIT_TRACE2_EVENT = prev;
    }
    if (track) track(tracedResult);
    files = fs.readdirSync(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.deepStrictEqual(files, []);
  return { warm: warmResult, traced: tracedResult };
}

module.exports = { warmCallStartsNoGit };
