'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MOD = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'console', 'resolve');
const { classifyStagedItem, resolveAll, findingItems, renderStoredTable, parseTiebreakLine, approveAllDefault, readSnapshot, SECTION_STANCES, SECTION_MAP, ENGINE_ROW_SECTIONS, CANONICAL_PREFIXES, nearestCanonicalPrefixes, SDD_RULING_REASONS, sddRulingDeferralReason, STAGING_EXEMPTIONS, stagingExemption } = require(MOD);
const ROOT = path.join(__dirname, '..', '..', '..');
const { unresolvedItems, readRunResidue, formatResidueLines } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'residue'));
const { resolveTiebreak } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'tiebreak'));
const { formatEntry } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'log-decision', 'append'));
const { readText } = require('../../helpers/read-skill');

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
  'sdd-ruling-1.md': 'Title: ruling\nKind: sdd-ruling\nRuling: Task 2: Ruling: keep the guard — cheaper than the alternative — costs a re-read if wrong\nDefers: no\nStaged-at: abc123\nLedger: docs/plans/x-ledger.md#5\n\nratify / reverse\n',
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
  assert.deepStrictEqual(classifyStagedItem('wrap-up-memory-1.md.shadow-dup'), { section: 'Queue writes', outcome: 'shadow-dup-collision' }, 'a sweep-shadow copy is never its original\'s section');
  assert.deepStrictEqual(classifyStagedItem('review-2.patch.shadow-dup-2'), { section: 'Queue writes', outcome: 'shadow-dup-collision' });
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

test('AC4.1: shadow-dup-duplicate classifies to Dismissed duplicates, whose stance is final (#2773, #3946)', () => {
  assert.deepStrictEqual(
    classifyStagedItem('build-deviation-1.md.shadow-dup', 'same', 'same'),
    { section: 'Dismissed duplicates', outcome: 'shadow-dup-duplicate' },
  );
  assert.strictEqual(SECTION_STANCES['Dismissed duplicates'].resolution, 'dismissed');
});

test('AC4.1: shadow-dup-divergent classifies to Queue writes (apply) (#2773, #3946)', () => {
  assert.deepStrictEqual(
    classifyStagedItem('build-deviation-2.md.shadow-dup', 'shadow', 'anchor'),
    { section: 'Queue writes', outcome: 'shadow-dup-divergent' },
  );
});

test('AC4.1: shadow-dup-collision (no anchor, or unreadable copy) classifies to Queue writes (apply) (#2773, #3946)', () => {
  // No sibling supplied at all — the conservative fallback for callers that
  // don't (or can't) supply anchor text.
  assert.deepStrictEqual(
    classifyStagedItem('wrap-up-memory-1.md.shadow-dup', 'x'),
    { section: 'Queue writes', outcome: 'shadow-dup-collision' },
  );
  // The shadow-dup file's own text unreadable (null) while the anchor's text IS
  // readable is "can't tell", not "confirmed different" — collision, not divergent.
  assert.deepStrictEqual(
    classifyStagedItem('build-deviation-3.md.shadow-dup', null, 'anchor'),
    { section: 'Queue writes', outcome: 'shadow-dup-collision' },
  );
});

test('AC4.2: a whitespace-only or CRLF difference is divergent, never dismissed (#3946)', () => {
  for (const [text, sibling] of [['a\n', 'a\n\n'], ['a ', 'a'], ['a\r\n', 'a\n']]) {
    const r = classifyStagedItem('x-1.md.shadow-dup', text, sibling);
    assert.strictEqual(r.outcome, 'shadow-dup-divergent', JSON.stringify([text, sibling]));
    assert.notStrictEqual(r.section, 'Dismissed duplicates', JSON.stringify([text, sibling]));
  }
});

test('two copies that differ only in invalid UTF-8 bytes decode alike but are divergent, never dismissed (#3946 review)', () => {
  const copy = Buffer.from([0x61, 0xff]).toString('utf8');
  const anchor = Buffer.from([0x61, 0xfe]).toString('utf8');
  assert.strictEqual(copy, anchor, 'precondition: both bytes decode to the same U+FFFD string');
  const r = classifyStagedItem('x-1.md.shadow-dup', copy, anchor);
  assert.deepStrictEqual(r, { section: 'Queue writes', outcome: 'shadow-dup-divergent' });
});

test('patch copy: a .patch.shadow-dup copy resolves apply in Queue writes, never stale (#3946)', () => {
  const r = resolveAll({ runDir: fixture({ staged: { 'review-2.patch': 'p', 'review-2.patch.shadow-dup': 'q' }, headers: [7] }), policy: 'console-auto', deps: deps() });
  const copy = r.items.find((i) => i.id === 'review-2.patch.shadow-dup');
  assert.strictEqual(copy.resolution, 'apply');
  assert.strictEqual(copy.section, 'Queue writes');
});

test('a non-.md/.patch anchor is read too: an identical .json pair resolves dismissed, a differing one divergent (#3946 M1; CLI agreement: shadow-dup-proposal.test.js)', () => {
  const r = resolveAll({ runDir: fixture({ staged: { 'tidy-absorb-1.json': '{"a":1}\n', 'tidy-absorb-1.json.shadow-dup': '{"a":1}\n', 'tidy-absorb-2.json': '{"a":1}\n', 'tidy-absorb-2.json.shadow-dup': '{"a":2}\n' }, headers: [7] }), policy: 'console-auto', deps: deps() });
  const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.strictEqual(by['tidy-absorb-1.json.shadow-dup'].resolution, 'dismissed');
  assert.strictEqual(by['tidy-absorb-1.json.shadow-dup'].section, 'Dismissed duplicates');
  assert.match(by['tidy-absorb-1.json.shadow-dup'].reason, /^shadow-dup-duplicate — /);
  assert.match(by['tidy-absorb-2.json.shadow-dup'].reason, /^shadow-dup-divergent — /);
});

