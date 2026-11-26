'use strict';
// runJq(args, input) runs the real `jq` and returns spawnSync's result with
// stdout's line endings normalized to \n (#3995). Native jq on Windows writes
// stdout in text mode, so every output newline arrives as \r\n; a test that
// compares jq's stdout to \n-joined text fails there and nowhere else.
// Normalizing at the read mirrors readText() (./read-skill.js) for the
// CRLF-read class: fix the input once instead of loosening every assertion.
// status and stderr are returned untouched; a `jq --version` probe that only
// checks status needs no helper.
const { spawnSync } = require('node:child_process');

function runJq(args, input) {
  const r = spawnSync('jq', args, { input, encoding: 'utf8' });
  if (typeof r.stdout === 'string') r.stdout = r.stdout.replace(/\r\n/g, '\n');
  return r;
}

module.exports = { runJq };
