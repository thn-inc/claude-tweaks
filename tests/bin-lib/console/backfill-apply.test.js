// tests/bin-lib/console/backfill-apply.test.js — the Review Console backlog
// backfill's apply step (#3950): the only console.json writer. A settled item
// carries its audit record, a split decision group is persisted one entry per
// finding, refusals are named and write nothing, and a console is acknowledged
// only once every item is settled.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { BACKFILL_OUTCOMES, BACKFILL_SOURCES, entryProblem, applyToConsole } = require('../../../plugin/bin/lib/console/backfill-apply');
const { consoleWorkItems } = require('../../../plugin/bin/lib/console/backfill');
const { UNRESOLVED_RESOLUTIONS, unresolvedItems, readRunResidue } = require('../../../plugin/bin/lib/console/residue');

const AT = '2026-10-24T12:00:00.000Z';
const RUN_ID = '2026-10-16T162759-record-3013';

const tmpDirs = [];
after(() => { for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true }); });
function tmpRun() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-backfill-apply-'));
  tmpDirs.push(dir);
  return dir;
}

const sha8 = (line) => crypto.createHash('sha256').update(line).digest('hex').slice(0, 8);
const newId = (line) => `decision:${line.slice(2, 60)}#${sha8(line)}`;
const oldId = (line) => `decision:${line.slice(2, 60)}`;
const LOW = 'Low-confidence findings';
const KEEP = (id) => ({ id, section: LOW, resolution: 'keep-staged', reason: 'unconfirmed finding — never auto-applied' });
const PENDING = (id) => ({ id, section: 'Pending review', resolution: 'pending', reason: 'unmapped-prefix' });
const APPROVED = (id) => ({ id, section: 'Documentation updates', resolution: 'approve', reason: 'r' });

const BUNDLED = '- STAGED 19:29:13 — Step 3 reproduction: lens 3f findings not reproduced (single agent): classify.test.js:81 tests normalizeEntry directly (internal coupling); pr-check-gate-conformance.test.js:77 prose-regex extraction called brittle (note: deepEqual against FAILING_CONCLUSIONS fails loudly on an empty extraction). Staged to Review Console as low-confidence. Reversibility: high.';
const SINGLE = '- STAGED 10:00:00 — Reproduction: lens "3c" finding plugin/bin/lib/console/residue.js:40 not reproduced (single agent): the missing split ignores ids that carry a slash. Staged to Review Console as low-confidence. Reversibility: high.';
const ALPHA = '- STAGED 10:00:00 — Reproduction: lens "3c" finding plugin/bin/lib/console/alpha.js:10 not reproduced (single agent): the alpha reader drops a trailing newline. Staged to Review Console as low-confidence.';
const BETA = '- STAGED 10:00:00 — Reproduction: lens "3c" finding plugin/bin/lib/console/beta.js:20 not reproduced (single agent): the beta writer skips its atomic rename step. Staged to Review Console as low-confidence.';

const STAGED = { 'zz-1.md': 'zz\n', 'zz-2.md': 'zz\n' };
const readStaged = (name) => (Object.prototype.hasOwnProperty.call(STAGED, name) ? STAGED[name] : null);

function fixture(consoleDir, items, decisionLines = [], extra = {}) {
  return { consoleDir, consoleJson: { resolved: true, items, ...extra }, decisions: `# Decisions\n\n${decisionLines.join('\n')}\n`, readStaged, runId: RUN_ID };
}
const list = (fx) => consoleWorkItems(fx);
const entry = (item, outcome = 'digested', source = 'digest', ref = 'https://x/c/1') => ({ runDir: item.consoleDir, itemId: item.itemId, itemHash: item.itemHash, outcome, source, ref });
const apply = (fx, entries) => applyToConsole({ ...fx, entries, at: AT });

test('AC5.1: a settled item is rewritten with its audit record', () => {
  const run = tmpRun();
  const fx = fixture(run, [PENDING('zz-1.md')]);
  const [item] = list(fx);
  const r = apply(fx, [entry(item)]);
  assert.deepStrictEqual(r.applied, [item.itemId]);
  assert.deepStrictEqual(r.refused, []);
  const [written] = r.json.items;
  assert.strictEqual(written.id, 'zz-1.md');
  assert.strictEqual(written.section, 'Pending review');
  assert.strictEqual(written.resolution, 'digested');
  assert.deepStrictEqual(written.settled, { outcome: 'digested', source: 'digest', ref: 'https://x/c/1', at: AT });
  assert.strictEqual(written.reason, 'backfill: digest → digested (https://x/c/1)');
  assert.strictEqual(written.backfillId, item.itemId);
  fs.writeFileSync(path.join(run, 'console.json'), JSON.stringify(r.json));
  assert.strictEqual(readRunResidue(run).consoles.length, 0);
});