test('AC4.1 e2e: resolveAll leaves no shadow-dup item pending (#2773, #3946)', () => {
  const runDir = fixture({
    staged: {
      'build-deviation-1.md': 'identical content',
      'build-deviation-1.md.shadow-dup': 'identical content',
      'build-deviation-2.md': 'original content',
      'build-deviation-2.md.shadow-dup': 'different content — recovered from a clobbering write',
      'leftover-x.md.shadow-dup': 'a copy whose anchor is gone',
    },
    headers: [7],
  });
  const r = resolveAll({ runDir, policy: 'console-auto', deps: deps() });
  const by = Object.fromEntries(r.items.map((i) => [i.id, i]));
  assert.deepStrictEqual(unresolvedItems({ items: r.items }), []);
  assert.strictEqual(by['build-deviation-1.md.shadow-dup'].resolution, 'dismissed');
  assert.strictEqual(by['build-deviation-2.md.shadow-dup'].resolution, 'apply');
  assert.strictEqual(by['leftover-x.md.shadow-dup'].resolution, 'apply');
  assert.match(by['build-deviation-1.md.shadow-dup'].reason, /^shadow-dup-duplicate — /);
  assert.match(by['build-deviation-2.md.shadow-dup'].reason, /^shadow-dup-divergent — /);
  assert.match(by['leftover-x.md.shadow-dup'].reason, /^shadow-dup-collision — /);
  // The anchors themselves are unaffected — still plain Pending review items.
  assert.strictEqual(by['build-deviation-1.md'].resolution, 'apply');
});

test('AC3.2/AC3.3 orthogonal: tangential and Category-less reflect files are unchanged (#3946)', () => {
  const tangential = 'Title: Some backlog idea\nType: task\nLabels: none\nDefer-reason: tangential\n\n# Reflect — staged finding 3\n\n**Category:** tangential\n\n## Finding\n\nx\n';
  assert.deepStrictEqual(classifyStagedItem('reflect-3.md', tangential), { section: 'Queue writes' });
  assert.deepStrictEqual(classifyStagedItem('reflect-4.md', '# Reflect\n\n## Finding\n\nx\n'), { section: 'Queue writes' });
});

test('every registry row whose own judge file documents a literal staged/{prefix}-{n} naming convention resolves through SECTION_MAP, into that row\'s own ENGINE_ROW_SECTIONS section when one exists (#2773)', () => {
  const { REGISTRY } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'wrap-up', 'registry'));
  const SKILLS_DIR = path.join(ROOT, 'plugin', 'skills', 'wrap-up');
  const PREFIX_RE = /staged\/([a-zA-Z][a-zA-Z0-9-]*-)\{[nN]\}/;
  const checkedIds = [];
  for (const row of REGISTRY) {
    const judgeText = readText(path.join(SKILLS_DIR, row.judge));
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
const decisionId = (line) => `decision:${line.slice(2, 60)}#${crypto.createHash('sha256').update(line).digest('hex').slice(0, 8)}`;

test('AC1.1: a STAGED low-confidence line followed by a same-lens, same path:line AUTO elevation produces no Low-confidence item (#3772)', () => {
  const low = lowItems(SUPERSEDED);
  assert.strictEqual(low.length, 1, 'the two confirmed lines are superseded; pr-state.js:39 stays');
  assert.strictEqual(low[0].id, decisionId(SUPERSEDED.split('\n')[5]), 'the survivor is the pr-state.js:39 line');
});

test('AC2.1: a STAGED low-confidence line with no later elevation still produces its keep-staged item (#3772)', () => {
  const only = SUPERSEDED.split('\n').filter((l) => l.includes('pr-state.js:39')).join('\n') + '\n';
  const low = lowItems(only);
  assert.strictEqual(low.length, 1);
  assert.strictEqual(low[0].resolution, 'keep-staged');
  assert.strictEqual(low[0].reason, SECTION_STANCES['Low-confidence findings'].reason);
});

const SAME_PREFIX = SUPERSEDED.split('\n').filter((l) => l.startsWith('- STAGED ')).join('\n') + '\n';

test('AC1.1: three STAGED lines sharing their first 58 characters yield three distinct item ids (#3816)', () => {
  const lines = SAME_PREFIX.trim().split('\n');
  assert.strictEqual(new Set(lines.map((l) => l.slice(2, 60))).size, 1, 'fixture: the three lines share their first 58 characters');
  const ids = lowItems(SAME_PREFIX).map((i) => i.id);
  assert.strictEqual(ids.length, 3);
  assert.strictEqual(new Set(ids).size, 3);
  assert.deepStrictEqual(ids, lines.map(decisionId), 'each id is the readable lead plus the hash of its own full line; no -n suffix');
});

test('a byte-identical repeated STAGED line gets a -2 suffix, the first keeps the bare hash (#3816)', () => {
  const line = SUPERSEDED.split('\n')[5];
  const ids = lowItems(`${line}\n${line}\n`).map((i) => i.id);
  assert.deepStrictEqual(ids, [decisionId(line), `${decisionId(line)}-2`]);
});

test('coordination ids are deterministic across two resolutions of the same run (#3816)', () => {
  const runDir = fixture({ decisions: SAME_PREFIX, headers: [7] });
  const once = () => resolveAll({ runDir, policy: 'console-auto', deps: deps() }).items.map((i) => i.id);
  assert.deepStrictEqual(once(), once());
});

test('AC2.1: a console.json written with the old 58-character id shape still reads and re-renders (#3816 expand-contract)', () => {
  const oldId = `decision:${SUPERSEDED.split('\n')[1].slice(2, 60)}`;
  assert.strictEqual(oldId, 'decision:STAGED 23:44:20 — spec #3412 — Step 3 reproduction: Reprod', 'the archived 2026-10-17T192303-spec-3412 shape');
  const stored = { resolved: true, at: '2026-10-17T23:50:00Z', items: [0, 1, 2].map(() => ({ id: oldId, section: 'Low-confidence findings', resolution: 'keep-staged', reason: 'r' })), merge: { resolution: 'leave-open', reason: 'x' } };
  assert.strictEqual(unresolvedItems(stored).length, 3);
  const table = renderStoredTable(stored);
  assert.strictEqual(table.split('\n').filter((l) => l.includes(oldId)).length, 3);
});

test('AC2.1: old-shape and new-shape decision ids coexist in one console.json — residue counts both and points both at decisions.md (#3816)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-resolve-'));
  fs.writeFileSync(path.join(dir, 'decisions.md'), SAME_PREFIX);
  const line = SUPERSEDED.split('\n')[1];
  const oldId = `decision:${line.slice(2, 60)}`;
  const items = [oldId, decisionId(line)].map((id) => ({ id, section: 'Low-confidence findings', resolution: 'keep-staged', reason: 'r' }));
  const text = JSON.stringify({ resolved: true, items });
  fs.writeFileSync(path.join(dir, 'console.json'), text);
  assert.strictEqual(unresolvedItems(JSON.parse(text)).length, 2);
  const lines = formatResidueLines(readRunResidue(dir), { pluginRoot: '/p' });
  const see = `    see "${path.join(dir, 'decisions.md')}"`;
  assert.strictEqual(lines.filter((l) => l === see).length, 2);
  assert.ok(!lines.some((l) => l.includes('undefined')), lines.join('\n'));
  fs.rmSync(dir, { recursive: true, force: true });
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
  assert.strictEqual(lowItems(`${staged}\n- ${dropped.logLine}\n`).length, 0, 'a refuted drop supersedes the STAGED line too (#3949)');
});

