'use strict';
// The shared "a second call starts no git process" check (#5846). Templates are
// cached per process, so a builder's warm-call test belongs in a test file that
// already builds that template (see the header of tests/helpers/git-template.js).
//
// warmCallStartsNoGit(warm, opts = {}) -> { warm, traced }
//   warm:        () => any   called once first; it may build a template and start git
//   opts.traced: () => any   synchronous; called under GIT_TRACE2_EVENT=<fresh empty dir>; defaults to `warm`
//   opts.track:  (result) => void   called with warm's result, then with traced's result,
//                                   before the assertion, so the caller can register cleanup
// Asserts that no trace file was written (a git process writes one each; the failure message
// names the argv of each started process), removes the trace dir, and returns both results
// for the caller's further assertions. An async `traced` is refused: its git would run after
// GIT_TRACE2_EVENT is restored.
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('./tmp-dir');
const os = require('os');
const path = require('path');

function warmCallStartsNoGit(warm, opts = {}) {
  const { traced = warm, track } = opts;
  const warmResult = warm();
  if (track) track(warmResult);
  const dir = scratchDir('ct-gt-trace-');
  const prev = process.env.GIT_TRACE2_EVENT;
  let tracedResult;
  let files;
  const argvs = [];
  try {
    process.env.GIT_TRACE2_EVENT = dir;
    try {
      tracedResult = traced();
      if (tracedResult && typeof tracedResult.then === 'function') {
        // Handle the refused promise so its own rejection cannot surface as an unhandled rejection over the TypeError.
        tracedResult.then(undefined, () => {});
        throw new TypeError('warmCallStartsNoGit: traced must be synchronous (an async call would run its git after GIT_TRACE2_EVENT is restored)');
      }
    } finally {
      if (prev === undefined) delete process.env.GIT_TRACE2_EVENT; else process.env.GIT_TRACE2_EVENT = prev;
    }
    if (track) track(tracedResult);
    files = fs.readdirSync(dir);
    for (const f of files) {
      let text = '';
      try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { /* skip an unreadable trace file, as an unparseable line is skipped; the assertion still reports it */ }
      for (const line of text.split('\n')) {
        try {
          const ev = JSON.parse(line);
          if (ev.event === 'start') argvs.push(ev.argv);
        } catch { /* skip a line that does not parse */ }
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.deepStrictEqual(files, [], `the traced call started ${files.length} git process(es): ${JSON.stringify(argvs)}`);
  return { warm: warmResult, traced: tracedResult };
}

module.exports = { warmCallStartsNoGit };
