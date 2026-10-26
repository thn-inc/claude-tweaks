'use strict';
// tools/test-impact/node-options.js — the one place a tracer/preload path becomes a NODE_OPTIONS
// `--require` token (#4134).
//
// NODE_OPTIONS is split on spaces, so the path keeps its double quotes (a checkout path may hold a
// space). Node's NODE_OPTIONS parser also treats `\` inside double quotes as an escape, so a native
// win32 path (`D:\a\x y\tracer.js`) loses its backslashes and the preload never loads. Node's
// `require` accepts `/` on win32, so the path is forward-slashed first. `pathImpl` is a parameter so
// a test can pin the win32 branch with `path.win32` on any host.

const path = require('path');
const { toPosix } = require('../../plugin/bin/lib/shared-primitives');

function requireOption(p, pathImpl = path) {
  return `--require "${toPosix(p, pathImpl.sep)}"`;
}

module.exports = { requireOption };
