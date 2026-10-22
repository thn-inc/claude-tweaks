'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MOD = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'console', 'resolve');
const { classifyStagedItem, resolveAll, SECTION_STANCES, SECTION_MAP, ENGINE_ROW_SECTIONS, CANONICAL_PREFIXES, nearestCanonicalPrefixes, STAGING_EXEMPTIONS, stagingExemption } = require(MOD);
const ROOT = path.join(__dirname, '..', '..', '..');
const { unresolvedItems } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'residue'));
const { resolveTiebreak } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'tiebreak'));
const { formatEntry } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'log-decision', 'append'));

function fixture({
  decisions = '', staged = {}, engineState = null, pack = null, headers = [], manifest = null, specHeaders = {},
} = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-resolve-'));
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), decisions);
  for (const [name, body] of Object.entries(staged)) fs.writeFileSync(path.join(runDir, 'staged', name), body);
  if (engineState) fs.writeFileSync(path.join(runDir, 'engine-state.json'), JSON.stringify(engineState));
  if (pack) fs.writeFileSync(path.join(runDir, 'wrap-up-pack.json'), JSON.stringify(pack));
  for (const n of headers) fs.writeFileSync(path.join(runDir, 'work', `${n}-spec.md`), `---\nrecord: ${n}\n---\n`);
  if (manifest) fs.writeFileSync(path.join(runDir, 'manifest.yml'), manifest);
  for (const [specId, nums] of Object.entries(specHeaders)) {
    const specWork = path.join(runDir, `spec-${specId}`, 'work');
    fs.mkdirSync(specWork, { recursive: true });
    for (const n of nums) fs.writeFileSync(path.join(specWork, `${n}-spec.md`), `---\nrecord: ${n}\n---\n`);
  }
  return runDir;
}

const PATCH = 'Target: src/a.js\nInvariant: the guard runs before the read\nFinding: medium error-handling — x\nStaged-at: abc123\nLedger: docs/plans/x-ledger.md#4\n\ndiff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-a\n+b\n';

function deps(overrides = {}) {
  return {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
    gitApplyCheck: () => ({ ok: true }),
    readGrants: (numbers) => Object.fromEntries(numbers.map((n) => [n, { labels: ['auto:merge'], pendingSince: null }])),
    now: () => Date.parse('2026-09-06T12:00:00Z'),
    ...overrides,
  };
}

const EVERY_SECTION = {
  'review-2.patch': PATCH,
  'review-unconfirmed-3.md': 'unconfirmed',
  'review-contested-4.md': 'contested',
  'polish-suggestion-1.md': 'polish',
  'sdd-ruling-1.md': 'Title: ruling\nKind: sdd-ruling\nRuling: Task 2: Ruling: keep the guard — cheaper than the alternative — costs a re-read if wrong\nStaged-at: abc123\nLedger: docs/plans/x-ledger.md#5\n\nratify / reverse\n',
  'wrap-up-skill-1.md': 'skill',
  'wrap-up-doc-1.md': 'doc',
  'wrap-up-claude-md-1.md': 'claude-md',
  'wrap-up-adr-1.md': 'adr',
  'wrap-up-journey-1.md': 'journey',
  'tidy-claude-md-rule-1.md': 'rule',
  'reflect-1.md': 'reflect',
  'wrap-up-memory-1.md': 'memory',
  'wrap-up-upstream-1.md': 'upstream',
  'wrap-up-reflect-insights.md': 'insights',
  'mystery-9.md': 'unmapped',
};

test('classifyStagedItem maps every known prefix to its console section and unknown prefixes to Pending review/unmapped-prefix (#1932)', () => {
  const expect = {
    'review-2.patch': 'Pending review', 'test-fix-1.patch': 'Pending review', 'deepen-collapse-1.patch': 'Pending review', 'simplify-1.patch': 'Pending review',
    'review-unconfirmed-3.md': 'Low-confidence findings', 'review-contested-4.md': 'Contested findings', 'review-debate-1.md': 'Contested findings',
    'polish-suggestion-1.md': 'Pending review', 'visual-review-skipped.md': 'Pending review', 'design-decision-2.md': 'Pending review', 'build-deviation-1.md': 'Pending review', 'sdd-ruling-1.md': 'Pending review',
    'wrap-up-skill-1.md': 'Skill updates', 'wrap-up-skill-new-auth.md': 'Skill updates', 'wrap-up-skill-restructure.md': 'Skill updates',
    'wrap-up-doc-1.md': 'Documentation updates', 'tidy-doc-1.md': 'Documentation updates',
    'wrap-up-claude-md-1.md': 'Configuration updates', 'wrap-up-adr-1.md': 'Configuration updates',
    'wrap-up-journey-1.md': 'Journey updates', 'journeys-convention.md': 'Journey updates',
    'tidy-claude-md-rule-1.md': 'Queue writes',
    'reflect-1.md': 'Queue writes', 'digest-promotion-1.md': 'Queue writes', 'leftover-add-oauth.md': 'Queue writes', 'ledger-record-1.md': 'Queue writes', 'ledger-record-sdd-ruling-1.md': 'Queue writes',
    'upstream-unfiled-1.md': 'Queue writes', 'red-team-1.md': 'Queue writes', 'specify-overlap-1.md': 'Queue writes', 'flaky-allowlist-x.md': 'Queue writes',
    'tidy-parked-1.md': 'Queue writes', 'plan-retention-1.md': 'Queue writes', 'feedback-drafts.md': 'Queue writes',
    'wrap-up-memory-1.md': 'Memory updates', 'wrap-up-upstream-1.md': 'Upstream feedback',
    'wrap-up-reflect-insights.md': 'Reflection insights',
  };
  for (const [name, section] of Object.entries(expect)) {
    assert.strictEqual(classifyStagedItem(name).section, section, name);
    assert.strictEqual(classifyStagedItem(name).reason, undefined, `${name} is mapped`);
  }
  assert.deepStrictEqual(classifyStagedItem('mystery-9.md'), { section: 'Pending review', reason: 'unmapped-prefix' });
  // release-backfill- retired #2257 (the staged-backfill mechanism is gone —
  // nothing stages that prefix anymore) — a stray one now falls through to
  // the generic unmapped-prefix path, same as any other unrecognized prefix.
  assert.deepStrictEqual(classifyStagedItem('release-backfill-v6.md'), { section: 'Pending review', reason: 'unmapped-prefix' });
  assert.deepStrictEqual(classifyStagedItem('wrap-up-memory-1.md.shadow-dup'), { section: 'Pending review', reason: 'shadow-dup-collision' }, 'a sweep-shadow copy is never its original\'s section');
  assert.deepStrictEqual(classifyStagedItem('review-2.patch.shadow-dup-2'), { section: 'Pending review', reason: 'shadow-dup-collision' });
  assert.ok(Array.isArray(SECTION_MAP) && SECTION_MAP.length > 10);
});

