'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MOD = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'console', 'resolve');
const { classifyStagedItem, resolveAll, SECTION_STANCES, SECTION_MAP } = require(MOD);

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
  'wrap-up-skill-1.md': 'skill',
  'wrap-up-doc-1.md': 'doc',
  'wrap-up-journey-1.md': 'journey',
  'tidy-claude-md-rule-1.md': 'rule',
  'reflect-1.md': 'reflect',
  'wrap-up-memory-1.md': 'memory',
  'wrap-up-upstream-1.md': 'upstream',
  'mystery-9.md': 'unmapped',
};

test('classifyStagedItem maps every known prefix to its console section and unknown prefixes to Pending review/unmapped-prefix (#1932)', () => {
  const expect = {
    'review-2.patch': 'Pending review', 'test-fix-1.patch': 'Pending review', 'deepen-collapse-1.patch': 'Pending review', 'simplify-1.patch': 'Pending review',
    'review-unconfirmed-3.md': 'Low-confidence findings', 'review-contested-4.md': 'Contested findings', 'review-debate-1.md': 'Contested findings',
    'polish-suggestion-1.md': 'Pending review', 'visual-review-skipped.md': 'Pending review', 'design-decision-2.md': 'Pending review', 'build-deviation-1.md': 'Pending review',
    'wrap-up-skill-1.md': 'Skill updates', 'wrap-up-skill-new-auth.md': 'Skill updates', 'wrap-up-skill-restructure.md': 'Skill updates',
    'wrap-up-doc-1.md': 'Documentation updates', 'release-backfill-v6.md': 'Documentation updates', 'tidy-doc-1.md': 'Documentation updates',
    'wrap-up-journey-1.md': 'Journey updates', 'journeys-convention.md': 'Journey updates',
    'tidy-claude-md-rule-1.md': 'Queue writes',
    'reflect-1.md': 'Queue writes', 'digest-promotion-1.md': 'Queue writes', 'leftover-add-oauth.md': 'Queue writes', 'ledger-record-1.md': 'Queue writes',
    'upstream-unfiled-1.md': 'Queue writes', 'red-team-1.md': 'Queue writes', 'specify-overlap-1.md': 'Queue writes', 'flaky-allowlist-x.md': 'Queue writes',
    'tidy-parked-1.md': 'Queue writes', 'plan-retention-1.md': 'Queue writes', 'feedback-drafts.md': 'Queue writes',
    'wrap-up-memory-1.md': 'Memory updates', 'wrap-up-upstream-1.md': 'Upstream feedback',
  };
  for (const [name, section] of Object.entries(expect)) {
    assert.strictEqual(classifyStagedItem(name).section, section, name);
    assert.strictEqual(classifyStagedItem(name).reason, undefined, `${name} is mapped`);
  }
  assert.deepStrictEqual(classifyStagedItem('mystery-9.md'), { section: 'Pending review', reason: 'unmapped-prefix' });
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
  assert.strictEqual(by['wrap-up-skill-1.md'].resolution, 'approve');
  assert.strictEqual(by['wrap-up-doc-1.md'].resolution, 'approve');
  assert.strictEqual(by['wrap-up-journey-1.md'].resolution, 'approve');
  assert.strictEqual(by['tidy-claude-md-rule-1.md'].resolution, 'apply');
  assert.strictEqual(by['reflect-1.md'].resolution, 'apply');
  assert.strictEqual(by['wrap-up-memory-1.md'].resolution, 'apply');
  assert.strictEqual(by['wrap-up-upstream-1.md'].resolution, 'filed');
  assert.deepStrictEqual({ resolution: by['mystery-9.md'].resolution, reason: by['mystery-9.md'].reason }, { resolution: 'pending', reason: 'unmapped-prefix' });
  assert.strictEqual(r.sections.cleanup.resolution, 'approve');
  assert.deepStrictEqual(r.merge, { resolution: 'merge', reason: 'every member carries auto:merge or a matured auto:merge-pending; no needs-human verdict' });
  assert.strictEqual(r.items.length, Object.keys(EVERY_SECTION).length);
  assert.strictEqual(r.ceiling, 'unattended');
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

test('a matured auto:merge-pending counts as granted (#1932 AC3)', () => {
  const grants = { 7: { labels: ['auto:merge-pending'], pendingSince: new Date('2026-09-01T00:00:00Z') } };
  const r = resolveAll({ runDir: fixture({ staged: { 'reflect-1.md': 'x' }, headers: [7] }), policy: 'console-auto', deps: deps({ readGrants: () => grants }) });
  assert.strictEqual(r.merge.resolution, 'merge');
});

test('readGrants throwing resolves the merge half to leave-open with reason grants-unreadable (#1932 AC3)', () => {
  const r = resolveAll({ runDir: fixture({ staged: { 'reflect-1.md': 'x' }, headers: [7] }), policy: 'console-auto', deps: deps({ readGrants: () => { throw new Error('gh: not found'); } }) });
  assert.deepStrictEqual(r.merge, { resolution: 'leave-open', reason: 'grants-unreadable' });
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

test('engine-state.json staged findings classify into their curation sections; applied ones render as applied (#1932)', () => {
  const engineState = { results: { skills: { result: 'findings', findings: [{ target: 'auth', action: 'staged', stagePath: 'staged/wrap-up-skill-1.md' }] }, references: { result: 'findings', findings: [{ target: 'docs/a.md', action: 'applied', commit: 'abc1234' }] } } };
  const r = resolveAll({ runDir: fixture({ staged: { 'wrap-up-skill-1.md': 'skill' }, engineState, headers: [7] }), policy: 'console-auto', deps: deps() });
  const ref = r.items.find((i) => i.section === 'Reference repairs');
  assert.deepStrictEqual({ resolution: ref.resolution, id: ref.id }, { resolution: 'applied', id: 'references:docs/a.md' });
  assert.strictEqual(r.items.filter((i) => i.id === 'wrap-up-skill-1.md').length, 1, 'a staged engine finding and its staged file are one item');
});

test('decisions.md STAGED coordination entries render as Low-confidence / Contested items (#1932)', () => {
  const decisions = '## /review\n- STAGED 10:00:00 — Single-read (low tier): lens "3b" finding src/a.js:4 not directly verified. Staged to Review Console as low-confidence. Reversibility: high.\n- STAGED 10:00:01 — Cross-lens debate inconclusive on src/b.js:9: staged/review-contested-1.md. Reversibility: high.\n';
  const r = resolveAll({ runDir: fixture({ decisions, staged: { 'review-contested-1.md': 'c' }, headers: [7] }), policy: 'console-auto', deps: deps() });
  assert.ok(r.items.some((i) => i.section === 'Low-confidence findings' && i.resolution === 'keep-staged'));
  assert.strictEqual(r.items.filter((i) => i.section === 'Contested findings').length, 1, 'the staged file and its decisions line are one item');
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
  for (const s of ['Auto-applied', 'Pending review', 'Low-confidence findings', 'Contested findings', 'Skill updates', 'Documentation updates', 'Journey updates', 'Configuration updates', 'Reference repairs', 'Cleanup actions', 'Queue writes', 'Memory updates', 'Upstream feedback', 'Refused — no defer reason']) {
    assert.ok(SECTION_STANCES[s] && typeof SECTION_STANCES[s].resolution === 'string', s);
  }
});
