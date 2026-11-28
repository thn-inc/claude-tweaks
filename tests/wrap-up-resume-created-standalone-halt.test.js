'use strict';

// Conformance pins for resuming a created standalone wrap-up run halted at the Review Console
// "Stop and re-engage" option. The SessionEnd hook never stamps a created standalone dir
// `interrupted` (no owning session, so attribution is `fallback`), so `resume-halted-run.md`
// must find it by its `createdBy: "wrap-up-standalone"` marker plus the console's stop record
// in `decisions.md` (written by `review-console-interactive.md`'s "On stop").
//
// Reads the live prose. Every presence claim carries a go-red control: strip the matches and
// assert the same pattern no longer matches.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const WRAP_UP_DIR = path.join(ROOT, 'plugin/skills/wrap-up');
const read = (name) => {
  const p = path.join(WRAP_UP_DIR, name);
  return fs.existsSync(p) ? readText(p) : '';
};
const RESUME = read('resume-halted-run.md');
const CONSOLE = read('review-console-interactive.md');

// One presence claim: matches the live text AND stops matching once every match is stripped.
function assertPinned(text, re, label) {
  assert.match(text, re, `${label}: missing`);
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const stripped = text.replace(global, '');
  assert.notStrictEqual(stripped, text, `${label}: control stripped nothing`);
  assert.doesNotMatch(stripped, re, `${label}: pattern survives its own stripping (cannot go red)`);
}

// The "On stop" section body, from its heading to the next level-2 heading.
const onStop = (text) => {
  const m = text.match(/## On stop \(option 3\)\r?\n([\s\S]*?)(?=\r?\n## )/);
  return m ? m[1] : '';
};

test('resume-halted-run.md: a created standalone run is found by createdBy + active status', () => {
  assertPinned(RESUME, /`status: active`[\s\S]*?`createdBy: "wrap-up-standalone"`/, 'created-run marker');
});

test('resume-halted-run.md: a created run is resumable only with the console stop record', () => {
  assertPinned(RESUME, /Review Console: terminal decision stop/, 'stop record in decisions.md');
});

test('resume-halted-run.md: the inherited (pipeline) run still resumes only on status: interrupted', () => {
  assertPinned(RESUME, /whose `run-state\.json` has `status: interrupted`/, 'inherited interrupted precondition');
});

test('review-console-interactive.md "On stop" writes the stop record before halting', () => {
  const body = onStop(CONSOLE);
  assert.ok(body.length > 0, 'On stop section must exist');
  assertPinned(body, /Review Console: terminal decision stop/, 'On stop stop record');
  assertPinned(body, /Write that line before halting/, 'stop record written before halting');
});

test('review-console-interactive.md: the logging paragraph names the stop record for Stop', () => {
  assertPinned(CONSOLE, /For Stop, this is the stop record `resume-halted-run\.md` keys on/, 'stop record cross-reference');
});