test('AC5.2: a console with all items settled is acknowledged', () => {
  const fx = fixture(tmpRun(), [KEEP(newId(SINGLE)), APPROVED('docs:x'), PENDING('zz-1.md')], [SINGLE]);
  const items = list(fx);
  assert.strictEqual(items.length, 2);
  const r = apply(fx, [entry(items[0], 'filed', 'tiebreak', '#4001'), entry(items[1], 'dismissed', 'staged-kind', 'unmapped-prefix')]);
  assert.strictEqual(r.json.residueAcknowledgedAt, AT);
  assert.strictEqual(r.acknowledged, true);
});

test('AC5.3: a console with an unsettled item is not acknowledged', () => {
  const fx = fixture(tmpRun(), [PENDING('zz-1.md'), PENDING('zz-2.md')]);
  const [first] = list(fx);
  const r = apply(fx, [entry(first)]);
  assert.strictEqual(r.json.items[1].resolution, 'pending');
  assert.ok(!('residueAcknowledgedAt' in r.json));
  assert.strictEqual(r.acknowledged, false);
});

test('no backfill outcome is unresolved', () => {
  assert.ok(BACKFILL_OUTCOMES.every((o) => !UNRESOLVED_RESOLUTIONS.has(o)));
  assert.deepStrictEqual(BACKFILL_OUTCOMES, ['filed', 'dropped', 'digested', 'dismissed']);
  assert.deepStrictEqual(BACKFILL_SOURCES, ['tiebreak', 'staged-kind', 'digest']);
});

test('AC1.1: re-applying settled entries changes nothing', () => {
  const fx = fixture(tmpRun(), [PENDING('zz-1.md')]);
  const [item] = list(fx);
  const entries = [entry(item)];
  const first = apply(fx, entries);
  const second = apply({ ...fx, consoleJson: first.json }, entries);
  assert.strictEqual(second.json, null);
  assert.deepStrictEqual(second.applied, []);
  assert.deepStrictEqual(second.refused, [{ itemId: item.itemId, reason: 'already-settled' }]);
});

test('AC1.1b: resume after a partial apply', () => {
  const fx = fixture(tmpRun(), [KEEP(newId(BUNDLED))], [BUNDLED]);
  const [a, b] = list(fx);
  const first = apply(fx, [entry(a, 'filed', 'tiebreak', '#4002')]);
  assert.deepStrictEqual(first.json.items.map((i) => [i.id, i.resolution]), [[a.itemId, 'filed'], [b.itemId, 'keep-staged']]);
  assert.strictEqual(first.json.items[0].backfillId, a.itemId);
  assert.strictEqual(first.json.items[1].backfillSource, BUNDLED);
  assert.ok(!('backfillSource' in first.json.items[0]));
  const resumed = list({ ...fx, consoleJson: first.json });
  assert.strictEqual(resumed.length, 1);
  assert.strictEqual(resumed[0].itemId, b.itemId);
  const second = apply({ ...fx, consoleJson: first.json }, [entry(resumed[0], 'dropped', 'tiebreak', 'refuted: the guard reads the fresh value')]);
  assert.deepStrictEqual(second.json.items.map((i) => [i.id, i.resolution]), [[a.itemId, 'filed'], [b.itemId, 'dropped']]);
  assert.strictEqual(second.acknowledged, true);
});

test('apply: rewriting one bundle member writes every sibling once', () => {
  const stored = [APPROVED('docs:before'), KEEP(oldId(ALPHA)), KEEP(oldId(ALPHA)), KEEP(oldId(ALPHA)), APPROVED('docs:after')];
  const fx = fixture(tmpRun(), stored, [ALPHA, BETA]);
  const items = list(fx);
  assert.strictEqual(items.length, 2);
  const r = apply(fx, [entry(items[1])]);
  const ids = r.json.items.map((i) => i.id);
  assert.deepStrictEqual(ids, ['docs:before', items[0].itemId, items[1].itemId, 'docs:after']);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.deepStrictEqual(r.json.items[1], {
    id: items[0].itemId,
    section: LOW,
    resolution: 'keep-staged',
    reason: stored[1].reason,
    backfillSource: ALPHA,
    backfillFinding: { lens: '3c', path: 'plugin/bin/lib/console/alpha.js', line: 10, claimText: items[0].claimText },
  });
  assert.strictEqual(r.json.items[2].resolution, 'digested');
  assert.strictEqual(r.json.items[0], stored[0]);
  assert.strictEqual(r.json.items[3], stored[4]);
});

