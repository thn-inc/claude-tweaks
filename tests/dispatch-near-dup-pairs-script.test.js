// tests/dispatch-near-dup-pairs-script.test.js — #3520.
//
// The queue pull persists the strong cross-group near-duplicate pairs to
// dispatch-near-dup-pairs.json for the later selection steps. #5230: the subject is the queue-pull
// module's near-dup-pairs pass (plugin/bin/lib/dispatch/queue-pull.js), run alone over groups
// fixtures. A stale pairs file rewritten to [] and the neighbour-in-flight pool's wiring are pinned
// in tests/bin-lib/dispatch/queue-pull.test.js (the `#5227 near-dup`, AC2.2 neighbour-in-flight and
// `#5230` near-dup / neighbour tests).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PASSES, SESSION_FILES, makeContext, runPasses } = require('../plugin/bin/lib/dispatch/queue-pull');

function rec(number, title, anchors) {
  return {
    number,
    title,
    labels: [{ name: 'priority:medium' }],
    body: '## Current State\n\n' + anchors.map((a) => `- \`${a}\` is wired`).join('\n') + '\n',
  };
}

// Runs the near-dup-pairs pass alone over `groups` in a fresh session; returns its stderr and the
// pairs file the pass wrote at the module's session path.
function run(t, groups) {
  const errs = [];
  const ctx = makeContext({ sessionId: `dispatch-nd-pairs-${crypto.randomBytes(6).toString('hex')}` }, { stderr: (s) => errs.push(s) });
  t.after(() => fs.rmSync(path.dirname(ctx.paths['dispatch-groups.json']), { recursive: true, force: true }));
  fs.writeFileSync(ctx.paths['dispatch-groups.json'], JSON.stringify(groups));
  runPasses(PASSES.filter((p) => p.id === 'near-dup-pairs'), ctx);
  return { stderr: errs.join(''), pairs: JSON.parse(fs.readFileSync(ctx.paths['dispatch-near-dup-pairs.json'], 'utf8')) };
}

test('AC8.1: the near-dup-pairs pass warns on every cross-group pair and persists only the strong one, without a strong key', (t) => {
  const result = run(t, [
    [rec(1, 'Wire the cache layer', ['a.one', 'b.two', 'c.three'])],
    [rec(2, 'Rotate the signing keys', ['a.one', 'b.two', 'c.three'])],
    [rec(3, 'Prune stale worktrees', ['d.four'])],
    [rec(4, 'Render the status table', ['d.four'])],
  ]);
  assert.ok(
    result.stderr.includes('AUTO — dispatch: near-duplicate candidates across groups: #1 / #2 (body-anchor-overlap)'),
    `stderr was: ${result.stderr}`,
  );
  assert.ok(
    result.stderr.includes('AUTO — dispatch: near-duplicate candidates across groups: #3 / #4 (body-anchor-overlap)'),
    `stderr was: ${result.stderr}`,
  );
  assert.deepStrictEqual(result.pairs, [
    { records: [1, 2], signals: ['body-anchor-overlap'], sharedAnchors: ['a.one', 'b.two', 'c.three'] },
  ]);
});

test('AC8.2: the pairs file is one of the session-scoped files the queue pull names', () => {
  assert.ok(SESSION_FILES.includes('dispatch-near-dup-pairs.json'));
});
