'use strict';
// tests/build-dispatch-shell-constraint-prose.test.js — pins #4243: /build's subagent-strategy
// dispatch procedure (dispatch.md) directs /superpowers:subagent-driven-development to put the
// worktree shell constraint into every dispatch it composes — including the final whole-branch
// review and its fix wave, which SDD composes outside the per-task loop. Without it SDD's own
// prompts omit the constraint and agents hit the refusal guard (#3675, #3822).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const DISPATCH = readText(path.join(__dirname, '..', 'plugin', 'skills', 'build', 'dispatch.md'));

// The instruction paragraph: from its bold lead to the next bold-lead instruction.
// It ends at the next bold lead of any kind, so a renamed or moved neighbour cannot widen the slice.
const LEAD = /\*\*[^*]*shell constraint[^*]*\*\*/i.exec(DISPATCH);
const START = LEAD ? LEAD.index : -1;
let PARA = '';
let BOUNDED = false;
if (START >= 0) {
  const rest = DISPATCH.slice(START + LEAD[0].length);
  const next = rest.search(/ \*\*[^*]*[.:]\*\*/); // an instruction lead ends in punctuation; the cited **One plain command per Bash call** does not
  BOUNDED = next >= 0;
  if (BOUNDED) PARA = rest.slice(0, next);
}

test('dispatch.md: carries a shell-constraint instruction paragraph', () => {
  assert.ok(START >= 0, 'dispatch.md must carry a bold-lead "shell constraint" instruction (#4243).');
  assert.ok(BOUNDED, 'no bold lead follows the shell-constraint instruction; cannot bound its paragraph (#4243).');
  assert.match(PARA, /in the same invocation instruction, also direct `\/superpowers:subagent-driven-development`/i);
});

test('dispatch.md: the shell-constraint instruction names every dispatch SDD composes', () => {
  for (const d of ['each implementer,', 'task-review', 're-review', 'final-review', 'fix-round', 'fix-wave', 'whole-branch-fix', 'NEEDS_CONTEXT/BLOCKED']) {
    assert.ok(PARA.includes(d), `the shell-constraint instruction must name the ${d} dispatch (#4243).`);
  }
});

test('dispatch.md: the shell-constraint instruction cites the two canonical sections and the scratchpad-script workaround', () => {
  assert.ok(PARA.includes("`_shared/subagent-dispatch-core.md`'s **One plain command per Bash call**"), 'must cite the core section by name (#4243).');
  assert.ok(PARA.includes('`_shared/scratch-worktree.md` §7'), 'must cite scratch-worktree.md §7 (#4243).');
  assert.match(PARA, /Write the script to the scratchpad and run `node <script>`/, 'must name the scratchpad-script workaround (#4243).');
});