// ---- #3949: a tiebreak verdict is a finding's final outcome ----
const TB_NOW = new Date(2026, 9, 24, 10, 0, 0);
const TB_FILE = Array.from({ length: 300 }, () => 'quote text here').join('\n');
const tbFinding = (over = {}) => ({ lens: '3a', path: 'src/a.js', line: 9, claim: 'claim one', reporterSeverity: 'medium', kind: 'unconfirmed', ...over });
// A verdict line built through the real resolver and the sanctioned formatter, never typed by hand.
function tbVerdict(finding, { verdict = 'cant-tell', severity = 'medium', recommendation = null } = {}) {
  const evidence = verdict === 'cant-tell' ? '' : `Evidence: ${finding.path}:${finding.line} \`quote text here\`\n`;
  const rec = recommendation ? `Recommendation: ${recommendation}\n` : '';
  const r = resolveTiebreak(finding, `Verdict: ${verdict}\n${evidence}Severity: ${severity}\n${rec}STATUS: DONE`, { readFile: () => TB_FILE, now: TB_NOW });
  return { r, entry: formatEntry({ status: r.logStatus, now: TB_NOW, step: r.logStep, text: r.logText, reversibility: 'high' }) };
}
const tbStaged = (f) => `- STAGED 09:59:00 — Reproduction: lens "${f.lens}" finding ${f.path}:${f.line} not reproduced. Staged to Review Console as low-confidence. Reversibility: high.`;
const tbCoincidence = (f, lineB) => `- STAGED 09:59:00 — Reproduction: lens "${f.lens}" findings ${f.path}:${f.line} / ${f.path}:${lineB} share a location but not substance; both staged unconfirmed. Reversibility: high.`;
const tbDebate = (f, file) => `- STAGED 09:59:00 — Debate: lens "${f.lens}" cross-lens disagreement on ${f.path}:${f.line} inconclusive (positions differ). Both verdicts staged. Stage path: staged/${file}. Reversibility: high.`;
const bareDeps = () => ({ readFile: (p) => fs.readFileSync(p, 'utf8'), readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } } });
const findings = (decisions, staged = {}) => findingItems({ runDir: fixture({ decisions: `${decisions}\n`, staged }), deps: bareDeps() }).items;
const OPEN = ['pending', 'keep-staged'];

test('approve-all: a console verdict with Recommendation file resolves filed, drop resolves dropped (#3949 AC2)', () => {
  const f1 = tbFinding();
  const f2 = tbFinding({ path: 'src/b.js', line: 3, claim: 'claim two' });
  const v1 = tbVerdict(f1, { recommendation: 'file' });
  const v2 = tbVerdict(f2, { recommendation: 'drop' });
  const decisions = [tbStaged(f1), tbStaged(f2), v1.entry, v2.entry].join('\n');
  const items = findings(decisions);
  assert.deepStrictEqual(items.map((i) => [i.id, i.section, i.resolution]), [
    [`tiebreak:${v1.r.id}`, 'Low-confidence findings', 'filed'],
    [`tiebreak:${v2.r.id}`, 'Low-confidence findings', 'dropped'],
  ], 'the earlier STAGED lines are superseded, not items');
  assert.deepStrictEqual(items[0].tiebreak, { id: v1.r.id, key: '3a|src/a.js:9', lens: '3a', path: 'src/a.js', line: 9, severity: 'medium', recommendation: 'file', reason: 'verdict:cant-tell' });
  assert.strictEqual(items[1].tiebreak.recommendation, 'drop');
  const viaResolveAll = resolveAll({ runDir: fixture({ decisions: `${decisions}\n`, headers: [7] }), policy: 'console-auto', deps: deps() }).items;
  assert.deepStrictEqual(viaResolveAll.map((i) => [i.id, i.resolution]), [[`tiebreak:${v1.r.id}`, 'filed'], [`tiebreak:${v2.r.id}`, 'filed']], 'resolveAll (always unattended) files both, the drop recommendation included');
});

test('a console verdict with Recommendation none resolves filed, never dropped (#3949)', () => {
  const f = tbFinding();
  const v = tbVerdict(f);
  assert.strictEqual(v.r.recommendation, null);
  const [item] = findings([tbStaged(f), v.entry].join('\n'));
  assert.strictEqual(item.resolution, 'filed');
  assert.strictEqual(item.tiebreak.recommendation, null);
  assert.strictEqual(approveAllDefault(null), 'filed');
  assert.strictEqual(approveAllDefault('file'), 'filed');
  assert.strictEqual(approveAllDefault('drop'), 'dropped');
});

test('a legacy STAGED line with no verdict stays keep-staged and is in unresolvedItems (#3949 AC2)', () => {
  const items = findings(tbStaged(tbFinding()));
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].resolution, 'keep-staged');
  assert.strictEqual(items[0].reason, SECTION_STANCES['Low-confidence findings'].reason);
  assert.match(items[0].reason, /no tiebreak recommendation \(legacy shape\)/);
  assert.deepStrictEqual(unresolvedItems({ items }), items);
  const file = findings('', { 'review-unconfirmed-1.md': 'x' });
  assert.deepStrictEqual(file.map((i) => [i.id, i.resolution]), [['review-unconfirmed-1.md', 'keep-staged']], 'a staged file nothing links to stays keep-staged');
});

test('a refuted drop supersedes the earlier STAGED line, at low and at high severity (#3949 AC1)', () => {
  for (const severity of ['low', 'high']) {
    const f = tbFinding({ reporterSeverity: severity });
    const v = tbVerdict(f, { verdict: 'refuted', severity });
    assert.strictEqual(v.r.outcome, 'drop');
    assert.deepStrictEqual(findings([tbStaged(f), v.entry].join('\n')), [], `${severity}: no console item`);
  }
});

