// tests/dispatch-shipped-candidate-prose.test.js
//
// Pins record #1984's prose wiring: the queue pull must classify shipped
// candidates (title-only first pass, capped files-based upgrade second pass,
// staged Close proposal) after the #1224 open-PR exclusion and before the
// #1579 cross-PR overlap report; SKILL.md must state the False-positive
// posture and the accepted false negative, and report the exclusion the same
// non-gating way as its siblings. The mechanical half (the strong/weak/none
// tiering, the timeline-mentions extension) is pinned separately in
// tests/bin-lib/issues/shipped-candidate.test.js and
// tests/bin-lib/issues/linked-prs.test.js.
//
// #5230: the pass is the queue-pull module's (plugin/bin/lib/dispatch/queue-pull.js), so its order
// is read from PASSES and the release-time downgrade runs the module's shipped pass alone. The
// probe cap, the AUTO lines, the staged Close proposal and both classifyShipped call sites are
// pinned in tests/bin-lib/dispatch/queue-pull.test.js (the AC2.1 shipped and `#5227 shipped` tests).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readText } = require('./helpers/read-skill');
const { readExclusions } = require('../plugin/bin/lib/dispatch/exclusions');
const { PASSES, makeContext, runPasses } = require('../plugin/bin/lib/dispatch/queue-pull');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

const DISPATCH_SKILL = read('plugin/skills/dispatch/SKILL.md');

test('the queue pull classifies shipped candidates after the #1224 exclusion and before the #1579 report', () => {
  const at = (id) => PASSES.findIndex((p) => p.id === id);
  const [openPr, shipped, crossPr] = ['open-pr', 'shipped', 'cross-pr-overlap'].map(at);
  assert.ok(openPr !== -1 && shipped !== -1 && crossPr !== -1);
  assert.ok(openPr < shipped, 'shipped-candidate classification runs after the open-PR exclusion');
  assert.ok(shipped < crossPr, 'shipped-candidate classification runs before the cross-PR overlap report');
  assert.deepEqual(PASSES[shipped], { ...PASSES[shipped], kind: 'exclusion', reason: 'shipped', removes: true, bypass: false });
});

test('SKILL.md states the two-independent-signal false-positive posture and the accepted false negative', () => {
  assert.match(DISPATCH_SKILL, /False-positive posture \(#1984\)/);
  assert.match(DISPATCH_SKILL, /two independent signals, never one alone/);
  assert.match(DISPATCH_SKILL, /residual false negative/);
});

test('SKILL.md queue definition names the shipped-candidate exclusion, and reports it the same non-gating way as its siblings', () => {
  assert.match(DISPATCH_SKILL, /not already shipped by a `strong`-tier merged-PR mention \(#1984\)/);
  assert.match(DISPATCH_SKILL, /Shipped-candidate exclusion report \(refs #1984\)/);
});

test('the cited modules actually export classifyShipped and the extended fetchLinkedPRs', () => {
  const shipped = require('../plugin/bin/lib/issues/shipped-candidate');
  assert.strictEqual(typeof shipped.classifyShipped, 'function');
  const linkedPrs = require('../plugin/bin/lib/issues/linked-prs');
  assert.strictEqual(typeof linkedPrs.fetchLinkedPRs, 'function');
});

test('#4314: SKILL.md states that a mention from a PR already open when the record was filed is skipped', () => {
  assert.match(DISPATCH_SKILL, /opened before the record was created/);
  assert.match(DISPATCH_SKILL, /#4314/);
});

test('#4432: SKILL.md states the release rule and its accepted false negative', () => {
  assert.match(DISPATCH_SKILL, /#4432/);
  assert.match(DISPATCH_SKILL, /latest claim release/);
  assert.match(DISPATCH_SKILL, /shaping-only release/);
});

test('dispatch/SKILL.md stays under the read-limit rail', () => {
  const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');
  assert.ok(Buffer.byteLength(DISPATCH_SKILL) <= RAIL_BYTES);
});

// The module's shipped pass run alone over records 7 (the #4432 shape) and 8 (same PR shape, no
// release): each has a merged mention whose title matches its own, strong on title evidence alone.
// `claim(n)` answers the claim read the pass makes for a release time. hooks.js answers no run dir,
// so nothing is staged; nothing is probed, so no gh call is made.
function runShippedPass(t, claim) {
  const errs = [];
  const ctx = makeContext({ sessionId: `dispatch-shipped-release-${crypto.randomBytes(6).toString('hex')}` }, {
    stderr: (s) => errs.push(s),
    stdout: () => {},
    createClaimReader: () => ({ read: claim }),
    spawnCli: (name) => {
      if (name === 'hooks.js') return { status: 0, stdout: '\n', stderr: '' };
      throw new Error(`unexpected CLI ${name}`);
    },
    run: (cmd, args) => { throw new Error(`unexpected ${cmd} ${args.join(' ')}`); },
  });
  t.after(() => fs.rmSync(path.dirname(ctx.paths['dispatch-groups.json']), { recursive: true, force: true }));
  const record = (number) => ({ number, title: 'Add widget export command', body: '', createdAt: '2026-09-20T10:00:00.000Z', labels: ['ready'] });
  const mention = { number: 500, merged: true, title: 'Add widget export command', createdAt: '2026-09-25T10:00:00.000Z', mergedAt: '2026-10-01T10:00:00.000Z' };
  fs.writeFileSync(ctx.paths['dispatch-groups.json'], JSON.stringify([[record(7), record(8)]]));
  fs.writeFileSync(ctx.paths['dispatch-linked-prs.json'], JSON.stringify({ 7: { mentions: [mention] }, 8: { mentions: [mention] } }));
  fs.writeFileSync(ctx.paths['dispatch-exclusions.json'], '[]');
  runPasses(PASSES.filter((p) => p.id === 'shipped'), ctx);
  return {
    stderr: errs.join(''),
    finalGroups: JSON.parse(fs.readFileSync(ctx.paths['dispatch-groups.json'], 'utf8')),
    exclusions: readExclusions(ctx.paths['dispatch-exclusions.json']),
  };
}

test('AC1.1: the shipped pass keeps a downgraded record, excludes the unreleased one, and logs the downgrade', (t) => {
  const released = JSON.stringify({ released: true, releasedAt: '2026-10-02T13:00:00.000Z' });
  const { stderr, finalGroups, exclusions } = runShippedPass(t, (n) => ({ content: n === 7 ? released : null }));
  assert.deepStrictEqual(finalGroups.flat().map((c) => c.number), [7]);
  assert.deepStrictEqual(exclusions.map((e) => e.records[0]), [8]);
  assert.match(stderr, /#7 kept: merged PR #500 predates claim release at 2026-10-02T13:00:00\.000Z/);
  assert.match(stderr, /#8 excluded, shipped by merged PR #500/);
});

// Before #5230 this case was a missing release-times file. The module's first pass always writes
// that file, so an empty map now comes from a failed claim read (readReleaseTimes's own missing-file
// case is pinned in tests/bin-lib/dispatch/shipped-releases.test.js).
test('AC4.1: an unknown release time leaves the shipped pass at the prior behavior', (t) => {
  const { stderr, finalGroups, exclusions } = runShippedPass(t, () => ({ failure: 'git-fetch-failed' }));
  assert.deepStrictEqual(finalGroups, []);
  assert.deepStrictEqual(exclusions.map((e) => e.records[0]).sort(), [7, 8]);
  assert.match(stderr, /shipped-candidate claim read failed for #7 \(git-fetch-failed\), #8 \(git-fetch-failed\); release time unknown, no downgrade/);
});