// I1: what a persisted sibling re-lists as never depends on re-deriving it from its line.
const MIXED = '- STAGED 10:30:00 — Reproduction: lens "3c" findings plugin/bin/a.js:1 (single agent) / plugin/bin/b.js:2 the writer skips its atomic rename step. Staged to Review Console as low-confidence.';
const listed = (w) => ({
  itemId: w.itemId, kind: w.kind, noClaimReason: w.noClaimReason, finding: w.finding, claimText: w.claimText,
});

test('I1: a persisted split sibling carries its finding and re-lists identically after a heuristic change', () => {
  const fx = fixture(tmpRun(), [KEEP(newId(BUNDLED))], [BUNDLED]);
  const [a, b] = list(fx);
  const first = apply(fx, [entry(a, 'filed', 'tiebreak', '#4002')]);
  assert.deepStrictEqual(first.json.items[1].backfillFinding, { lens: '3f', path: 'pr-check-gate-conformance.test.js', line: 77, claimText: b.claimText });
  // The split heuristics changed since: the persisted line now splits differently (simulated by a source
  // line whose text no longer yields this id), yet the sibling lists as it was persisted.
  const drifted = { ...first.json, items: first.json.items.map((s, i) => (i === 1 ? { ...s, backfillSource: BUNDLED.replace('pr-check-gate-conformance.test.js:77', 'pr-check-gate-conformance.test.js:78') } : s)) };
  const [again] = list({ ...fx, consoleJson: drifted });
  assert.deepStrictEqual(listed(again), listed(b));
  // The claim the line now yields differs from the persisted one: the persisted one wins.
  const planted = { ...first.json, items: first.json.items.map((s, i) => (i === 1 ? { ...s, backfillFinding: { ...s.backfillFinding, claimText: 'the claim as an earlier cleaner left it, high' } } : s)) };
  const [kept] = list({ ...fx, consoleJson: planted });
  assert.strictEqual(kept.itemId, b.itemId);
  assert.strictEqual(kept.claimText, 'the claim as an earlier cleaner left it, high');
  assert.strictEqual(kept.finding.reporterSeverity, 'high', 'the severity is read from the persisted claim');

  // A claim-empty sibling persists with an empty claim and re-lists as no-claim at its location.
  const mfx = fixture(tmpRun(), [KEEP(newId(MIXED))], [MIXED]);
  const [empty, claimed] = list(mfx);
  const settled = apply(mfx, [entry(claimed, 'filed', 'tiebreak', '#4003')]);
  assert.deepStrictEqual(settled.json.items[0].backfillFinding, { lens: '3c', path: 'plugin/bin/a.js', line: 1, claimText: '' });
  const [relisted] = list({ ...mfx, consoleJson: { ...settled.json, items: settled.json.items.map((s, i) => (i === 0 ? { ...s, backfillSource: 'a line that no longer exists' } : s)) } });
  assert.deepStrictEqual(listed(relisted), listed(empty));
});

test('a group with no source line collapses to one entry that keeps its old id', () => {
  const lost = 'decision:STAGED 09:00:00 — no such line was ever logged here at all';
  const fx = fixture(tmpRun(), [KEEP(lost), KEEP(lost)], [SINGLE]);
  const [item] = list(fx);
  assert.strictEqual(item.noClaimReason, 'source-line-not-found');
  const r = apply(fx, [entry(item)]);
  assert.strictEqual(r.json.items.length, 1);
  assert.strictEqual(r.json.items[0].id, lost);
  assert.strictEqual(r.json.items[0].backfillId, item.itemId);
  assert.ok(!('backfillSource' in r.json.items[0]));
});