test('a digested verdict supersedes the earlier STAGED line (#3949 AC1)', () => {
  const f = tbFinding({ reporterSeverity: 'low' });
  const v = tbVerdict(f, { severity: 'low' });
  assert.strictEqual(v.r.outcome, 'digest');
  assert.deepStrictEqual(findings([tbStaged(f), v.entry].join('\n')), []);
});

test('a confirmed contested finding no longer appears in Contested — its staged review-contested file resolves dismissed (#3949 comment 1)', () => {
  const f = tbFinding();
  const v = tbVerdict(f, { verdict: 'confirmed', severity: 'medium' });
  assert.strictEqual(v.r.outcome, 'confirmed');
  const items = findings([tbDebate(f, 'review-contested-1.md'), v.entry].join('\n'), { 'review-contested-1.md': 'contested' });
  assert.deepStrictEqual(items.map((i) => [i.id, i.section, i.resolution]), [['review-contested-1.md', 'Contested findings', 'dismissed']]);
  assert.match(items[0].reason, /superseded — tiebreak confirmed it; routed through Step 3 Routing/);
  assert.strictEqual(items.filter((i) => i.resolution === 'keep-staged').length, 0);
});

test('a staged review file settled by a dropped, digested or console verdict resolves finally (#3949)', () => {
  const run = (finding, opts, file) => findings([tbDebate(finding, file), tbVerdict(finding, opts).entry].join('\n'), { [file]: 'x' })[0];
  const dropped = run(tbFinding({ reporterSeverity: 'low' }), { verdict: 'refuted', severity: 'low' }, 'review-contested-2.md');
  assert.deepStrictEqual([dropped.resolution, dropped.reason], ['dropped', 'refuted by tiebreak']);
  const digested = run(tbFinding({ reporterSeverity: 'low' }), { severity: 'low' }, 'review-debate-3.md');
  assert.deepStrictEqual([digested.resolution, digested.reason], ['dismissed', 'can\'t-tell below medium — logged to the materiality digest']);
  const cons = run(tbFinding(), { recommendation: 'drop' }, 'review-unconfirmed-4.md');
  assert.deepStrictEqual([cons.id, cons.section, cons.resolution, cons.tiebreak.recommendation], ['review-unconfirmed-4.md', 'Low-confidence findings', 'dropped', 'drop']);
});

test('a console verdict on a contested finding takes the Contested section (#3949)', () => {
  const f = tbFinding();
  const v = tbVerdict(f, { recommendation: 'file' });
  const items = findings([tbDebate(f, 'review-contested-9.md'), v.entry].join('\n'));
  assert.deepStrictEqual(items.map((i) => [i.id, i.section, i.resolution]), [[`tiebreak:${v.r.id}`, 'Contested findings', 'filed']]);
});

test('tiebreak lines are read by shape, not by keyword (#3949)', () => {
  const f = tbFinding({ path: 'plugin/skills/review/step3-debate-and-refutation.md', line: 12 });
  const v = tbVerdict(f, { recommendation: 'file' });
  const items = findings(v.entry);
  assert.deepStrictEqual(items.map((i) => [i.id, i.section]), [[`tiebreak:${v.r.id}`, 'Low-confidence findings']], 'the debate in the path never makes it Contested or a second item');
  assert.strictEqual(parseTiebreakLine('- STAGED 10:00:00 — Step 3: lens "3a" finding src/a.js:9 mentions tiebreak:0123456789ab in passing, console: nope. Severity: high.'), null);
  const quoted = '- STAGED 10:00:00 — Note: saw "Tiebreak tiebreak:0123456789ab: lens "3a" finding src/a.js:9 console: x. Severity: high. Recommendation: drop." in a pasted log. Reversibility: high.';
  assert.strictEqual(parseTiebreakLine(quoted), null, 'a verdict step quoted inside another line is not a verdict');
  const quotedConfirmed = '- AUTO 10:00:00 — Note: quoting Reproduction: lens "3a" finding src/a.js:9 confirmed by tiebreak:0123456789ab. Confirmed. Reversibility: high.';
  assert.strictEqual(parseTiebreakLine(quotedConfirmed), null, 'a quoted confirmed sentence is not a verdict');
  assert.ok(!findings(quoted).some((i) => i.id.startsWith('tiebreak:')), 'and it produces no tiebreak item');
});

test('a console verdict a linked staged file carries is never also its own item, even while the file is unsettled (#3949)', () => {
  const f = tbFinding();
  const other = tbFinding({ line: 20, claim: 'other' });
  const v = tbVerdict(f, { recommendation: 'file' });
  const decisions = [tbDebate(f, 'review-contested-1.md'), tbDebate(other, 'review-contested-1.md'), v.entry].join('\n');
  const items = findings(decisions, { 'review-contested-1.md': 'x' });
  assert.deepStrictEqual(items.map((i) => [i.id, i.section, i.resolution]), [['review-contested-1.md', 'Contested findings', 'keep-staged']], 'the verdict is carried by the open file, not filed on top of it');
});

test('a two-finding coincidence line needs both verdicts (#3949)', () => {
  const a = tbFinding({ line: 4, claim: 'a' });
  const b = tbFinding({ line: 9, claim: 'b' });
  const va = tbVerdict(a, { verdict: 'confirmed' });
  const vb = tbVerdict(b, { verdict: 'confirmed' });
  const line = tbCoincidence(a, 9);
  assert.strictEqual(findings([line, va.entry].join('\n')).length, 1, 'one verdict leaves the line open');
  assert.strictEqual(findings([line, va.entry].join('\n'))[0].resolution, 'keep-staged');
  assert.deepStrictEqual(findings([line, va.entry, vb.entry].join('\n')), [], 'both verdicts supersede it');
});

test('a verdict logged before the STAGED line does not supersede it (#3949)', () => {
  const f = tbFinding();
  assert.strictEqual(findings([tbVerdict(f, { verdict: 'confirmed' }).entry, tbStaged(f)].join('\n')).length, 1);
});

