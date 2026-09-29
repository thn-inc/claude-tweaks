'use strict';
// #2827: shaping mode's literal body templates must carry every section the
// Materialization gate requires — the template omitting ## Release Note is how
// 110 of 126 ready records came to fail the gate (2026-09-29).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REQUIRED_SECTIONS } = require('../plugin/bin/lib/issues/materialize-format');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// The first ``` fenced block after an anchor phrase, as an array of lines.
function fenceAfter(src, anchor) {
  const at = src.indexOf(anchor);
  assert.ok(at >= 0, `anchor not found: ${anchor}`);
  const open = src.indexOf('\n```', at);
  const close = src.indexOf('\n```', open + 4);
  assert.ok(open >= 0 && close > open, `no fenced block after: ${anchor}`);
  return src.slice(open + 4, close).split('\n').map((l) => l.trim());
}

for (const [file, anchor] of [
  ['plugin/skills/specify/shaping-mode.md', 'in this literal shape'],
  ['plugin/skills/specify/shaping-mode-stamping.md', 'Final assembly order'],
]) {
  test(`${path.basename(file)} template carries every gate-required section`, () => {
    const lines = fenceAfter(read(file), anchor);
    for (const heading of REQUIRED_SECTIONS) {
      assert.ok(lines.some((l) => l === heading || l.startsWith(`${heading} `)), `${file} template is missing ${heading}`);
    }
  });
}

test('shaping-mode-stamping.md runs compose-record.js --check before the write', () => {
  const src = read('plugin/skills/specify/shaping-mode-stamping.md');
  const checkAt = src.indexOf('compose-record.js" --check');
  const writeAt = src.indexOf('gh issue edit {n} \\');
  assert.ok(checkAt >= 0, 'pre-write --check call missing');
  assert.ok(checkAt < writeAt, 'the --check call must come before the gh issue edit write');
  const lines = src.split('\n');
  const writeLine = lines.findIndex((l) => l.startsWith('gh issue edit {n} \\'));
  assert.match(lines[writeLine - 1], /--check "\$SPECIFY_SHAPED_BODY" \|\| exit\b/, 'a failed --check must stop the write on the line before it');
  assert.ok(src.includes('pre-write shape check failed:'), 'failed-row Detail wording missing');
});