test('resolveAll resolves one item per section per the short-circuit stances and merges absent carve-outs (#1932 AC2)', () => {
  const runDir = fixture({ staged: EVERY_SECTION, headers: [7] });
  const r = resolveAll({ runDir, policy: 'console-auto', deps: deps() });
  const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.strictEqual(by['review-2.patch'].resolution, 'apply');
  assert.strictEqual(by['review-unconfirmed-3.md'].resolution, 'keep-staged');
  assert.strictEqual(by['review-contested-4.md'].resolution, 'keep-staged');
  assert.strictEqual(by['polish-suggestion-1.md'].resolution, 'apply');
  assert.strictEqual(by['sdd-ruling-1.md'].resolution, 'apply');
  assert.strictEqual(by['wrap-up-skill-1.md'].resolution, 'approve');
  assert.strictEqual(by['wrap-up-doc-1.md'].resolution, 'approve');
  assert.strictEqual(by['wrap-up-claude-md-1.md'].resolution, 'approve');
  assert.strictEqual(by['wrap-up-adr-1.md'].resolution, 'approve');
  assert.strictEqual(by['wrap-up-journey-1.md'].resolution, 'approve');
  assert.strictEqual(by['tidy-claude-md-rule-1.md'].resolution, 'apply');
  assert.strictEqual(by['reflect-1.md'].resolution, 'apply');
  assert.strictEqual(by['wrap-up-memory-1.md'].resolution, 'apply');
  assert.strictEqual(by['wrap-up-upstream-1.md'].resolution, 'filed');
  assert.strictEqual(by['wrap-up-reflect-insights.md'].resolution, 'approve');
  assert.strictEqual(by['wrap-up-reflect-insights.md'].reason, SECTION_STANCES['Reflection insights'].reason);
  assert.deepStrictEqual({ resolution: by['mystery-9.md'].resolution, reason: by['mystery-9.md'].reason }, { resolution: 'pending', reason: 'unmapped-prefix' });
  assert.strictEqual(r.sections.cleanup.resolution, 'approve');
  assert.deepStrictEqual(r.merge, { resolution: 'merge', reason: 'every member carries auto:merge or a matured auto:merge-pending; no needs-human verdict' });
  assert.strictEqual(r.items.length, Object.keys(EVERY_SECTION).length);
  assert.strictEqual(r.ceiling, 'unattended');
});

test('a run whose only staged file is wrap-up-reflect-insights.md resolves with nothing under Needs a human (#3926 AC2)', () => {
  const r = resolveAll({ runDir: fixture({ staged: { 'wrap-up-reflect-insights.md': 'table' }, headers: [7] }), policy: 'console-auto', deps: deps() });
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].section, 'Reflection insights');
  assert.deepStrictEqual(unresolvedItems({ items: r.items }), []);
});

test('a .shadow-dup file is classified duplicate when byte-identical to its anchor, divergent otherwise, and falls back to shadow-dup-collision with no anchor to compare (#2773)', () => {
  assert.deepStrictEqual(
    classifyStagedItem('build-deviation-1.md.shadow-dup', 'same text', 'same text'),
    { section: 'Pending review', reason: 'shadow-dup-duplicate' },
  );
  assert.deepStrictEqual(
    classifyStagedItem('build-deviation-2.md.shadow-dup', 'shadow text', 'anchor text'),
    { section: 'Pending review', reason: 'shadow-dup-divergent' },
  );
  // No sibling supplied at all — the pre-existing conservative fallback,
  // unchanged for callers that don't (or can't) supply anchor text.
  assert.deepStrictEqual(
    classifyStagedItem('wrap-up-memory-1.md.shadow-dup', 'x'),
    { section: 'Pending review', reason: 'shadow-dup-collision' },
  );
  assert.deepStrictEqual(
    classifyStagedItem('review-2.patch.shadow-dup-2'),
    { section: 'Pending review', reason: 'shadow-dup-collision' },
  );
  // The shadow-dup file's own text unreadable (null) while the anchor's text IS
  // readable falls back to shadow-dup-collision too — not shadow-dup-divergent.
  // A naive `text === siblingText` check with no guard on `text` would report
  // `null === 'anchor text'` as divergent, which is wrong: "can't tell" because
  // this side couldn't be read is a different outcome from "confirmed different."
  assert.deepStrictEqual(
    classifyStagedItem('build-deviation-3.md.shadow-dup', null, 'anchor text'),
    { section: 'Pending review', reason: 'shadow-dup-collision' },
  );

  // End-to-end via resolveAll: one byte-identical pair, one divergent pair,
  // in the same run — two distinguishable reasons, same resolution.
  const runDir = fixture({
    staged: {
      'build-deviation-1.md': 'identical content',
      'build-deviation-1.md.shadow-dup': 'identical content',
      'build-deviation-2.md': 'original content',
      'build-deviation-2.md.shadow-dup': 'different content — recovered from a clobbering write',
    },
    headers: [7],
  });
  const r = resolveAll({ runDir, policy: 'console-auto', deps: deps() });
  const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.strictEqual(by['build-deviation-1.md.shadow-dup'].reason, 'shadow-dup-duplicate');
  assert.strictEqual(by['build-deviation-2.md.shadow-dup'].reason, 'shadow-dup-divergent');
  assert.strictEqual(by['build-deviation-1.md.shadow-dup'].resolution, 'pending');
  assert.strictEqual(by['build-deviation-2.md.shadow-dup'].resolution, 'pending');
  // The anchors themselves are unaffected — still plain Pending review items.
  assert.strictEqual(by['build-deviation-1.md'].resolution, 'apply');
});

test('every registry row whose own judge file documents a literal staged/{prefix}-{n} naming convention resolves through SECTION_MAP, into that row\'s own ENGINE_ROW_SECTIONS section when one exists (#2773)', () => {
  const { REGISTRY } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'wrap-up', 'registry'));
  const SKILLS_DIR = path.join(ROOT, 'plugin', 'skills', 'wrap-up');
  const PREFIX_RE = /staged\/([a-zA-Z][a-zA-Z0-9-]*-)\{[nN]\}/;
  const checkedIds = [];
  for (const row of REGISTRY) {
    const judgeText = fs.readFileSync(path.join(SKILLS_DIR, row.judge), 'utf8');
    const m = PREFIX_RE.exec(judgeText);
    if (!m) continue; // this row's judge documents no standalone staged-file naming convention — nothing to audit for it
    checkedIds.push(row.id);
    const prefix = m[1];
    const result = classifyStagedItem(`${prefix}1.md`);
    assert.notStrictEqual(result.reason, 'unmapped-prefix', `${row.id}'s documented prefix "${prefix}" has no SECTION_MAP row`);
    const expectedSection = ENGINE_ROW_SECTIONS[row.id];
    if (expectedSection) {
      assert.strictEqual(result.section, expectedSection, `${row.id}'s staged prefix "${prefix}" must classify into its own ENGINE_ROW_SECTIONS section`);
    }
  }
  // Pin the exact set of rows this scan is expected to find a literal convention in today —
  // a loose `checked >= 3` floor would still pass if a row's naming line regressed out of the
  // scan (exactly the kind of drift #2773 fixed), as long as 3 others still matched.
  assert.deepStrictEqual(checkedIds.sort(), ['claude-md', 'decision-records', 'journeys', 'memory', 'skills', 'upstream'], 'the set of registry rows documenting a literal staged/{prefix}-{n} convention changed — update this list deliberately, don\'t let it silently narrow');
});