test('refusals are named and write nothing', () => {
  const fx = fixture(tmpRun(), [PENDING('zz-1.md'), PENDING('zz-2.md')]);
  const [item, other] = list(fx);
  const cases = [
    [[{ ...entry(item), outcome: 'pending' }], ['bad-outcome']],
    [[{ ...entry(item), outcome: 'keep-staged' }], ['bad-outcome']],
    [[{ ...entry(item), outcome: 'approve' }], ['bad-outcome']],
    [[{ ...entry(item), source: 'human' }], ['bad-source']],
    [[entry(item, 'filed', 'tiebreak', '12')], ['missing-ref']],
    [[{ ...entry(item), ref: '' }], ['missing-ref']],
    [[entry(item), entry(item, 'dropped', 'tiebreak', 'refuted')], ['duplicate-entry', 'duplicate-entry']],
    [[{ ...entry(item), itemHash: '0'.repeat(64) }], ['stale-hash']],
    [[{ ...entry(other), itemId: 'bf:0000000000000000' }], ['unknown-item']],
  ];
  for (const [entries, reasons] of cases) {
    const r = apply(fx, entries);
    assert.strictEqual(r.json, null, JSON.stringify(entries));
    assert.deepStrictEqual(r.applied, []);
    assert.deepStrictEqual(r.refused.map((x) => x.reason), reasons);
  }
  assert.strictEqual(entryProblem(null), 'malformed');
  assert.strictEqual(entryProblem({ outcome: 'filed', source: 'tiebreak', ref: '#1' }), 'malformed');
  assert.strictEqual(entryProblem(entry(item, 'filed', 'tiebreak', '#12')), null);
});

test('minor 3: an id both an old-shape and a new-shape group list is refused as ambiguous-item, never applied', () => {
  const fx = fixture(tmpRun(), [KEEP(oldId(SINGLE)), KEEP(newId(SINGLE))], [SINGLE]);
  const items = list(fx);
  assert.strictEqual(items.length, 2, 'precondition: both groups list the line');
  assert.strictEqual(items[0].itemId, items[1].itemId, 'precondition: under one id');
  const r = apply(fx, [entry(items[0])]);
  assert.strictEqual(r.json, null, 'no group is rewritten');
  assert.deepStrictEqual(r.applied, []);
  assert.deepStrictEqual(r.refused, [{ itemId: items[0].itemId, reason: 'ambiguous-item' }]);
  // Orthogonal: one group alone applies.
  const single = fixture(tmpRun(), [KEEP(newId(SINGLE))], [SINGLE]);
  assert.deepStrictEqual(apply(single, [entry(list(single)[0])]).refused, []);
});

test('minor 4: a fully settled written console lists nothing', () => {
  const fx = fixture(tmpRun(), [KEEP(newId(BUNDLED)), PENDING('zz-1.md'), KEEP(oldId(ALPHA))], [BUNDLED, ALPHA, BETA]);
  const r = apply(fx, list(fx).map((i) => entry(i)));
  assert.deepStrictEqual(r.refused, []);
  assert.deepStrictEqual(consoleWorkItems({ ...fx, consoleJson: JSON.parse(JSON.stringify(r.json)) }), []);
});

test('minor 4: re-applying a settled split entry is a no-op', () => {
  const fx = fixture(tmpRun(), [KEEP(newId(BUNDLED))], [BUNDLED]);
  const [a] = list(fx);
  const settledA = entry(a, 'filed', 'tiebreak', '#4002');
  const first = apply(fx, [settledA]);
  const second = apply({ ...fx, consoleJson: first.json }, [settledA]);
  assert.strictEqual(second.json, null);
  assert.deepStrictEqual(second.applied, []);
  assert.deepStrictEqual(second.refused, [{ itemId: a.itemId, reason: 'already-settled' }]);
});

test('an existing acknowledgement is kept', () => {
  const earlier = '2026-10-21T00:00:00.000Z';
  const fx = fixture(tmpRun(), [PENDING('zz-1.md')], [], { residueAcknowledgedAt: earlier });
  const [item] = list(fx);
  const r = apply(fx, [entry(item)]);
  assert.strictEqual(r.json.residueAcknowledgedAt, earlier);
  assert.strictEqual(r.acknowledged, false);
});

test('the backfill result reads back through the residue reader', () => {
  const fx = fixture(tmpRun(), [KEEP(newId(BUNDLED)), PENDING('zz-1.md'), KEEP(oldId(ALPHA))], [BUNDLED, ALPHA, BETA]);
  const items = list(fx);
  assert.strictEqual(items.length, 5);
  const r = apply(fx, items.map((i) => entry(i)));
  assert.deepStrictEqual(r.refused, []);
  assert.deepStrictEqual(unresolvedItems(r.json), []);
  assert.strictEqual(r.json.items.length, 5);
});