test('AC1: every tiebreak outcome together leaves zero keep-staged and zero pending (#3949)', () => {
  const mk = (n, over, opts) => { const f = tbFinding({ path: `src/f${n}.js`, claim: `claim ${n}`, ...over }); return { f, v: tbVerdict(f, opts) }; };
  const confirmed = mk(1, {}, { verdict: 'confirmed' });
  const refutedLow = mk(2, { reporterSeverity: 'low' }, { verdict: 'refuted', severity: 'low' });
  const refutedHigh = mk(3, { reporterSeverity: 'high' }, { verdict: 'refuted', severity: 'high' });
  const digest = mk(4, { reporterSeverity: 'low' }, { severity: 'low' });
  const consoleFile = mk(5, {}, { recommendation: 'file' });
  const consoleDrop = mk(6, {}, { recommendation: 'drop' });
  const fileFinding = mk(7, {}, { recommendation: 'file' });
  const all = [confirmed, refutedLow, refutedHigh, digest, consoleFile, consoleDrop, fileFinding];
  const decisions = [...all.map(({ f }, i) => (i === 6 ? tbDebate(f, 'review-contested-1.md') : tbStaged(f))), ...all.map(({ v }) => v.entry)].join('\n');
  const items = findings(decisions, { 'review-contested-1.md': 'x' });
  assert.ok(items.length > 0);
  assert.deepStrictEqual(items.filter((i) => OPEN.includes(i.resolution)), []);
  assert.deepStrictEqual(items.map((i) => [i.id, i.resolution]), [
    ['review-contested-1.md', 'filed'],
    [`tiebreak:${consoleFile.v.r.id}`, 'filed'],
    [`tiebreak:${consoleDrop.v.r.id}`, 'dropped'],
  ]);
});

test('AC5: at unattended N can\'t-tell items including a drop recommendation plan exactly N filings', () => {
  const mk = (n, recommendation) => {
    const f = tbFinding({ path: `src/f${n}.js`, claim: `claim ${n}` });
    return { f, v: tbVerdict(f, { recommendation }) };
  };
  const all = [mk(1, 'file'), mk(2, 'drop'), mk(3, null), mk(4, 'drop')];
  const decisions = [...all.map(({ f }) => tbStaged(f)), ...all.map(({ v }) => v.entry)].join('\n');
  const runDir = fixture({ decisions: `${decisions}\n`, headers: [7] });
  fs.writeFileSync(path.join(runDir, 'review-findings.json'), JSON.stringify(all.map(({ f, v }) => ({ id: v.r.id, lens: f.lens, path: f.path, line: f.line, claim: f.claim, reporterSeverity: f.reporterSeverity, kind: f.kind }))));
  const result = resolveAll({ runDir, policy: 'console-auto', deps: deps() });
  const tb = result.items.filter((i) => i.tiebreak);
  assert.strictEqual(tb.length, 4);
  assert.deepStrictEqual(tb.map((i) => i.resolution), ['filed', 'filed', 'filed', 'filed']);
  assert.ok(tb.every((i) => /an agent that could not tell is not licensed to drop/.test(i.reason)));
  assert.strictEqual(result.filings.length, 4);
  assert.deepStrictEqual(result.filings.map((p) => p.item), tb.map((i) => i.id));
  assert.strictEqual(new Set(result.filings.map((p) => p.fingerprint)).size, 4);
  assert.ok(result.filings.every((p) => p.proposal.includes('Labels: needs:definition') && /claim \d/.test(p.proposal)));
  assert.ok(result.filings.some((p) => p.proposal.includes(path.basename(runDir))), 'the run id is in the body');
});

test('AC5: a run without review-findings.json still plans a filing per can\'t-tell item, keyed on the tiebreak id', () => {
  const f = tbFinding();
  const v = tbVerdict(f, { recommendation: 'drop' });
  const result = resolveWith([tbStaged(f), v.entry].join('\n'));
  assert.strictEqual(result.filings.length, 1);
  assert.ok(result.filings[0].title.endsWith(`tiebreak:${v.r.id}`));
});

test('AC5: a multi-spec per-spec run dir names its parent run in the filing', () => {
  const f = tbFinding();
  const v = tbVerdict(f, { recommendation: 'file' });
  const parent = fixture({});
  const runDir = path.join(parent, 'spec-2');
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), `${v.entry}\n`);
  const result = resolveAll({ runDir, policy: 'console-auto', deps: deps({ readGrants: () => ({}) }) });
  assert.ok(result.filings[0].proposal.includes(`${path.basename(parent)}/spec-2`));
});

test('AC1 at unattended: every outcome fixture resolves with zero pending and zero keep-staged', () => {
  const mk = (n, over, opts) => { const f = tbFinding({ path: `src/f${n}.js`, claim: `claim ${n}`, ...over }); return { f, v: tbVerdict(f, opts) }; };
  const all = [
    mk(1, {}, { verdict: 'confirmed' }),
    mk(2, { reporterSeverity: 'low' }, { verdict: 'refuted', severity: 'low' }),
    mk(3, { reporterSeverity: 'high' }, { verdict: 'refuted', severity: 'high' }),
    mk(4, { reporterSeverity: 'low' }, { severity: 'low' }),
    mk(5, {}, { recommendation: 'file' }),
    mk(6, {}, { recommendation: 'drop' }),
  ];
  const decisions = [...all.map(({ f }) => tbStaged(f)), ...all.map(({ v }) => v.entry)].join('\n');
  const result = resolveWith(decisions);
  assert.deepStrictEqual(result.items.filter((i) => OPEN.includes(i.resolution)), []);
  assert.deepStrictEqual(result.items.filter((i) => /Low-confidence|Contested/.test(i.section)).map((i) => i.resolution), ['filed', 'filed']);
  assert.strictEqual(result.filings.length, 2, 'only the two can\'t-tell console items are filed; the refuted drop and the digest are not');
});

test('a staged file settled by a dropped verdict (no tiebreak field) stays dropped and plans no filing', () => {
  const f = tbFinding({ reporterSeverity: 'low' });
  const decisions = [tbDebate(f, 'review-contested-2.md'), tbVerdict(f, { verdict: 'refuted', severity: 'low' }).entry].join('\n');
  const result = resolveAll({ runDir: fixture({ decisions: `${decisions}\n`, staged: { 'review-contested-2.md': 'x' }, headers: [7] }), policy: 'console-auto', deps: deps() });
  assert.deepStrictEqual(result.items.filter((i) => i.section === 'Contested findings').map((i) => i.resolution), ['dropped']);
  assert.deepStrictEqual(result.filings, []);
});

