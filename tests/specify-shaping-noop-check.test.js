'use strict';
// #2841: shaping mode's "already shaped, no-op" outcome is the result of
// compose-record.js --check exiting 0 on the record's live body — never a by-eye
// "the sections look present" judgment (the judgment that let 110 of 126 ready
// records miss ## Release Note, #2827). The classification is prose-only, so this
// pins the prose and runs the real checker in both directions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../plugin/bin/compose-record');

const readFlat = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\s+/g, ' ');
const SHAPING = readFlat('plugin/skills/specify/shaping-mode.md');
const READBACK = readFlat('plugin/skills/specify/shaping-mode-readback.md');

const NOOP = '`already shaped, no-op`';
const CHECK_CALL = 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-record.js" --check "$SPECIFY_SHAPED_BODY"';

const ACCEPTED = [
  '## Current State', '', 'The widget ignores the flag.', '',
  '## Deliverables', '', '1. Honor the flag.', '',
  '## Acceptance Criteria', '', '- [ ] The flag is honored.', '',
  '## Release Note', '', 'Fixed the widget ignoring its flag.', '',
].join('\n');
// Looks shaped by eye; lacks ## Release Note — the #2827 shape.
const REJECTED = ACCEPTED.slice(0, ACCEPTED.indexOf('## Release Note'));

function check(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaping-noop-'));
  const file = path.join(dir, 'body.md');
  fs.writeFileSync(file, body);
  let stderr = '';
  const code = run(['--check', file], { stdout: () => {}, stderr: (s) => { stderr += s; } });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code, stderr };
}

// The born-ready paragraph: from its opening words to the next bold-led paragraph.
function bornReadyParagraph() {
  const start = SHAPING.indexOf("Absorb the record's existing content");
  const end = SHAPING.indexOf('**Feedback-filing deliverable check.**');
  assert.ok(start >= 0 && end > start, 'born-ready paragraph not found in shaping-mode.md');
  return SHAPING.slice(start, end);
}

test('shaping-mode.md decides "already shaped" by running compose-record.js --check on the live body', () => {
  const para = bornReadyParagraph();
  assert.ok(para.includes(CHECK_CALL), 'the born-ready paragraph must run the --check call on the fetched body');
  assert.ok(para.includes('Exit 0'), 'exit 0 must be named as the already-shaped signal');
  assert.match(para, /Any non-zero exit[^.]*\.[^.]*never report it `already shaped, no-op`/, 'a rejected body must never be reported as a no-op');
  assert.ok(!para.includes('verify the sections are present and non-empty and move on'), 'the by-eye judgment must be gone');
});

test('Actions Performed defines the no-op outcome by the --check exit, not by eye', () => {
  const at = READBACK.indexOf(NOOP);
  assert.ok(at >= 0, 'no-op outcome token missing from shaping-mode-readback.md');
  const definition = READBACK.slice(at, READBACK.indexOf('`refused — proposed Absorb into', at));
  assert.ok(definition.includes('`compose-record.js --check` exited 0'), 'no-op must be defined as --check exiting 0 on the live body');
  assert.ok(definition.includes('never reported this way'), 'the definition must rule out a rejected body');
  assert.ok(!definition.includes('every section present and non-empty and every label family already stamped'), 'the by-eye definition must be gone');
});

test('a body --check accepts exits 0 — the only exit the prose maps to no-op', () => {
  const { code, stderr } = check(ACCEPTED);
  assert.equal(code, 0, stderr);
});

test('a body that only looks shaped is rejected with a non-zero exit — never a no-op', () => {
  const { code, stderr } = check(REJECTED);
  assert.equal(code, 4);
  assert.match(stderr, /missing section: ## Release Note/);
});
