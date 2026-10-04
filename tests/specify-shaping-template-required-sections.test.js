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
  assert.ok(writeLine > 0, 'no line starts with the gh issue edit {n} write');
  // Anchored at end of line: a bare `|| exit` re-raises --check's own code; `|| exit 4` would collapse exit 2 into 4.
  assert.match(lines[writeLine - 1], /--check "\$SPECIFY_SHAPED_BODY" \|\| exit\s*$/, 'a failed --check must stop the write on the line before it, keeping its own exit code');
  assert.ok(src.includes('pre-write shape check failed:'), 'failed-row Detail wording missing');
});

test('shaping-mode-stamping.md runs compose-record.js --check before the local-files writeRecord', () => {
  const src = read('plugin/skills/specify/shaping-mode-stamping.md');
  const para = src.split('\n').find((l) => l.startsWith('**`work-backend: local-files`:** write `$SHAPED_BODY`'));
  assert.ok(para, 'local-files compose-then-write-once paragraph missing');
  const checkAt = para.indexOf('run the same `compose-record.js --check` first');
  const writeAt = para.indexOf('`writeRecord` call');
  assert.ok(checkAt >= 0, 'local-files pre-write --check line missing');
  assert.ok(writeAt > checkAt, 'the --check must come before the writeRecord call');
  // "same exit handling" binds this driver to the github-issues fence's rule: any non-zero exit writes nothing.
  assert.match(para.slice(checkAt, writeAt), /same exit handling/, 'local-files --check must reuse the github-issues exit handling');
});
