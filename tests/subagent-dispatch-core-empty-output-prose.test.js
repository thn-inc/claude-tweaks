// tests/subagent-dispatch-core-empty-output-prose.test.js — pins the #1863
// addition to skills/_shared/subagent-dispatch-core.md's Failed-agent
// retrieval section: a subagent whose *dispatching* session was terminated
// (not the subagent's own failure) leaves a 0-byte output file, so "read its
// transcript tail" is not a recovery path for that case — an empty file must
// be treated as "no result, re-dispatch," never "no findings." Reads the
// live skill file — this test pins prose we just wrote, not a third-party
// fact (the skill-prose-conformance-tests live-vs-fixture distinction).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CORE_MD = path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'subagent-dispatch-core.md');

function read() {
  return fs.readFileSync(CORE_MD, 'utf8');
}

function section(text, start, end) {
  const s = text.indexOf(start);
  assert.notEqual(s, -1, `expected to find "${start}"`);
  const e = end ? text.indexOf(end, s) : text.length;
  return text.slice(s, e === -1 ? text.length : e);
}

test('subagent-dispatch-core.md Failed-agent retrieval names the parent-terminated 0-byte case', () => {
  const text = read();
  const sec = section(text, '## Failed-agent retrieval', '## How to integrate at a dispatch site');
  assert.match(sec, /A subagent whose \*parent\* session was terminated leaves a 0-byte output file/);
});

test('subagent-dispatch-core.md states an empty output file is "no result", never "no findings"', () => {
  const text = read();
  const sec = section(text, '## Failed-agent retrieval', '## How to integrate at a dispatch site');
  assert.match(sec, /Treat an empty output file as \*\*"no result — re-dispatch,"\s*\nnever "no findings"\*\*/);
});

test('subagent-dispatch-core.md distinguishes this from the ordinary failed-agent case (no transcript to read)', () => {
  const text = read();
  const sec = section(text, '## Failed-agent retrieval', '## How to integrate at a dispatch site');
  assert.match(sec, /"read its\s*\ntranscript tail" is not a recovery path here, because there is no transcript to read/);
});

test('subagent-dispatch-core.md cites the 2026-09-04 design-review fan-out observation', () => {
  const text = read();
  const sec = section(text, '## Failed-agent retrieval', '## How to integrate at a dispatch site');
  assert.match(sec, /2026-09-04, plugin 6\.114\.1/);
  assert.match(sec, /30\/40 → 25\/40/);
});