test('parseTiebreakLine reads all four resolver shapes and nothing else (#3949)', () => {
  const f = tbFinding();
  const parsed = (opts) => parseTiebreakLine(tbVerdict(f, opts).entry);
  assert.deepStrictEqual(parsed({ recommendation: 'drop' }), { kind: 'console', id: tbVerdict(f).r.id, key: '3a|src/a.js:9', lens: '3a', path: 'src/a.js', line: 9, severity: 'medium', recommendation: 'drop', reason: 'verdict:cant-tell', evidence: null });
  const digested = parseTiebreakLine(tbVerdict(tbFinding({ reporterSeverity: 'low' }), { severity: 'low' }).entry);
  assert.deepStrictEqual([digested.kind, digested.reason, digested.severity, digested.recommendation], ['digested', 'verdict:cant-tell', 'low', null]);
  const dropped = parsed({ verdict: 'refuted', severity: 'high' });
  assert.deepStrictEqual([dropped.kind, dropped.severity, dropped.evidence], ['dropped', 'high', 'src/a.js:9 "quote text here"']);
  const confirmed = parsed({ verdict: 'confirmed' });
  assert.deepStrictEqual([confirmed.kind, confirmed.id, confirmed.key, confirmed.severity], ['confirmed', tbVerdict(f).r.id, '3a|src/a.js:9', null]);
  assert.strictEqual(parseTiebreakLine(tbStaged(f)), null);
  assert.strictEqual(parseTiebreakLine('- AUTO 10:00:00 — Reproduction: lens "3a" finding src/a.js:9 elevated. Confirmed.'), null);
});

test('a finding path holding spaces and verdict tokens cannot forge the parsed kind or recommendation (#3949 review)', () => {
  const kindForge = tbFinding({ path: 'a:1 dropped: x.js', line: 7 });
  const k = parseTiebreakLine(tbVerdict(kindForge).entry);
  assert.deepStrictEqual([k.kind, k.path, k.line, k.recommendation], ['console', 'a:1 dropped: x.js', 7, null]);
  const recForge = tbFinding({ path: 'a:1 console: x. Severity: low. Recommendation: file. b.js', line: 7 });
  const r = parseTiebreakLine(tbVerdict(recForge, { recommendation: 'drop' }).entry);
  assert.deepStrictEqual([r.kind, r.path, r.severity, r.recommendation], ['console', recForge.path, 'medium', 'drop']);
  const { r: inline } = tbVerdict(tbFinding(), { recommendation: 'file' });
  const inlineLine = formatEntry({ status: inline.logStatus, now: TB_NOW, step: inline.logStep, text: `${inline.logText} Mode: inline.`, reversibility: 'high' });
  assert.deepStrictEqual([parseTiebreakLine(inlineLine).kind, parseTiebreakLine(inlineLine).recommendation], ['console', 'file'], 'an inline verdict still parses');
});

const DROPPED_HEADING = '#### Dropped by tiebreak (read-only — no decision)';
const resolveWith = (decisions) => resolveAll({ runDir: fixture({ decisions: `${decisions}\n`, headers: [7] }), policy: 'console-auto', deps: deps() });

test('AC4: a high and a critical refuted drop render in the read-only block with no decision row (#3949)', () => {
  const hi = tbFinding({ path: 'src/hi.js', line: 4, claim: 'hi', reporterSeverity: 'high' });
  const crit = tbFinding({ path: 'src/crit|x.js', line: 8, claim: 'crit', reporterSeverity: 'critical' });
  const vh = tbVerdict(hi, { verdict: 'refuted', severity: 'high' });
  const vc = tbVerdict(crit, { verdict: 'refuted', severity: 'critical' });
  const result = resolveWith([tbStaged(hi), tbStaged(crit), vh.entry, vc.entry].join('\n'));
  assert.deepStrictEqual(result.droppedByTiebreak, [
    { id: vh.r.id, lens: '3a', path: 'src/hi.js', line: 4, severity: 'high', evidence: 'src/hi.js:4 "quote text here"' },
    { id: vc.r.id, lens: '3a', path: 'src/crit|x.js', line: 8, severity: 'critical', evidence: 'src/crit|x.js:8 "quote text here"' },
  ]);
  assert.deepStrictEqual(result.items.filter((i) => /Low-confidence|Contested/.test(i.section)), [], 'no console item');
  const block = result.table.split('\n').filter((l) => !l.includes('AUTO-RESOLVED') && /^\| src\//.test(l));
  assert.ok(result.table.includes(`\n${DROPPED_HEADING}\n\n| Path:Line | Lens | Severity | Evidence |\n|---|---|---|---|\n`), result.table);
  assert.deepStrictEqual(block, [
    '| src/hi.js:4 | 3a | high | src/hi.js:4 "quote text here" |',
    '| src/crit\\|x.js:8 | 3a | critical | src/crit\\|x.js:8 "quote text here" |',
  ]);
  assert.ok(result.table.indexOf('Merge: **') < result.table.indexOf(DROPPED_HEADING), 'the block follows the Merge line');
  assert.strictEqual(result.table.split('\n').filter((l) => l.includes('AUTO-RESOLVED')).length, result.items.length + 1, 'no row of the block is stamped AUTO-RESOLVED');
});

test('AC4: low and medium refuted drops do not appear in the console at all (#3949)', () => {
  const lines = [];
  for (const severity of ['low', 'medium']) {
    const f = tbFinding({ path: `src/${severity}.js`, claim: severity, reporterSeverity: severity });
    lines.push(tbStaged(f), tbVerdict(f, { verdict: 'refuted', severity }).entry);
  }
  const result = resolveWith(lines.join('\n'));
  assert.deepStrictEqual(result.droppedByTiebreak, []);
  assert.ok(!result.table.includes('Dropped by tiebreak'));
  assert.ok(!result.table.includes('src/low.js') && !result.table.includes('src/medium.js'));
});

test('a malformed drop line renders no block and does not throw (#3949)', () => {
  const f = tbFinding({ reporterSeverity: 'high' });
  const entry = tbVerdict(f, { verdict: 'refuted', severity: 'high' }).entry;
  const noSeverity = entry.replace(/ Severity: high\./, '');
  const badSeverity = entry.replace('Severity: high.', 'Severity: severe.');
  assert.notStrictEqual(noSeverity, entry);
  assert.notStrictEqual(badSeverity, entry);
  for (const line of [noSeverity, badSeverity, '- AUTO 10:00:00 — Tiebreak tiebreak:0123456789ab: lens "3a" finding src/a.js:9 dropped: refuted by tiebreak. Evidence: oops']) {
    const result = resolveWith(line);
    assert.deepStrictEqual(result.droppedByTiebreak, [], line);
    assert.ok(!result.table.includes('Dropped by tiebreak'), line);
  }
});

test('renderStoredTable renders a stored droppedByTiebreak and nothing when absent or empty (#3949)', () => {
  const stored = { items: [], merge: { resolution: 'merge', reason: 'r' }, droppedByTiebreak: [{ id: 'abc', lens: '3a', path: 'src/a.js', line: 9, severity: 'high', evidence: 'src/a.js:9 "q"' }] };
  assert.ok(renderStoredTable(stored).includes(`${DROPPED_HEADING}\n\n| Path:Line | Lens | Severity | Evidence |\n|---|---|---|---|\n| src/a.js:9 | 3a | high | src/a.js:9 "q" |`));
  assert.ok(!renderStoredTable({ ...stored, droppedByTiebreak: [] }).includes('Dropped by tiebreak'));
  assert.ok(!renderStoredTable({ items: [], merge: stored.merge }).includes('Dropped by tiebreak'), 'a console.json from before this field');
});

test('readSnapshot reads review-findings.json through deps.readFile: absent, unparseable and non-array give [] (#3949)', () => {
  const snap = (body) => {
    const runDir = fixture({ headers: [7] });
    if (body !== undefined) fs.writeFileSync(path.join(runDir, 'review-findings.json'), body);
    return readSnapshot({ runDir, deps: deps() }).findings;
  };
  assert.deepStrictEqual(snap(undefined), []);
  assert.deepStrictEqual(snap('not json'), []);
  assert.deepStrictEqual(snap('{"a":1}'), []);
  assert.deepStrictEqual(snap('[{"id":"0123456789ab","lens":"3a"}]'), [{ id: '0123456789ab', lens: '3a' }]);
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
  for (const s of ['Auto-applied', 'Pending review', 'Low-confidence findings', 'Contested findings', 'Skill updates', 'Documentation updates', 'Journey updates', 'Configuration updates', 'Reference repairs', 'Cleanup actions', 'Queue writes', 'Memory updates', 'Upstream feedback', 'Reflection insights', 'Dismissed duplicates', 'Refused — no defer reason']) {
    assert.ok(SECTION_STANCES[s] && typeof SECTION_STANCES[s].resolution === 'string', s);
  }
});

// Prose-code twin pin (#3401): resolve.js's Pending-review `.md` prefix
// alternation and review-console-appendix.md's prose prefix list name the
// same closed set. Both directions, so a prefix added to one side alone
// goes red; the two negative controls below run the same assertion the
// positive test runs, against a mutated input.
const APPENDIX = readText(path.join(ROOT, 'plugin', 'skills', 'wrap-up', 'review-console-appendix.md'));

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
  // The list entry is comma-led (", `sdd-ruling-*`)"); prose elsewhere in the appendix may name the prefix too (#3880).
  const mutated = APPENDIX.replace(/,\s*`sdd-ruling-\*`(?=\) applied)/, '');
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

