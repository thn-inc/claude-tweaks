// tests/dispatch-not-spec-shaped-exclusion-fixture.test.js — #2829.
//
// #5230: the pass's behavior is pinned against the queue-pull module
// (plugin/bin/lib/dispatch/queue-pull.js) in tests/bin-lib/dispatch/queue-pull.test.js: the AC2.1
// not-spec-shaped test (exact missing sections, excluded candidates leave the groups) and the two
// `#5230 not-spec-shaped` fixtures (placeholder flagged and exempted, mixed and emptied groups, an
// empty body). This suite keeps the pass's position, read from the module's ordered registry.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PASSES } = require('../plugin/bin/lib/dispatch/queue-pull');

// queuePull walks PASSES in array order, so a pass's index is its position in the pull.
function indexOf(passes, id) {
  const at = passes.findIndex((p) => p.id === id);
  assert.notStrictEqual(at, -1, `no ${id} pass in the queue-pull registry`);
  return at;
}
function assertRunsBefore(passes, first, laters) {
  for (const later of laters) {
    assert.ok(indexOf(passes, first) < indexOf(passes, later), `${first} must run before ${later}`);
  }
}

// #3086: the not-spec-shaped pass must run ahead of the gh-backed open-PR (#1224) and
// shipped-candidate (#1984) passes -- a candidate it excludes must never cost those passes'
// `gh` probes, and must never collect a staged Close proposal from the shipped pass.
test('the queue-pull registry runs the not-spec-shaped pass ahead of the open-PR and shipped-candidate passes (#3086)', () => {
  assertRunsBefore(PASSES, 'not-spec-shaped', ['open-pr', 'shipped']);

  // Permutation control: the same registry with the pass moved after open-pr goes red.
  const moved = PASSES.filter((p) => p.id !== 'not-spec-shaped');
  moved.splice(indexOf(moved, 'open-pr') + 1, 0, PASSES[indexOf(PASSES, 'not-spec-shaped')]);
  assert.throws(() => assertRunsBefore(moved, 'not-spec-shaped', ['open-pr', 'shipped']), /not-spec-shaped must run before open-pr/);
});