test('a staged item named on a REFUSED line in decisions.md resolves to refused, never its section stance (#1932 I2)', () => {
  const decisions = '## /wrap-up\n- REFUSED 10:00:00 — Queue write Q1: no valid Defer-reason on staged/leftover-x.md; kept staged.\n';
  const r = resolveAll({ runDir: fixture({ decisions, staged: { 'leftover-x.md': 'x', 'leftover-y.md': 'y' }, headers: [7] }), policy: 'console-auto', deps: deps() });
  const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.strictEqual(by['leftover-x.md'].section, 'Refused — no defer reason');
  assert.strictEqual(by['leftover-x.md'].resolution, 'refused');
  assert.match(by['leftover-x.md'].reason, /excluded from Approve all and from consoleAutoResolve/);
  assert.strictEqual(by['leftover-y.md'].resolution, 'apply', 'an unrefused sibling keeps its Queue writes stance');
});

test('a Category: observation/convention reflect finding never resolves to Queue writes/apply, but Category: tangential still does (#2473)', () => {
  const observation = '# Reflect — staged finding 1\n\n**Category:** observation\n**Severity:** low\n**Reversibility:** high\n**Source:** full mode, lens "Near-misses"\n**Files:** general (test suite infrastructure)\n\n## Finding\n\nSome observation with no Title:/Type:/Labels: header.\n';
  const convention = '# Reflect — staged finding 2\n\n**Category:** convention\n**Severity:** low\n**Reversibility:** high\n**Source:** full mode, lens "Approach"\n**Files:** general\n\n## Finding\n\nA convention-drift finding.\n';
  const tangential = 'Title: Some backlog idea\nType: task\nLabels: none\nDefer-reason: tangential\n\n# Reflect — staged finding 3\n\n**Category:** tangential\n\n## Current State\n\nx\n\n## Deliverables\n\n- [ ] y\n\n## Acceptance Criteria\n\n1. z\n';

  assert.strictEqual(classifyStagedItem('reflect-1.md', observation).section, 'Pending review');
  assert.strictEqual(classifyStagedItem('reflect-1.md', observation).reason, 'non-tangential-category:observation');
  assert.strictEqual(classifyStagedItem('reflect-2.md', convention).reason, 'non-tangential-category:convention');
  assert.deepStrictEqual(classifyStagedItem('reflect-3.md', tangential), { section: 'Queue writes' });

  const r = resolveAll({
    runDir: fixture({ staged: { 'reflect-1.md': observation, 'reflect-2.md': convention, 'reflect-3.md': tangential }, headers: [7] }),
    policy: 'console-auto',
    deps: deps(),
  });
  const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.strictEqual(by['reflect-1.md'].section, 'Pending review');
  assert.strictEqual(by['reflect-1.md'].resolution, 'pending');
  assert.strictEqual(by['reflect-2.md'].section, 'Pending review');
  assert.strictEqual(by['reflect-2.md'].resolution, 'pending');
  assert.strictEqual(by['reflect-3.md'].section, 'Queue writes', 'a genuine tangential finding still classifies into Queue writes');
  assert.strictEqual(by['reflect-3.md'].resolution, 'apply', 'a genuine tangential finding still auto-resolves to apply, unchanged from today');
});

test('every ENGINE_ROW_SECTIONS row classifies a staged finding into its own console section (#1932 M9)', () => {
  const rows = { skills: 'Skill updates', docs: 'Documentation updates', journeys: 'Journey updates', 'claude-md': 'Configuration updates', 'decision-records': 'Configuration updates', references: 'Reference repairs' };
  const results = {};
  for (const rowId of Object.keys(rows)) results[rowId] = { result: 'findings', findings: [{ target: `t/${rowId}.md`, action: 'staged' }] };
  const r = resolveAll({ runDir: fixture({ engineState: { results }, headers: [7] }), policy: 'console-auto', deps: deps() });
  for (const [rowId, section] of Object.entries(rows)) {
    const item = r.items.find((i) => i.id === `${rowId}:t/${rowId}.md`);
    assert.ok(item, `${rowId} produced an item`);
    assert.strictEqual(item.section, section, rowId);
    assert.strictEqual(item.resolution, SECTION_STANCES[section].resolution, rowId);
  }
  assert.strictEqual(r.items.length, Object.keys(rows).length);
});

test('renderTable escapes a pipe in the item id, not only in the reason (#1932 M6)', () => {
  const r = resolveAll({ runDir: fixture({ staged: { 'reflect-a|b.md': 'x' }, headers: [7] }), policy: 'console-auto', deps: deps() });
  assert.match(r.table, /reflect-a\\\|b\.md/);
});

test('a needs-human merge-check verdict in decisions.md resolves the merge half to leave-open (#1932 AC3)', () => {
  const decisions = '## /wrap-up\n- AUTO 12:00:00 — Auto-merge short-circuit: #7 assess-agent-autonomy verdict needs-human — Review Console renders normally. Reversibility: n/a.\n';
  const r = resolveAll({ runDir: fixture({ decisions, staged: { 'reflect-1.md': 'x' }, headers: [7] }), policy: 'console-auto', deps: deps() });
  assert.strictEqual(r.merge.resolution, 'leave-open');
  assert.match(r.merge.reason, /needs-human/);
});