// #3880: an sdd-ruling-* proposal that defers work resolves pending unless its
// header carries `Defers: no`, or `Defers: yes` plus exactly one valid
// `Defer-reason:`. The header is the lines before the first blank line.
function RULING(headerLines) {
  return 'Title: ruling\nKind: sdd-ruling\nRuling: Task 2: Ruling: defer the guard to a follow-up — cheaper — costs a re-read\n' + headerLines + 'Staged-at: abc123\nLedger: docs/plans/x-ledger.md#5\n\nratify / reverse\n';
}

function resolveStaged(name, text) {
  const runDir = fixture({ staged: { [name]: text }, headers: [7] });
  return resolveAll({ runDir, policy: 'console-auto', deps: deps() }).items.find((i) => i.id === name);
}

test('defers-no-resolves-apply: Defers: no keeps the Pending-review stance (#3880 AC4)', () => {
  const item = resolveStaged('sdd-ruling-1.md', RULING('Defers: no\n'));
  assert.strictEqual(item.resolution, 'apply');
  assert.strictEqual(item.reason, SECTION_STANCES['Pending review'].reason);
  assert.strictEqual(item.section, 'Pending review');
});

test('defers-yes-valid-reason-resolves-apply: Defers: yes with one valid Defer-reason keeps the stance (#3880 AC3)', () => {
  assert.strictEqual(resolveStaged('sdd-ruling-1.md', RULING('Defers: yes\nDefer-reason: needs-human-decision\n')).resolution, 'apply');
});

test('defers-yes-no-reason-pending: Defers: yes with no Defer-reason resolves pending (#3880 AC3)', () => {
  const item = resolveStaged('sdd-ruling-1.md', RULING('Defers: yes\n'));
  assert.strictEqual(item.resolution, 'pending');
  assert.strictEqual(item.reason, 'sdd-ruling-deferral-no-defer-reason');
});

test('defers-yes-invalid-reason-pending: Defers: yes with a Defer-reason outside DEFER_REASONS resolves pending (#3880 AC3)', () => {
  const item = resolveStaged('sdd-ruling-1.md', RULING('Defers: yes\nDefer-reason: minor\n'));
  assert.strictEqual(item.resolution, 'pending');
  assert.strictEqual(item.reason, 'sdd-ruling-deferral-no-defer-reason');
});

test('two-defer-reasons-pending: two Defer-reason lines resolve pending even when both are valid (#3880 AC3)', () => {
  const item = resolveStaged('sdd-ruling-1.md', RULING('Defers: yes\nDefer-reason: genuinely-larger\nDefer-reason: blocked-external\n'));
  assert.strictEqual(item.resolution, 'pending');
  assert.strictEqual(item.reason, 'sdd-ruling-deferral-no-defer-reason');
});

test('reason-key-without-defers-line-is-a-deferral: a Defer-reason line alone counts as deferring (#3880 AC3)', () => {
  const item = resolveStaged('sdd-ruling-1.md', RULING('Defer-reason: bogus\n'));
  assert.strictEqual(item.resolution, 'pending');
  assert.strictEqual(item.reason, 'sdd-ruling-deferral-no-defer-reason');
});

test('malformed-reason-line-is-a-deferral: a Defer-reason line whose value is not a DEFER_REASONS member fails closed, with or without Defers: yes (#3880)', () => {
  for (const header of ['Defers: no\nDefer-reason: genuinely-larger (see X)\n', 'Defers: yes\nDefer-reason: genuinely-larger (see X)\n']) {
    const item = resolveStaged('sdd-ruling-1.md', RULING(header));
    assert.strictEqual(item.resolution, 'pending', header);
    assert.strictEqual(item.reason, 'sdd-ruling-deferral-no-defer-reason', header);
  }
});

