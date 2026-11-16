'use strict';
// Checks the `// Last bump: {old} -> {new}, #{record}` line that sits directly
// above a pinned count assertion (#5552). Callers: tests/policy-schema.test.js
// and tests/bin-lib/skill-audit/anti-patterns.test.js. A pinned number cannot
// change without the same edit rewriting the Last bump line to match.
// Tests: tests/last-bump-helper.test.js.
const path = require('path');
const assert = require('node:assert/strict');
const { readText } = require('./read-skill');

const BUMP_RE = /^\s*\/\/ Last bump: (\d+) -> (\d+), #(\d+)\s*$/;
// The pinned number is the second argument; an optional third (message)
// argument is allowed.
const PIN_RE = /assert\.strictEqual\([^,]+,\s*(\d+)\s*(?:,[^;]*)?\);/;

function assertLastBump(file) {
  const lines = readText(file).split('\n');
  const where = path.basename(file);
  const hits = [];
  lines.forEach((line, i) => {
    if (BUMP_RE.test(line)) hits.push(i);
  });
  assert.equal(
    hits.length,
    1,
    `${where}: expected exactly one "// Last bump: {old} -> {new}, #{record}" line, found ${hits.length}${hits.length ? ` (at ${hits.map(i => `${where}:${i + 1}`).join(', ')})` : ''}`
  );
  const idx = hits[0];
  const lineNo = idx + 1;
  const bumpText = lines[idx].trim();
  const [, , newVal] = BUMP_RE.exec(lines[idx]);
  const pin = PIN_RE.exec(lines[idx + 1] || '');
  assert.ok(
    pin,
    `${where}:${lineNo} "${bumpText}" must be followed directly by the count assertion (assert.strictEqual(x, N);)`
  );
  assert.equal(
    pin[1],
    newVal,
    `${where}:${lineNo} "${bumpText}" says the pin is ${newVal} but the assertion below pins ${pin[1]}: rewrite the Last bump line when the pinned number changes`
  );
}

module.exports = { assertLastBump };
