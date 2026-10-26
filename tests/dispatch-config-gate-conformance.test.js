// tests/dispatch-config-gate-conformance.test.js — #3225 prose pins.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const CAUSE = /`\/claude-tweaks:flow` Step 3 \(Manifesto\) has not written config\.yml/;

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.ok(start !== -1, `missing heading: ${heading}`);
  const next = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, next === -1 ? text.length : next);
}

test('#3225: sibling-session-check.md Worktree-resume check carries the bind-before-call-1 instruction, after the resumed-worktree skip rule', () => {
  const sec = section(read('plugin/skills/dispatch/sibling-session-check.md'), '## Worktree-resume check');
  assert.match(sec, /record-worktree --run "\$GROUP_RUN_DIR" "\{worktree\}" --dispatch/);
  assert.match(sec, /before dispatching this group's first Task call/);
  const skipIdx = sec.indexOf('skip this group entirely');
  const bindIdx = sec.indexOf('--dispatch');
  assert.ok(skipIdx !== -1 && bindIdx > skipIdx,
    'the bind must follow the resumed-worktree skip rule so a sibling-owned (resumed) worktree is never bound');
  assert.match(sec, /never blocks|dispatch anyway/, 'a failed bind is logged, never a dispatch blocker');
});

test('#3225: docs/hooks.md documents checkDispatchConfigGate — trigger, resolution, scope, and cause/remedy', () => {
  const doc = read('docs/hooks.md');
  assert.match(doc, /checkDispatchConfigGate/);
  assert.match(doc, CAUSE);
  assert.match(doc, /dispatched: true/);
  assert.match(doc, /ctx\.ownedRun/);
  assert.match(doc, /retry the same command unchanged/);
  assert.match(doc, /not `merge`\/`rebase`/);
});

test('#3225: the deny reason in pre-tool-use.js carries the documented cause literal', () => {
  const src = read('plugin/bin/lib/hooks/pre-tool-use.js');
  assert.match(src, CAUSE);
  assert.match(src, /does not count toward any re-stamp\/retry budget/);
});