test('an ungranted member (no auto:merge, no matured auto:merge-pending) resolves the merge half to leave-open (#1932 AC3)', () => {
  const grants = { 7: { labels: ['auto:merge'], pendingSince: null }, 8: { labels: ['auto:merge-pending'], pendingSince: new Date('2026-09-06T11:00:00Z') } };
  const r = resolveAll({ runDir: fixture({ staged: { 'reflect-1.md': 'x' }, headers: [7, 8] }), policy: 'console-auto', deps: deps({ readGrants: () => grants }) });
  assert.strictEqual(r.merge.resolution, 'leave-open');
  assert.match(r.merge.reason, /#8/);
  assert.match(r.merge.reason, /veto window/);
});

test('an unmatured grant names the untrusted marker comments ghReadGrants passed over in the merge reason (#3358)', () => {
  const note = 'skipped marker comment https://x/issues/7#c1 by eve (NONE) — not an owner, member, or collaborator';
  const grants = { 7: { labels: ['auto:merge-pending'], pendingSince: null, skippedUntrusted: [note] } };
  const r = resolveAll({ runDir: fixture({ staged: { 'reflect-1.md': 'x' }, headers: [7] }), policy: 'console-auto', deps: deps({ readGrants: () => grants }) });
  assert.strictEqual(r.merge.resolution, 'leave-open');
  assert.ok(r.merge.reason.endsWith(` — ${note}`), r.merge.reason);
  assert.match(r.table, new RegExp(`Merge: \\*\\*leave-open\\*\\*.*${note.slice(0, 30)}`), 'the note reaches the rendered table');
});

test('an unmatured grant with no passed-over comment keeps the merge reason unchanged (#3358 characterization)', () => {
  const grants = { 7: { labels: ['auto:merge-pending'], pendingSince: null, skippedUntrusted: [] } };
  const r = resolveAll({ runDir: fixture({ staged: { 'reflect-1.md': 'x' }, headers: [7] }), policy: 'console-auto', deps: deps({ readGrants: () => grants }) });
  assert.ok(r.merge.reason.endsWith('treated as not yet matured)'), r.merge.reason);
});

test('a matured auto:merge-pending counts as granted (#1932 AC3)', () => {
  const grants = { 7: { labels: ['auto:merge-pending'], pendingSince: new Date('2026-09-01T00:00:00Z') } };
  const r = resolveAll({ runDir: fixture({ staged: { 'reflect-1.md': 'x' }, headers: [7] }), policy: 'console-auto', deps: deps({ readGrants: () => grants }) });
  assert.strictEqual(r.merge.resolution, 'merge');
});

test('readGrants throwing resolves the merge half to leave-open with reason grants-unreadable (#1932 AC3)', () => {
  const r = resolveAll({ runDir: fixture({ staged: { 'reflect-1.md': 'x' }, headers: [7] }), policy: 'console-auto', deps: deps({ readGrants: () => { throw new Error('gh: not found'); } }) });
  assert.deepStrictEqual(r.merge, { resolution: 'leave-open', reason: 'grants-unreadable' });
});

test('a live drain-overlap hold (overlapping PR still OPEN) resolves the merge half to leave-open, even with auto:merge granted (#2299)', () => {
  const decisions = '## /dispatch\n- AUTO 09:00:00 — Auto-merge gate: group [7] held — overlaps drain PR #4001 on src/a.js; merge order is a human call. Reversibility: n/a.\n';
  const calls = [];
  const r = resolveAll({
    runDir: fixture({ decisions, staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: (n) => { calls.push(n); return 'OPEN'; } }),
  });
  assert.deepStrictEqual(calls, [4001]);
  assert.strictEqual(r.merge.resolution, 'leave-open');
  assert.match(r.merge.reason, /drain-overlap hold/);
  assert.match(r.merge.reason, /#4001/);
});

test('a drain-overlap hold whose PR has since merged self-heals: falls through to the ordinary grant check (#2299)', () => {
  const decisions = '## /dispatch\n- AUTO 09:00:00 — Auto-merge gate: group [7] held — overlaps drain PR #4001 on src/a.js; merge order is a human call. Reversibility: n/a.\n';
  const r = resolveAll({
    runDir: fixture({ decisions, staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: () => 'MERGED' }),
  });
  assert.deepStrictEqual(r.merge, { resolution: 'merge', reason: 'every member carries auto:merge or a matured auto:merge-pending; no needs-human verdict' });
});

test('a drain-overlap hold whose PR has since closed self-heals the same as merged (#2299)', () => {
  const decisions = '## /dispatch\n- AUTO 09:00:00 — Auto-merge gate: group [7] held — overlaps drain PR #4001 on src/a.js; merge order is a human call. Reversibility: n/a.\n';
  const r = resolveAll({
    runDir: fixture({ decisions, staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: () => 'CLOSED' }),
  });
  assert.strictEqual(r.merge.resolution, 'merge');
});

test('checkPrState failing on a drain-overlap hold fails closed to leave-open, same posture as grants-unreadable (#2299)', () => {
  const decisions = '## /dispatch\n- AUTO 09:00:00 — Auto-merge gate: group [7] held — overlaps drain PR #4001 on src/a.js; merge order is a human call. Reversibility: n/a.\n';
  const r = resolveAll({
    runDir: fixture({ decisions, staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: () => { throw new Error('gh: rate limited'); } }),
  });
  assert.strictEqual(r.merge.resolution, 'leave-open');
  assert.match(r.merge.reason, /drain-overlap hold/);
  assert.match(r.merge.reason, /gh: rate limited/);
});

test('a needs-human verdict still takes precedence over a live drain-overlap hold (#2299)', () => {
  const decisions = '## /wrap-up\n- AUTO 08:00:00 — Auto-merge short-circuit: #7 assess-agent-autonomy verdict needs-human — Review Console renders normally. Reversibility: n/a.\n## /dispatch\n- AUTO 09:00:00 — Auto-merge gate: group [7] held — overlaps drain PR #4001 on src/a.js; merge order is a human call. Reversibility: n/a.\n';
  const r = resolveAll({
    runDir: fixture({ decisions, staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: () => { throw new Error('should never be called'); } }),
  });
  assert.strictEqual(r.merge.resolution, 'leave-open');
  assert.match(r.merge.reason, /needs-human/);
});

test('a drain-overlap hold whose checkPrState returns an unrecognized value fails closed to leave-open (final review Important #2)', () => {
  const decisions = '## /dispatch\n- AUTO 09:00:00 — Auto-merge gate: group [7] held — overlaps drain PR #4001 on src/a.js; merge order is a human call. Reversibility: n/a.\n';
  const r = resolveAll({
    runDir: fixture({ decisions, staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: () => 'UNKNOWN' }),
  });
  assert.strictEqual(r.merge.resolution, 'leave-open');
  assert.match(r.merge.reason, /drain-overlap hold/);
  assert.match(r.merge.reason, /unrecognized state/);
  assert.match(r.merge.reason, /UNKNOWN/);
});

test('a drain-overlap hold whose checkPrState returns undefined fails closed to leave-open (final review Important #2)', () => {
  const decisions = '## /dispatch\n- AUTO 09:00:00 — Auto-merge gate: group [7] held — overlaps drain PR #4001 on src/a.js; merge order is a human call. Reversibility: n/a.\n';
  const r = resolveAll({
    runDir: fixture({ decisions, staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: () => undefined }),
  });
  assert.strictEqual(r.merge.resolution, 'leave-open');
  assert.match(r.merge.reason, /unrecognized state/);
  assert.match(r.merge.reason, /undefined/);
});

test('a group held by two distinct overlapping drain PRs leaves open while either is still OPEN, even if the other has merged (final review Important #3)', () => {
  const decisions = '## /dispatch\n'
    + '- AUTO 09:00:00 — Auto-merge gate: group [7] held — overlaps drain PR #4001 on src/a.js; merge order is a human call. Reversibility: n/a.\n'
    + '- AUTO 09:05:00 — Auto-merge gate: group [7] held — overlaps drain PR #4002 on src/b.js; merge order is a human call. Reversibility: n/a.\n';
  const states = { 4001: 'MERGED', 4002: 'OPEN' };
  const calls = [];
  const r = resolveAll({
    runDir: fixture({ decisions, staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: (n) => { calls.push(n); return states[n]; } }),
  });
  assert.deepStrictEqual(calls, [4001, 4002]);
  assert.strictEqual(r.merge.resolution, 'leave-open');
  assert.match(r.merge.reason, /#4002/);
});

test('a group held by two distinct overlapping drain PRs falls through to merge once BOTH are confirmed merged/closed (final review Important #3)', () => {
  const decisions = '## /dispatch\n'
    + '- AUTO 09:00:00 — Auto-merge gate: group [7] held — overlaps drain PR #4001 on src/a.js; merge order is a human call. Reversibility: n/a.\n'
    + '- AUTO 09:05:00 — Auto-merge gate: group [7] held — overlaps drain PR #4002 on src/b.js; merge order is a human call. Reversibility: n/a.\n';
  const states = { 4001: 'MERGED', 4002: 'CLOSED' };
  const calls = [];
  const r = resolveAll({
    runDir: fixture({ decisions, staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: (n) => { calls.push(n); return states[n]; } }),
  });
  assert.deepStrictEqual(calls, [4001, 4002]);
  assert.deepStrictEqual(r.merge, { resolution: 'merge', reason: 'every member carries auto:merge or a matured auto:merge-pending; no needs-human verdict' });
});

test('the regex matches PR number extraction from drain-pr-overlap.md\'s own Step 6 log-line template, instantiated with concrete values (final review Minor #4 — producer/consumer coupling)', () => {
  // Copied from plugin/skills/dispatch/drain-pr-overlap.md's Step 6 fenced block (the two
  // markdown lines join into one logged line; a future desync in that file is visible as a
  // diff against this copy, per parse-signal-discipline's producer/consumer coupling guidance):
  //   AUTO {time} — Auto-merge gate: group [{issues}] held — overlaps drain PR #{pr} on {files}; merge
  //   order is a human call. Reversibility: n/a.
  const TEMPLATE = 'AUTO {time} — Auto-merge gate: group [{issues}] held — overlaps drain PR #{pr} on {files}; merge order is a human call. Reversibility: n/a.';
  const instantiated = TEMPLATE
    .replace('{time}', '09:00:00')
    .replace('{issues}', '7')
    .replace('{pr}', '4001')
    .replace('{files}', 'src/a.js');
  const line = `- AUTO ${instantiated.slice('AUTO '.length)}`;
  const r = resolveAll({
    runDir: fixture({ decisions: `## /dispatch\n${line}\n`, staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: () => 'OPEN' }),
  });
  assert.strictEqual(r.merge.resolution, 'leave-open');
  assert.match(r.merge.reason, /#4001/);
});

test('the advisory-only line from Step 4 (no "held") never matches the hold regex, even after the case-insensitive/em-dash-tolerant loosening (final review Minor #5)', () => {
  const decisions = '## /dispatch\n- AUTO 08:55:00 — dispatch: group [7] overlaps drain PR #4001 on src/a.js; dispatched anyway, serialize before merge. Reversibility: n/a.\n';
  const r = resolveAll({
    runDir: fixture({ decisions, staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: () => { throw new Error('should never be called'); } }),
  });
  assert.strictEqual(r.merge.resolution, 'merge');
});

test('no drain-overlap hold line means checkPrState is never consulted (#2299)', () => {
  const r = resolveAll({
    runDir: fixture({ staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: () => { throw new Error('should never be called'); } }),
  });
  assert.strictEqual(r.merge.resolution, 'merge');
});

test('no resolvable members resolves the merge half to leave-open with reason members-unresolved (#1932 decision 2)', () => {
  const r = resolveAll({ runDir: fixture({ staged: { 'reflect-1.md': 'x' } }), policy: 'console-auto', deps: deps() });
  assert.deepStrictEqual(r.merge, { resolution: 'leave-open', reason: 'members-unresolved' });
});

test('members come from wrap-up-pack.json inputs.records when present (#1932 decision 2)', () => {
  const calls = [];
  const runDir = fixture({ staged: { 'reflect-1.md': 'x' }, pack: { inputs: { records: [41, 42] } }, headers: [7] });
  resolveAll({ runDir, policy: 'console-auto', deps: deps({ readGrants: (n) => { calls.push(n); return Object.fromEntries(n.map((x) => [x, { labels: ['auto:merge'], pendingSince: null }])); } }) });
  assert.deepStrictEqual(calls, [[41, 42]]);
});

test('a multi-spec parent run dir with no wrap-up-pack.json resolves members via manifest.yml + spec-*/work/ headers, never members-unresolved (#2028)', () => {
  const calls = [];
  const manifest = [
    'multispec:',
    '  parent: .claude-tweaks/pipelines/2026-09-11T143147-record-41-42/',
    '  specs:',
    '    - id: 41',
    '      status: complete',
    '      subdir: spec-41/',
    '    - id: 42',
    '      status: complete',
    '      subdir: spec-42/',
    '',
  ].join('\n');
  const runDir = fixture({
    staged: { 'reflect-1.md': 'x' },
    manifest,
    specHeaders: { 41: [41], 42: [42] },
  });
  const r = resolveAll({ runDir, policy: 'console-auto', deps: deps({ readGrants: (n) => { calls.push(n); return Object.fromEntries(n.map((x) => [x, { labels: ['auto:merge'], pendingSince: null }])); } }) });
  assert.deepStrictEqual(calls, [[41, 42]]);
  assert.notDeepStrictEqual(r.merge, { resolution: 'leave-open', reason: 'members-unresolved' });
});

test('a staged patch that fails git apply --check resolves to stale with its Invariant echoed, never apply (#1932 AC4)', () => {
  const r = resolveAll({ runDir: fixture({ staged: { 'review-2.patch': PATCH }, headers: [7] }), policy: 'console-auto', deps: deps({ gitApplyCheck: () => ({ ok: false, error: 'patch failed: src/a.js:1' }) }) });
  const item = r.items.find((i) => i.id === 'review-2.patch');
  assert.strictEqual(item.resolution, 'stale');
  assert.match(item.reason, /re-derive from Invariant: the guard runs before the read/);
});

test('a staged pair whose stacked verdict is ok resolves to apply though a per-patch check would fail the second (#3290 I1)', () => {
  const staged = { 'review-1.patch': PATCH, 'review-2.patch': PATCH };
  const solo = (p) => (path.basename(p) === 'review-2.patch' ? { ok: false, error: 'patch failed: src/a.js:1' } : { ok: true });
  const alone = resolveAll({ runDir: fixture({ staged, headers: [7] }), policy: 'console-auto', deps: deps({ gitApplyCheck: solo }) });
  assert.strictEqual(alone.items.find((i) => i.id === 'review-2.patch').resolution, 'stale');
  const seen = [];
  const checkPatchStack = (paths) => {
    seen.push(paths.map((p) => path.basename(p)));
    return Object.fromEntries(paths.map((p) => [path.basename(p), { ok: true }]));
  };
  const stacked = resolveAll({ runDir: fixture({ staged, headers: [7] }), policy: 'console-auto', deps: deps({ gitApplyCheck: solo, checkPatchStack }) });
  assert.deepStrictEqual(seen, [['review-1.patch', 'review-2.patch']]);
  for (const id of ['review-1.patch', 'review-2.patch']) {
    assert.strictEqual(stacked.items.find((i) => i.id === id).resolution, 'apply');
  }
});

test('engine-state.json staged findings classify into their curation sections; applied ones render as applied (#1932)', () => {
  const engineState = { results: { skills: { result: 'findings', findings: [{ target: 'auth', action: 'staged', stagePath: 'staged/wrap-up-skill-1.md' }] }, references: { result: 'findings', findings: [{ target: 'docs/a.md', action: 'applied', commit: 'abc1234' }] } } };
  const r = resolveAll({ runDir: fixture({ staged: { 'wrap-up-skill-1.md': 'skill' }, engineState, headers: [7] }), policy: 'console-auto', deps: deps() });
  const ref = r.items.find((i) => i.section === 'Reference repairs');
  assert.deepStrictEqual({ resolution: ref.resolution, id: ref.id }, { resolution: 'applied', id: 'references:docs/a.md' });
  assert.strictEqual(r.items.filter((i) => i.id === 'wrap-up-skill-1.md').length, 1, 'a staged engine finding and its staged file are one item');
});

test('engine findings take their console id from targetPath, fall back to the row target, and two findings on one row stay distinct (#3389)', () => {
  const engineState = { results: {
    skills: { result: 'findings', target: 'Skills', findings: [
      { targetPath: '.claude/skills/x/SKILL.md', action: 'applied', commit: 'abc1234', kind: 'update', summary: 's' },
      { targetPath: '.claude/skills/y/SKILL.md', action: 'applied', commit: 'def5678', kind: 'update', summary: 's' },
    ] },
    docs: { result: 'findings', target: 'Docs', findings: [
      { targetPath: 'docs/guide.md', action: 'staged', kind: 'update', summary: 's' },
      { targetPath: 'docs/both.md', target: 'docs/legacy.md', action: 'staged', kind: 'update', summary: 's' },
      { action: 'applied', commit: 'aaa0000', kind: 'update', summary: 's' },
    ] },
  } };
  const r = resolveAll({ runDir: fixture({ engineState, headers: [7] }), policy: 'console-auto', deps: deps() });
  const appliedSkillIds = r.items.filter((i) => i.section === 'Skill updates' && i.resolution === 'applied').map((i) => i.id);
  assert.deepStrictEqual(appliedSkillIds, ['skills:.claude/skills/x/SKILL.md', 'skills:.claude/skills/y/SKILL.md']);
  assert.ok(r.items.some((i) => i.id === 'docs:docs/guide.md'));
  assert.ok(r.items.some((i) => i.id === 'docs:docs/both.md'), 'targetPath wins when a finding also carries a legacy target');
  assert.ok(!r.items.some((i) => i.id === 'docs:docs/legacy.md'));
  assert.ok(r.items.some((i) => i.id === 'docs:Docs'), 'a finding with no targetPath falls back to the row target');
  assert.ok(!r.items.some((i) => /:undefined$/.test(i.id)));
});

test('decisions.md STAGED coordination entries render as Low-confidence / Contested items (#1932)', () => {
  const decisions = '## /review\n- STAGED 10:00:00 — Single-read (low tier): lens "3b" finding src/a.js:4 not directly verified. Staged to Review Console as low-confidence. Reversibility: high.\n- STAGED 10:00:01 — Cross-lens debate inconclusive on src/b.js:9: staged/review-contested-1.md. Reversibility: high.\n';
  const r = resolveAll({ runDir: fixture({ decisions, staged: { 'review-contested-1.md': 'c' }, headers: [7] }), policy: 'console-auto', deps: deps() });
  assert.ok(r.items.some((i) => i.section === 'Low-confidence findings' && i.resolution === 'keep-staged'));
  assert.strictEqual(r.items.filter((i) => i.section === 'Contested findings').length, 1, 'the staged file and its decisions line are one item');
});

// Excerpt shaped like run 2026-10-17T192303-spec-3412's decisions.md (#3772).
const SUPERSEDED = [
  '## /review',
  '- STAGED 23:44:20 — spec #3412 — Step 3 reproduction: Reproduction: lens "3a" finding plugin/bin/lib/reconcile/pr-state.js:158 not reproduced. Staged to Review Console as low-confidence. Reversibility: high.',
  '- AUTO 23:44:20 — spec #3412 — Step 3 reproduction: Reproduction: lens "3a" finding plugin/bin/lib/reconcile/pr-state.js:158 elevated via direct-verification override (comment sentence read independently). Confirmed, low. Reversibility: high.',
  '- STAGED 23:44:20 — spec #3412 — Step 3 reproduction: Reproduction: lens "3a" finding plugin/bin/lib/reconcile/release-merged.js:523 (agent A) and :61 (agent B, same substance) not reproduced at the same line. Staged to Review Console as low-confidence. Reversibility: high.',
  '- AUTO 23:44:20 — spec #3412 — Step 3 reproduction: Reproduction: lens "3a" finding plugin/bin/lib/reconcile/release-merged.js:523 elevated via direct-verification override (source read independently). Confirmed, low. Reversibility: high.',
  '- STAGED 23:44:20 — spec #3412 — Step 3 reproduction: Reproduction: lens "3a" finding plugin/bin/lib/reconcile/pr-state.js:39 not reproduced. Staged to Review Console as low-confidence — not elevated. Reversibility: high.',
  '',
].join('\n');
const lowItems = (decisions) => resolveAll({ runDir: fixture({ decisions, headers: [7] }), policy: 'console-auto', deps: deps() }).items.filter((i) => i.section === 'Low-confidence findings');

test('AC1.1: a STAGED low-confidence line followed by a same-lens, same path:line AUTO elevation produces no Low-confidence item (#3772)', () => {
  const low = lowItems(SUPERSEDED);
  assert.strictEqual(low.length, 1, 'the two confirmed lines are superseded; pr-state.js:39 stays');
  assert.strictEqual(low[0].id, `decision:${SUPERSEDED.split('\n')[5].slice(2, 60)}`, 'the survivor is the pr-state.js:39 line');
});

test('AC2.1: a STAGED low-confidence line with no later elevation still produces its keep-staged item (#3772)', () => {
  const only = SUPERSEDED.split('\n').filter((l) => l.includes('pr-state.js:39')).join('\n') + '\n';
  const low = lowItems(only);
  assert.strictEqual(low.length, 1);
  assert.strictEqual(low[0].resolution, 'keep-staged');
  assert.strictEqual(low[0].reason, SECTION_STANCES['Low-confidence findings'].reason);
});

test('a tiebreak confirmed line supersedes the real-emitter STAGED line (AC2.1, AC9.1, #3945)', () => {
  const staged = SUPERSEDED.split('\n')[1]; // pr-state.js:158, captured from a real decisions.md
  const fileLines = Array.from({ length: 200 }, (_, i) => `// line ${i + 1}`);
  fileLines[157] = '  // the comment sentence is stale';
  const finding = { lens: '3a', path: 'plugin/bin/lib/reconcile/pr-state.js', line: 158, claim: 'stale comment', reporterSeverity: 'low', kind: 'unconfirmed' };
  const now = new Date(2026, 9, 22, 23, 50, 0);
  const verdict = (v) => resolveTiebreak(finding, `Verdict: ${v}\nEvidence: ${finding.path}:158 \`// the comment sentence is stale\`\nSeverity: low\nSTATUS: DONE`, { readFile: () => fileLines.join('\n'), now });
  const confirmed = verdict('confirmed');
  // Built through the sanctioned writer's formatter (log-decision.js), not by hand-prepending "- ".
  const confirmedEntry = formatEntry({ status: confirmed.logStatus, now, step: confirmed.logStep, text: confirmed.logText, reversibility: 'high' });
  assert.strictEqual(confirmed.outcome, 'confirmed');
  assert.strictEqual(lowItems(`${staged}\n`).length, 1, 'the STAGED line alone is a Low-confidence item');
  assert.strictEqual(lowItems(`${staged}\n${confirmedEntry}\n`).length, 0, 'the confirmed line supersedes it');
  const dropped = verdict('refuted');
  assert.strictEqual(dropped.outcome, 'drop');
  assert.strictEqual(lowItems(`${staged}\n- ${dropped.logLine}\n`).length, 1, 'a drop line never supersedes');
});

test('a same-location AUTO elevation under a different lens does not supersede (#3772)', () => {
  const decisions = [
    '- STAGED 10:00:00 — Single-read: lens "3a" finding src/a.js:4 not directly verified. Staged to Review Console as low-confidence.',
    '- AUTO 10:00:01 — Reproduction: lens "3f" finding src/a.js:4 elevated. Confirmed.',
    '',
  ].join('\n');
  assert.strictEqual(lowItems(decisions).length, 1);
});

test('an AUTO elevation logged before the STAGED line does not supersede it (#3772)', () => {
  const decisions = [
    '- AUTO 10:00:00 — Reproduction: lens "3a" finding src/a.js:4 elevated. Confirmed.',
    '- STAGED 10:00:01 — Single-read: lens "3a" finding src/a.js:4 not directly verified. Staged to Review Console as low-confidence.',
    '',
  ].join('\n');
  assert.strictEqual(lowItems(decisions).length, 1);
});

test('a later same-key AUTO line without the Confirmed sentence does not supersede (#3772)', () => {
  const decisions = [
    '- STAGED 10:00:00 — Single-read: lens "3a" finding src/a.js:4 not directly verified. Staged to Review Console as low-confidence.',
    '- AUTO 10:00:01 — Reproduction: lens "3a" finding src/a.js:4 not confirmed.',
    '',
  ].join('\n');
  assert.strictEqual(lowItems(decisions).length, 1);
});

test('the snapshot is read once before any resolution: a second read would throw (#1932 Gotcha)', () => {
  let reads = 0;
  const runDir = fixture({ staged: EVERY_SECTION, headers: [7] });
  const d = deps({ readdir: (p) => { reads += 1; return fs.readdirSync(p); } });
  resolveAll({ runDir, policy: 'console-auto', deps: d });
  assert.strictEqual(reads, 2, 'staged/ and work/ each listed exactly once');
});

test('policy other than console-auto throws RangeError (#1932)', () => {
  assert.throws(() => resolveAll({ runDir: fixture(), policy: 'console-manual', deps: deps() }), RangeError);
});

test('SECTION_STANCES names a stance for every section the console renders (#1932)', () => {
  for (const s of ['Auto-applied', 'Pending review', 'Low-confidence findings', 'Contested findings', 'Skill updates', 'Documentation updates', 'Journey updates', 'Configuration updates', 'Reference repairs', 'Cleanup actions', 'Queue writes', 'Memory updates', 'Upstream feedback', 'Reflection insights', 'Refused — no defer reason']) {
    assert.ok(SECTION_STANCES[s] && typeof SECTION_STANCES[s].resolution === 'string', s);
  }
});

// Prose-code twin pin (#3401): resolve.js's Pending-review `.md` prefix
// alternation and review-console-appendix.md's prose prefix list name the
// same closed set. Both directions, so a prefix added to one side alone
// goes red; the two negative controls below run the same assertion the
// positive test runs, against a mutated input.
const APPENDIX = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'wrap-up', 'review-console-appendix.md'), 'utf8');

function isPendingMdPrefixRow([re, section]) {
  return section === 'Pending review' && /^\^\(.*\)-$/.test(re.source);
}

function pendingMdPrefixesFromCode(map = SECTION_MAP) {
  const rows = map.filter(isPendingMdPrefixRow);
  assert.strictEqual(rows.length, 1, 'exactly one Pending-review .md prefix alternation in SECTION_MAP');
  return rows[0][0].source.slice(2, -2).split('|').sort();
}

function pendingMdPrefixesFromProse(text = APPENDIX) {
  const m = /- `apply` on a \*\*Pending review\*\* item[\s\S]*?a staged `\.md` proposal \(([^)]*)\)/.exec(text);
  assert.ok(m, 'the appendix `apply` on Pending review bullet with its parenthesized `.md` prefix list is present');
  const prefixes = [...m[1].matchAll(/`([a-z-]+)-\*`/g)].map((x) => x[1]).sort();
  assert.ok(prefixes.length > 0, 'the prose list names at least one prefix');
  return prefixes;
}

function assertPendingPrefixTwin(codeSet, proseSet) {
  assert.deepStrictEqual(codeSet, proseSet, 'SECTION_MAP Pending-review .md prefixes and review-console-appendix.md prose list must name the same set');
}

test('AC4.1: the Pending-review .md prefix alternation and the appendix prose list name the same set, both ways (#3401 twin pin)', () => {
  const code = pendingMdPrefixesFromCode();
  const prose = pendingMdPrefixesFromProse();
  assert.ok(code.includes('sdd-ruling'), 'sdd-ruling is in the regex');
  assert.ok(prose.includes('sdd-ruling'), 'sdd-ruling is in the prose list');
  assertPendingPrefixTwin(code, prose);
});

test('AC4.2 (control): removing sdd-ruling from the regex alone makes the twin pin fail', () => {
  const mutated = SECTION_MAP.map((row) => (isPendingMdPrefixRow(row)
    ? [new RegExp(row[0].source.replace('|sdd-ruling', '').replace('sdd-ruling|', '')), row[1]]
    : row));
  assert.throws(() => assertPendingPrefixTwin(pendingMdPrefixesFromCode(mutated), pendingMdPrefixesFromProse()));
});

test('AC4.2 (control): removing sdd-ruling-* from the appendix prose alone makes the twin pin fail', () => {
  const mutated = APPENDIX.replace(/,?\s*`sdd-ruling-\*`/, '');
  assert.notStrictEqual(mutated, APPENDIX, 'the mutation removed the prose entry');
  assert.throws(() => assertPendingPrefixTwin(pendingMdPrefixesFromCode(), pendingMdPrefixesFromProse(mutated)));
});

test('the appendix Resolution-to-step mapping routes an approve Reflection insights row to step 10 (#3926)', () => {
  const approve = /- `approve` — [\s\S]*?(?=\n- `)/.exec(APPENDIX);
  assert.ok(approve, 'the appendix approve bullet is present');
  assert.match(approve[0], /Reflection insights/);
  assert.match(approve[0], /step 10/);
});

test('every CANONICAL_PREFIXES entry classifies without unmapped-prefix (#3370)', () => {
  assert.ok(CANONICAL_PREFIXES.length > 0);
  for (const p of CANONICAL_PREFIXES) {
    assert.notStrictEqual(classifyStagedItem(p + '1.md').reason, 'unmapped-prefix', p);
  }
});

test('every SECTION_MAP row except .patch is covered by some CANONICAL_PREFIXES entry (#3370)', () => {
  const rows = SECTION_MAP.filter(([re]) => re.source !== '\\.patch$');
  assert.ok(rows.length > 0 && rows.length < SECTION_MAP.length, 'the .patch row is the only exclusion');
  for (const [re] of rows) {
    assert.ok(CANONICAL_PREFIXES.some((p) => re.test(p + '1.md')), `no CANONICAL_PREFIXES entry matches ${re}`);
  }
});

// Expands a SECTION_MAP row's regex source into the literal prefixes it accepts:
// `^a-`, `^a(-|\b)`, `^(a|b)-`, `^x-(c|d)-` style rows (every row but the .patch one).
function rowPrefixes(re) {
  // A `(-|\b)` tail still lists the `-` form (resolve.js's CANONICAL_PREFIXES comment).
  const src = re.source.replace('(-|\\b)', '-');
  const m = /^\^([^(]*)(?:\(([^)]*)\))?(-?)$/.exec(src);
  assert.ok(m, `unrecognised SECTION_MAP row shape ${re.source}`);
  const [, head, alts, tail] = m;
  return (alts === undefined ? [''] : alts.split('|')).map((a) => `${head}${a}${tail}`);
}

test('every alternative of every SECTION_MAP row except .patch is a CANONICAL_PREFIXES entry (#3370)', () => {
  const rows = SECTION_MAP.filter(([re]) => re.source !== '\\.patch$');
  const expected = rows.flatMap(([re]) => rowPrefixes(re));
  assert.ok(expected.length >= rows.length);
  for (const p of expected) {
    assert.ok(CANONICAL_PREFIXES.includes(p), `CANONICAL_PREFIXES is missing ${p}`);
  }
});

test('nearestCanonicalPrefixes(review-13-record) includes a review-* prefix (#3370)', () => {
  const near = nearestCanonicalPrefixes('review-13-record');
  assert.strictEqual(near.length, 3);
  assert.ok(near.some((p) => p.startsWith('review-')), near.join(', '));
});

test('nearestCanonicalPrefixes ranks an exact head match first and honors n (#3370)', () => {
  assert.deepStrictEqual(nearestCanonicalPrefixes('review-unconfirmed-9', 1), ['review-unconfirmed-']);
  assert.strictEqual(nearestCanonicalPrefixes('zzz', 5).length, 5);
});

// #3488: every staged-id producer prefix is either mapped to a console section
// or exempt (its run never reaches the console), so stage-item.js's
// unmapped-prefix warning only fires for a genuinely unknown id.
// AC2.1: one predicate, used by the positive test and by the control.
function mappedOrExempt(id) {
  return classifyStagedItem(id + '.md').reason !== 'unmapped-prefix' || stagingExemption(id) !== null;
}
const CURRENT_STATE_IDS = ['release-held', 'upstream-draft-1', 'shipped-close-12', 'dispatch-target-missing-12',
  'review-followup-1', 'build-followup-1', 'docs-1', 'skills-1', 'wrap-up-reflect-insights',
  'wrap-up-cleanup-ordering', 'reconcile-live-run-archived'];

test('AC2.1: every id named in #3488 Current State classifies mapped or is exempt with a reason', () => {
  for (const id of CURRENT_STATE_IDS) assert.ok(mappedOrExempt(id), id);
});

test('AC2.1 (control): an unknown id fails the same predicate', () => {
  assert.equal(mappedOrExempt('review-13-record'), false);
});

test('exempt and mapped are disjoint: no exempt id also classifies mapped', () => {
  for (const id of ['release-held', 'dispatch-target-missing-1', 'shipped-close-1', 'dream-proposal-1']) {
    assert.ok(stagingExemption(id), id);
    assert.equal(classifyStagedItem(id + '.md').reason, 'unmapped-prefix', id);
  }
});

test('every STAGING_EXEMPTIONS entry carries a non-empty reason', () => {
  assert.ok(STAGING_EXEMPTIONS.length >= 4);
  for (const [re, reason] of STAGING_EXEMPTIONS) assert.ok(re instanceof RegExp && typeof reason === 'string' && reason.length > 20);
});

test('stagingExemption matches with or without the extension and returns null otherwise', () => {
  assert.equal(stagingExemption('release-held'), stagingExemption('release-held.md'));
  assert.ok(stagingExemption('release-held.md'));
  assert.equal(stagingExemption('release-held-extra'), null);
  assert.equal(stagingExemption('review-13-record'), null);
});

test('#3488 newly mapped producer prefixes classify to their section and reason', () => {
  assert.deepStrictEqual(classifyStagedItem('upstream-draft-1.md'), { section: 'Upstream feedback', reason: 'hand-off-draft' });
  assert.deepStrictEqual(classifyStagedItem('premise-satisfied-7.md'), { section: 'Queue writes', reason: 'premise-satisfied-close-proposal' });
  assert.deepStrictEqual(classifyStagedItem('sibling-premise-disproof-7.md'), { section: 'Pending review', reason: 'sibling-premise-disproof-note' });
  // #3926 owns this id: its own Reflection insights section, executed by
  // review-console.md "On approval" step 10, so no pending reason.
  assert.deepStrictEqual(classifyStagedItem('wrap-up-reflect-insights.md'), { section: 'Reflection insights' });
  assert.deepStrictEqual(classifyStagedItem('plan-citation-1.md'), { section: 'Pending review', reason: 'cited-plan-kept' });
  assert.deepStrictEqual(classifyStagedItem('translation-85.md'), { section: 'Pending review', reason: 'translated-brief' });
  assert.deepStrictEqual(classifyStagedItem('docs-1.md'), { section: 'Documentation updates' });
  assert.deepStrictEqual(classifyStagedItem('skills-1.md'), { section: 'Skill updates' });
  for (const id of ['review-followup-1', 'build-followup-1', 'reconcile-live-run-archived']) {
    assert.deepStrictEqual(classifyStagedItem(id + '.md'), { section: 'Queue writes' }, id);
  }
  assert.deepStrictEqual(
    classifyStagedItem('wrap-up-cleanup-ordering.md', '**Category:** observation\n'),
    { section: 'Pending review', reason: 'non-tangential-category:observation' },
  );
});

test('#3488: resolveAll never auto-applies a plan-citation or translation proposal — both resolve pending', () => {
  const runDir = fixture({ staged: { 'plan-citation-1.md': 'cited by x', 'translation-85.md': 'brief' } });
  const items = resolveAll({ runDir, policy: 'console-auto', deps: deps() }).items;
  for (const id of ['plan-citation-1.md', 'translation-85.md']) {
    const item = items.find((i) => i.id === id);
    assert.ok(item, id);
    assert.strictEqual(item.resolution, 'pending', id);
  }
});

test('#3488: resolveAll never auto-files an upstream-draft hand-off — it resolves pending', () => {
  const runDir = fixture({ staged: { 'upstream-draft-1.md': 'draft body' } });
  const item = resolveAll({ runDir, policy: 'console-auto', deps: deps() }).items.find((i) => i.id === 'upstream-draft-1.md');
  assert.ok(item, 'the draft is an item');
  assert.strictEqual(item.resolution, 'pending');
});