test('no-defers-line-is-unclassified: a ruling with no Defers: line resolves pending as unclassified (#3880 AC3)', () => {
  const item = resolveStaged('sdd-ruling-1.md', RULING(''));
  assert.strictEqual(item.resolution, 'pending');
  assert.strictEqual(item.reason, 'sdd-ruling-unclassified');
});

test('reason-in-ruling-line-or-body-does-not-count: a Defer-reason mid-line or in the body is not a header reason (#3880 AC3)', () => {
  const text = 'Title: ruling\nKind: sdd-ruling\nRuling: Task 2: Ruling: defer — Defer-reason: genuinely-larger\nDefers: yes\nStaged-at: abc123\nLedger: docs/plans/x-ledger.md#5\n\nBody.\nDefer-reason: genuinely-larger\n';
  const item = resolveStaged('sdd-ruling-1.md', text);
  assert.strictEqual(item.resolution, 'pending');
  assert.strictEqual(item.reason, 'sdd-ruling-deferral-no-defer-reason');
});

test('crlf-header-parses: a CRLF ruling header is read the same as an LF one (#3880 AC4)', () => {
  assert.strictEqual(resolveStaged('sdd-ruling-1.md', RULING('Defers: no\n').replace(/\n/g, '\r\n')).resolution, 'apply');
});

test('build-deviation-unaffected: a non-ruling Pending-review item with no Defers: line still resolves apply (#3880 AC4)', () => {
  const item = resolveStaged('build-deviation-1.md', 'Title: deviation\nKind: build-deviation\n\nbody\n');
  assert.strictEqual(item.resolution, 'apply');
});

test('AC1.1 AC2.1: SDD_RULING_REASONS gains UNREADABLE; sddRulingDeferralReason(null|undefined) stays unclassified, and Defers: matches case-insensitively (#4049)', () => {
  assert.strictEqual(sddRulingDeferralReason(null), 'sdd-ruling-unclassified');
  assert.strictEqual(sddRulingDeferralReason(undefined), 'sdd-ruling-unclassified');
  assert.strictEqual(sddRulingDeferralReason('Defers: YES\nDefer-reason: blocked-dependency\n\nx'), null);
  assert.deepStrictEqual(SDD_RULING_REASONS, {
    NO_DEFER_REASON: 'sdd-ruling-deferral-no-defer-reason',
    UNCLASSIFIED: 'sdd-ruling-unclassified',
    UNREADABLE: 'sdd-ruling-unreadable',
  });
});

test('AC6.1 AC2.2: an sdd-ruling-*.md whose read throws resolves pending — sdd-ruling-unreadable, even when its content would ratify (#4049)', () => {
  const runDir = fixture({ staged: { 'sdd-ruling-1.md': RULING('Defers: no\n') }, headers: [7] });
  const failing = deps({
    readFile: (p) => {
      if (path.basename(p) === 'sdd-ruling-1.md') { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; }
      return fs.readFileSync(p, 'utf8');
    },
  });
  const item = resolveAll({ runDir, policy: 'console-auto', deps: failing }).items.find((i) => i.id === 'sdd-ruling-1.md');
  assert.strictEqual(item.resolution, 'pending');
  assert.strictEqual(item.reason, 'sdd-ruling-unreadable');
});

test('AC6.2: control — a readable ruling with no Defers: line, and an sdd-ruling-* name readSnapshot never reads, both stay unclassified (#4049)', () => {
  assert.strictEqual(resolveStaged('sdd-ruling-1.md', RULING('')).reason, 'sdd-ruling-unclassified');
  const item = resolveStaged('sdd-ruling-1.txt', RULING('Defers: no\n'));
  assert.strictEqual(item.resolution, 'pending');
  assert.strictEqual(item.reason, 'sdd-ruling-unclassified');
});

test('defers-value-other-than-yes-no-is-unclassified: a Defers: value outside yes/no fails closed, reason or not (#3880)', () => {
  for (const header of ['Defers: maybe\n', 'Defers: true\n', 'Defers:\n']) {
    const item = resolveStaged('sdd-ruling-1.md', RULING(header));
    assert.strictEqual(item.resolution, 'pending', header);
    assert.strictEqual(item.reason, 'sdd-ruling-unclassified', header);
  }
});

test('defers-no-with-one-valid-reason-resolves-apply: any Defer-reason header line makes it a deferral, and a valid one clears it (#3880)', () => {
  const item = resolveStaged('sdd-ruling-1.md', RULING('Defers: no\nDefer-reason: genuinely-larger\n'));
  assert.strictEqual(item.resolution, 'apply');
});

test('two-defers-lines-unclassified: more than one Defers: header line fails closed, whichever order (#3880)', () => {
  for (const header of ['Defers: no\nDefers: yes\n', 'Defers: yes\nDefers: no\n', 'Defers: no\nDefers: no\n']) {
    const item = resolveStaged('sdd-ruling-1.md', RULING(header));
    assert.strictEqual(item.resolution, 'pending', header);
    assert.strictEqual(item.reason, 'sdd-ruling-unclassified', header);
  }
});

test('header-keys-case-insensitive: defer-reason and defers keys match in any case; the reason VALUE stays exact (#3880)', () => {
  const lowerReason = resolveStaged('sdd-ruling-1.md', RULING('Defers: no\ndefer-reason: bogus\n'));
  assert.strictEqual(lowerReason.resolution, 'pending');
  assert.strictEqual(lowerReason.reason, 'sdd-ruling-deferral-no-defer-reason');
  assert.strictEqual(resolveStaged('sdd-ruling-1.md', RULING('defers: no\n')).resolution, 'apply');
  assert.strictEqual(resolveStaged('sdd-ruling-1.md', RULING('DEFERS: yes\nDEFER-REASON: genuinely-larger\n')).resolution, 'apply');
  assert.strictEqual(resolveStaged('sdd-ruling-1.md', RULING('Defers: yes\nDefer-reason: Genuinely-Larger\n')).resolution, 'pending');
});

test('classifyStagedItem leaves sdd-ruling-* in Pending review with no reason, so the deferral gate is the only pending path (#3880 control)', () => {
  assert.deepStrictEqual(classifyStagedItem('sdd-ruling-1.md'), { section: 'Pending review' });
});

// #3488: every staged-id producer prefix is either mapped to a console section
// or exempt (its run never reaches the console), so stage-item.js's
// unmapped-prefix refusal only fires for a genuinely unknown id.
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
