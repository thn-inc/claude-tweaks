// tests/bin-lib/hooks/session-residue.test.js — #2736: shared session-start
// residue detection, reused by session-start.js's own advisory banners AND
// `hooks.js check-session-residue` (wrap-up's Review Console resurfacing
// check). Mirrors tests/hooks-session-start.test.js's own fixture shape
// (mkRun/mkStagedFile) since both exercise the same underlying detection.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const residue = require('../../../plugin/bin/lib/hooks/session-residue');

function tmpProject() {
  const dir = scratchDir('ct-residue-');
  fs.mkdirSync(path.join(dir, '.claude-tweaks', 'pipelines'), { recursive: true });
  return dir;
}
function mkRun(project, name, state) {
  const run = path.join(project, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(run, { recursive: true });
  if (state) fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify(state));
  return run;
}
function mkStagedFile(run, name, content) {
  const stagedDir = path.join(run, 'staged');
  fs.mkdirSync(stagedDir, { recursive: true });
  fs.writeFileSync(path.join(stagedDir, name), content || '{}');
}

test('collectStaleRuns: returns interrupted/active runs newest-first, capped at MAX_REPORTED', () => {
  const project = tmpProject();
  mkRun(project, '2026-07-01T090000-spec-1', { status: 'interrupted' });
  mkRun(project, '2026-07-02T090000-spec-2', { status: 'active' });
  mkRun(project, '2026-07-03T090000-spec-3', { status: 'interrupted' });
  mkRun(project, '2026-07-04T090000-spec-4', { status: 'active' });
  mkRun(project, '2026-06-30T090000-spec-0', { status: 'clean' });
  const entries = residue.collectStaleRuns(project);
  assert.strictEqual(entries.length, residue.MAX_REPORTED);
  assert.ok(entries[0].line.includes('spec-4'));
  assert.ok(entries[1].line.includes('spec-3'));
  assert.ok(entries[2].line.includes('spec-2'));
  assert.ok(!entries.some((e) => e.line.includes('spec-1')), 'oldest of 4 non-clean runs excluded by the cap');
  assert.ok(!entries.some((e) => e.line.includes('spec-0')), 'clean run excluded before the cap runs');
});

test('collectStaleRuns: an ordinary interrupted/active run renders the base status line, no shipped-unclosed embellishment', () => {
  const project = tmpProject();
  mkRun(project, '2026-07-01T090000-spec-1', { status: 'interrupted' });
  const entries = residue.collectStaleRuns(project, { pluginRoot: '/plugins/claude-tweaks' });
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].line, '- 2026-07-01T090000-spec-1 (status: interrupted)');
  assert.doesNotMatch(entries[0].line, /appears shipped/);
});

test('collectStaleRuns: exclude drops the named run dir from the result, even given a non-realpath\'d path', () => {
  const project = tmpProject();
  const own = mkRun(project, '2026-07-02T090000-spec-2', { status: 'active' });
  mkRun(project, '2026-07-01T090000-spec-1', { status: 'interrupted' });
  const entries = residue.collectStaleRuns(project, { exclude: own });
  assert.strictEqual(entries.length, 1);
  assert.match(entries[0].line, /spec-1/);
  assert.ok(!entries.some((e) => e.line.includes('spec-2')), "the excluded run's own dir must never appear");
});

test('#2783 collectStaleRuns: ad-hoc dirs never crowd a genuinely interrupted formal run out of the capped report', () => {
  const project = tmpProject();
  mkRun(project, '2026-10-01T000000-spec-9', { status: 'interrupted', sessionId: 'X', worktree: '/gone/a' });
  for (let i = 2; i <= 4; i++) mkRun(project, `2026-10-0${i}T000000-adhoc-standalone`, { status: 'active', sessionId: `S${i}`, worktree: `/gone/w${i}` });
  const lines = residue.collectStaleRuns(project).map((e) => e.line);
  assert.deepStrictEqual(lines, ['- 2026-10-01T000000-spec-9 (status: interrupted)']);
});

test('collectStaleRuns: empty when no non-clean run dir exists', () => {
  const project = tmpProject();
  mkRun(project, '2026-06-30T090000-spec-0', { status: 'clean' });
  assert.deepStrictEqual(residue.collectStaleRuns(project), []);
});

test('collectApprovableStandalone: reports a clean tidy-standalone run with non-empty staged/', () => {
  const project = tmpProject();
  const standalone = mkRun(project, '2026-07-02T090000-tidy-standalone', { status: 'clean' });
  mkStagedFile(standalone, 'stale-close-1.json');
  const entries = residue.collectApprovableStandalone(project);
  assert.strictEqual(entries.length, 1);
  assert.match(entries[0].line, /2026-07-02T090000-tidy-standalone/);
  assert.match(entries[0].line, /\/claude-tweaks:tidy --approve/);
});

test('collectApprovableStandalone: reports a clean sweep-standalone run with non-empty staged/', () => {
  const project = tmpProject();
  const standalone = mkRun(project, '2026-07-02T090000-sweep-standalone', { status: 'clean' });
  mkStagedFile(standalone, 'stale-close-1.json');
  const entries = residue.collectApprovableStandalone(project);
  assert.strictEqual(entries.length, 1);
  assert.match(entries[0].line, /2026-07-02T090000-sweep-standalone/);
});

test('collectApprovableStandalone: omits a clean standalone run with an empty staged/', () => {
  const project = tmpProject();
  const standalone = mkRun(project, '2026-07-02T090000-tidy-standalone', { status: 'clean' });
  fs.mkdirSync(path.join(standalone, 'staged'), { recursive: true });
  assert.deepStrictEqual(residue.collectApprovableStandalone(project), []);
});

test('collectApprovableStandalone: omits a non-standalone clean run even with staged/ present', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-07-02T090000-spec-9', { status: 'clean' });
  mkStagedFile(run, 'review-1.patch');
  assert.deepStrictEqual(residue.collectApprovableStandalone(project), []);
});

test('collectApprovableStandalone: exclude drops the named run dir from the result', () => {
  const project = tmpProject();
  const own = mkRun(project, '2026-07-02T090000-tidy-standalone', { status: 'clean' });
  mkStagedFile(own, 'stale-close-1.json');
  const entries = residue.collectApprovableStandalone(project, { exclude: own });
  assert.deepStrictEqual(entries, []);
});

// #3370: closed and archived runs whose unattended Review Console left
// pending / keep-staged items no human has reviewed.
// #3772: an item whose staged file is gone is `missing`, not residue — so each
// fixture item gets the staged file it names, unless `{ stage: false }`.
function mkConsole(runDir, items, extra, { stage = true } = {}) {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true, items, ...extra }));
  if (stage) for (const { id } of items) mkStagedFile(runDir, id, 'x');
}
function mkArchived(project, name) {
  return path.join(project, '.claude-tweaks', 'pipelines', 'archive', name);
}
const PENDING = (id) => ({ id, section: 'Pending review', resolution: 'pending', reason: 'unmapped-prefix' });
const CONTESTED = (id) => ({ id, section: 'Contested findings', resolution: 'keep-staged', reason: 'debate inconclusive' });

test('collectUnresolvedConsoles surfaces an archived run\'s unmapped-prefix and contested items with a paste-ready command', () => {
  const project = tmpProject();
  const run = mkArchived(project, '2026-10-16T210949-spec-2821');
  mkConsole(run, [PENDING('review-13-record.md'), CONTESTED('review-debate-deviation.md')]);
  mkStagedFile(run, 'review-13-record.md', 'x');
  mkStagedFile(run, 'review-debate-deviation.md', 'y');
  const entries = residue.collectUnresolvedConsoles(project, { pluginRoot: '/plugins/claude-tweaks' });
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].dir, run);
  const text = entries[0].lines.join('\n');
  assert.match(text, /review-13-record\.md/);
  assert.match(text, /review-debate-deviation\.md/);
  assert.ok(entries[0].lines.includes(`    cat "${path.join(run, 'staged', 'review-13-record.md')}"`));
  assert.ok(entries[0].lines.includes(`  mark reviewed: node "/plugins/claude-tweaks/bin/console-residue.js" --ack --run "${run}"`));
});

test('AC3.4: the SessionStart console scan skips a run whose pending items\' staged files are all gone (#3772)', () => {
  const project = tmpProject();
  mkConsole(mkArchived(project, '2026-10-19T131646-spec-3258'), [PENDING('wrap-up-docs-1.md')], undefined, { stage: false });
  assert.deepStrictEqual(residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' }), []);
});

test('the SessionStart console scan names the missing items of a spec console that has no present items (#3772)', () => {
  const project = tmpProject();
  const run = mkArchived(project, '2026-10-19T131646-spec-3258');
  mkConsole(run, [PENDING('wrap-up-docs-1.md')]);
  mkConsole(path.join(run, 'spec-2'), [PENDING('wrap-up-docs-2.md')], undefined, { stage: false });
  const entries = residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' });
  assert.strictEqual(entries.length, 1);
  const notCounted = entries[0].lines.filter((l) => l.startsWith('  not counted — '));
  assert.strictEqual(notCounted.length, 1, entries[0].lines.join('\n'));
  assert.ok(notCounted[0].includes(path.join('spec-2', 'staged', 'wrap-up-docs-2.md')), notCounted[0]);
});

test('collectUnresolvedConsoles: acknowledged consoles are skipped', () => {
  const project = tmpProject();
  mkConsole(mkArchived(project, '2026-10-16T210949-spec-1'), [PENDING('a.md')], { residueAcknowledgedAt: '2026-10-17T00:00:00.000Z' });
  assert.deepStrictEqual(residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' }), []);
});

test('collectUnresolvedConsoles: a run is kept for its unacknowledged console only', () => {
  const project = tmpProject();
  const run = mkArchived(project, '2026-10-16T210949-spec-1');
  mkConsole(run, [PENDING('acked-top.md')], { residueAcknowledgedAt: '2026-10-17T00:00:00.000Z' });
  mkConsole(path.join(run, 'spec-2'), [PENDING('open-sub.md')]);
  const entries = residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' });
  assert.strictEqual(entries.length, 1);
  const text = entries[0].lines.join('\n');
  assert.match(text, /open-sub\.md/);
  assert.doesNotMatch(text, /acked-top\.md/);
});

test('collectUnresolvedConsoles: a clean un-archived run is surfaced too', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-10-16T210949-spec-3', { status: 'clean' });
  mkConsole(run, [PENDING('b.md')]);
  const entries = residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' });
  assert.deepStrictEqual(entries.map((e) => e.dir), [run]);
});

test('collectUnresolvedConsoles: a non-clean top-level run is left to collectStaleRuns', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-10-16T210949-spec-3', { status: 'interrupted' });
  mkConsole(run, [PENDING('b.md')]);
  assert.deepStrictEqual(residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' }), []);
});

test('collectUnresolvedConsoles: a basename in both the top level and archive/ is reported once, top-level dir preferred', () => {
  const project = tmpProject();
  const top = mkRun(project, '2026-10-16T210949-spec-4', { status: 'clean' });
  mkConsole(top, [PENDING('c.md')]);
  mkConsole(mkArchived(project, '2026-10-16T210949-spec-4'), [PENDING('c.md')]);
  const entries = residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' });
  assert.deepStrictEqual(entries.map((e) => e.dir), [top]);
});

test('collectUnresolvedConsoles: top-level and archived runs merge newest-first by basename', () => {
  const project = tmpProject();
  const older = mkArchived(project, '2026-10-01T000000-spec-1');
  const newer = mkRun(project, '2026-10-05T000000-spec-2', { status: 'clean' });
  const newest = mkArchived(project, '2026-10-09T000000-spec-3');
  for (const d of [older, newer, newest]) mkConsole(d, [PENDING('d.md')]);
  const entries = residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' });
  assert.deepStrictEqual(entries.map((e) => e.dir), [newest, newer, older]);
});

test('collectUnresolvedConsoles: non-run-id names under archive/ are ignored', () => {
  const project = tmpProject();
  mkConsole(mkArchived(project, 'not-a-run'), [PENDING('e.md')]);
  assert.deepStrictEqual(residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' }), []);
});

test('collectUnresolvedConsoles: exclude drops the caller\'s own run', () => {
  const project = tmpProject();
  const own = mkArchived(project, '2026-10-16T210949-spec-5');
  mkConsole(own, [PENDING('f.md')]);
  assert.deepStrictEqual(residue.collectUnresolvedConsoles(project, { pluginRoot: '/p', exclude: own }), []);
});

test('collectUnresolvedConsoles: a missing archive/ and a run with no console.json yield nothing, never throw', () => {
  const project = tmpProject();
  mkRun(project, '2026-10-16T210949-spec-6', { status: 'clean' });
  assert.deepStrictEqual(residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' }), []);
});

test('collectUnresolvedConsoles: stops reading once limit runs are kept', () => {
  const project = tmpProject();
  const names = [1, 2, 3, 4, 5, 6].map((n) => `2026-10-0${n}T000000-spec-${n}`);
  for (const n of names) mkConsole(mkArchived(project, n), [PENDING('g.md')]);
  const reads = [];
  const readFile = (p) => { reads.push(p); return fs.readFileSync(p, 'utf8'); };
  const entries = residue.collectUnresolvedConsoles(project, { pluginRoot: '/p', readFile });
  assert.strictEqual(entries.length, residue.MAX_REPORTED);
  assert.deepStrictEqual(entries.map((e) => path.basename(e.dir)), names.slice(-residue.MAX_REPORTED).reverse());
  assert.ok(reads.filter((p) => p.endsWith('console.json')).length <= residue.MAX_REPORTED, `read ${reads.length} consoles`);
});

test('collectUnresolvedConsoles: limit Infinity returns every unresolved run', () => {
  const project = tmpProject();
  for (const n of [1, 2, 3, 4, 5]) mkConsole(mkArchived(project, `2026-10-0${n}T000000-spec-${n}`), [PENDING('h.md')]);
  assert.strictEqual(residue.collectUnresolvedConsoles(project, { pluginRoot: '/p', limit: Infinity }).length, 5);
});

// #3370 F1: the scan window bounds the all-acknowledged steady state.
const runName = (i) => `2026-01-01T${String(i).padStart(6, '0')}-spec-${i}`;

test('scanUnresolvedConsoles: all-acknowledged steady state reads at most SCAN_WINDOW consoles', () => {
  assert.strictEqual(residue.SCAN_WINDOW, 200);
  const project = tmpProject();
  for (let i = 1; i <= 210; i++) {
    mkConsole(mkArchived(project, runName(i)), [PENDING('a.md')], { residueAcknowledgedAt: '2026-10-17T00:00:00.000Z' });
  }
  const reads = [];
  const readFile = (p) => { reads.push(p); return fs.readFileSync(p, 'utf8'); };
  const { runs, more } = residue.scanUnresolvedConsoles(project, { pluginRoot: '/p', readFile });
  assert.deepStrictEqual(runs, []);
  assert.strictEqual(more, true, 'the window cut 10 candidates off');
  const consoleReads = reads.filter((p) => p.endsWith('console.json'));
  assert.ok(consoleReads.length <= residue.SCAN_WINDOW, `read ${consoleReads.length} consoles`);
  assert.ok(!consoleReads.some((p) => p.includes(runName(10))), 'an out-of-window run is never read');
});

test('scanUnresolvedConsoles: more is true when the window cuts candidates off, false when it does not', () => {
  const project = tmpProject();
  for (const i of [1, 2, 3]) mkConsole(mkArchived(project, runName(i)), [PENDING('a.md')]);
  const cut = residue.scanUnresolvedConsoles(project, { pluginRoot: '/p', window: 2 });
  assert.deepStrictEqual(cut.runs.map((r) => path.basename(r.dir)), [runName(3), runName(2)]);
  assert.strictEqual(cut.more, true);
  const whole = residue.scanUnresolvedConsoles(project, { pluginRoot: '/p' });
  assert.strictEqual(whole.runs.length, 3);
  assert.strictEqual(whole.more, false);
});

test('scanUnresolvedConsoles: more is true when limit stops the scan with candidates left', () => {
  const project = tmpProject();
  for (const i of [1, 2, 3, 4]) mkConsole(mkArchived(project, runName(i)), [PENDING('a.md')]);
  const r = residue.scanUnresolvedConsoles(project, { pluginRoot: '/p' });
  assert.strictEqual(r.runs.length, residue.MAX_REPORTED);
  assert.strictEqual(r.more, true);
  assert.strictEqual(residue.scanUnresolvedConsoles(project, { pluginRoot: '/p', limit: 4 }).more, false);
});

test('scanUnresolvedConsoles: a clean top-level run is surfaced, a non-clean one is not, inside the window', () => {
  const project = tmpProject();
  const clean = mkRun(project, runName(5), { status: 'clean' });
  mkConsole(clean, [PENDING('b.md')]);
  mkConsole(mkRun(project, runName(6), { status: 'interrupted' }), [PENDING('b.md')]);
  mkConsole(mkRun(project, runName(7)), [PENDING('b.md')]);
  const { runs, more } = residue.scanUnresolvedConsoles(project, { pluginRoot: '/p' });
  assert.deepStrictEqual(runs.map((r) => r.dir), [clean]);
  assert.strictEqual(more, false);
});

test('scanUnresolvedConsoles: a clean top-level run whose archive twin is clean yields the archived copy', () => {
  const project = tmpProject();
  const top = mkRun(project, runName(8), { status: 'clean' });
  mkConsole(top, [PENDING('c.md')]);
  const twin = mkArchived(project, runName(8));
  mkConsole(twin, [PENDING('c.md')]);
  fs.writeFileSync(path.join(twin, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  assert.deepStrictEqual(residue.scanUnresolvedConsoles(project, { pluginRoot: '/p' }).runs.map((r) => r.dir), [twin]);
});

// The twin rule mirrors iterRunDirsWithState's (context.js): an archive twin
// that is clean, or `archiving` under a fresh claim, owns the run; one whose
// claim went stale (the archival died) leaves the top-level clean copy as the run.
test('scanUnresolvedConsoles: a fresh archiving twin owns the run — its archive copy is read, the top-level copy is not', () => {
  const project = tmpProject();
  const top = mkRun(project, runName(9), { status: 'clean' });
  mkConsole(top, [PENDING('d.md')]);
  const twin = mkArchived(project, runName(9));
  mkConsole(twin, [PENDING('d.md')]);
  fs.writeFileSync(path.join(twin, 'run-state.json'), JSON.stringify({ status: 'archiving', updatedAt: new Date().toISOString() }));
  assert.deepStrictEqual(residue.scanUnresolvedConsoles(project, { pluginRoot: '/p' }).runs.map((r) => r.dir), [twin]);
});

test('scanUnresolvedConsoles: a stale archiving twin does not own the run — the top-level clean copy is surfaced', () => {
  const project = tmpProject();
  const top = mkRun(project, runName(10), { status: 'clean' });
  mkConsole(top, [PENDING('e.md')]);
  const twin = mkArchived(project, runName(10));
  fs.mkdirSync(twin, { recursive: true });
  fs.writeFileSync(path.join(twin, 'run-state.json'), JSON.stringify({ status: 'archiving', updatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }));
  assert.deepStrictEqual(residue.scanUnresolvedConsoles(project, { pluginRoot: '/p' }).runs.map((r) => r.dir), [top]);
});

test('scanUnresolvedConsoles: window Infinity with limit Infinity reaches runs beyond SCAN_WINDOW', () => {
  const project = tmpProject();
  for (let i = 1; i <= 205; i++) mkConsole(mkArchived(project, runName(i)), [PENDING('a.md')]);
  const { runs, more } = residue.scanUnresolvedConsoles(project, { pluginRoot: '/p', limit: Infinity, window: Infinity });
  assert.strictEqual(runs.length, 205);
  assert.strictEqual(more, false);
});

// #3497: a multi-spec run whose consolidated Review Console pass never ran
// names its re-entry command in the banner line. The fixture is a real git repo
// (modeled on tests/run-integrity.test.js's fixtureRepo): `trunk` integration
// branch, a linked worktree on `feat-branch` with one commit dated after the
// run dir's own start prefix, and a multi-spec run dir recording that worktree.
const { reentryFixture, reentryGit, writeReentryManifest, EV_BUILD } = require('../../helpers/reentry-fixture');

const reentrySuffix = (runDir) => ` — consolidated pass never ran: PIPELINE_RUN_DIR="${runDir}" /claude-tweaks:flow #11,#12 review-console`;

test('AC5.1 eligible multi-spec parent line ends with the review-console command', () => {
  const { root, runDir } = reentryFixture();
  const entries = residue.collectStaleRuns(root, { pluginRoot: '/plugins/claude-tweaks' });
  assert.strictEqual(entries.length, 1);
  assert.ok(entries[0].line.startsWith('- 2026-08-01T090000-spec-11-12 (status: active)'), entries[0].line);
  assert.ok(entries[0].line.endsWith(reentrySuffix(runDir)), entries[0].line);
});

test('AC1.1 local-files CLAUDE.md -> suffix lists bare ids', () => {
  const { root, runDir } = reentryFixture();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# P\n\nwork-backend: local-files\n');
  const entries = residue.collectStaleRuns(root, { pluginRoot: '/plugins/claude-tweaks' });
  assert.strictEqual(entries.length, 1);
  assert.ok(entries[0].line.endsWith(` — consolidated pass never ran: PIPELINE_RUN_DIR="${runDir}" /claude-tweaks:flow 11,12 review-console`), entries[0].line);
});

test('AC1.2 github-issues CLAUDE.md keeps the # ids', () => {
  const { root, runDir } = reentryFixture();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# P\n\nwork-backend: github-issues\n');
  const entries = residue.collectStaleRuns(root, { pluginRoot: '/plugins/claude-tweaks' });
  assert.strictEqual(entries.length, 1);
  assert.ok(entries[0].line.endsWith(reentrySuffix(runDir)), entries[0].line);
});

test('#3554 unknown work-backend keeps the # ids', () => {
  const { root, runDir } = reentryFixture();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# P\n\nwork-backend: jira\n');
  const entries = residue.collectStaleRuns(root, { pluginRoot: '/plugins/claude-tweaks' });
  assert.strictEqual(entries.length, 1);
  assert.ok(entries[0].line.endsWith(reentrySuffix(runDir)), entries[0].line);
});

test('#3554 the suffix reads the main checkout CLAUDE.md, not the worktree one', () => {
  const { wt, runDir } = reentryFixture();
  fs.writeFileSync(path.join(wt, 'CLAUDE.md'), '# P\n\nwork-backend: local-files\n');
  const entries = residue.collectStaleRuns(wt, { pluginRoot: '/plugins/claude-tweaks' });
  assert.strictEqual(entries.length, 1);
  assert.ok(entries[0].line.endsWith(reentrySuffix(runDir)), entries[0].line);
});

test('#3497 review a non-integer manifest id suppresses the suffix', () => {
  const { root, runDir } = reentryFixture();
  const text = fs.readFileSync(path.join(runDir, 'manifest.yml'), 'utf8').replace('- id: 12', '- id: 12; rm -rf x');
  fs.writeFileSync(path.join(runDir, 'manifest.yml'), text);
  const entries = residue.collectStaleRuns(root, { pluginRoot: '/plugins/claude-tweaks' });
  assert.strictEqual(entries.length, 1);
  assert.doesNotMatch(entries[0].line, /review-console/);
});

test('AC5.1 ineligible variants carry no suffix', () => {
  const mutations = {
    'console.json written': (runDir) => fs.writeFileSync(path.join(runDir, 'console.json'), '{}'),
    'spec 12 running': (runDir) => writeReentryManifest(runDir, ['complete', 'running']),
    'mode interactive': (runDir) => fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: interactive\n'),
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const { root, runDir } = reentryFixture();
    mutate(runDir);
    const entries = residue.collectStaleRuns(root, { pluginRoot: '/plugins/claude-tweaks' });
    assert.strictEqual(entries.length, 1, label);
    assert.doesNotMatch(entries[0].line, /review-console/, label);
  }
});

test('AC5.1 merged branch -> no suffix and no shipped line', () => {
  const { root } = reentryFixture();
  reentryGit(root, 'merge', '-q', '--no-edit', 'feat-branch');
  const entries = residue.collectStaleRuns(root, { pluginRoot: '/plugins/claude-tweaks' });
  assert.strictEqual(entries.length, 1);
  assert.doesNotMatch(entries[0].line, /review-console/);
  assert.doesNotMatch(entries[0].line, /appears shipped/);
});

test('AC5.1 shipped-unclosed keeps the shipped line, no suffix', () => {
  const { root } = reentryFixture({ events: [EV_BUILD] });
  reentryGit(root, 'merge', '-q', '--no-edit', 'feat-branch');
  const entries = residue.collectStaleRuns(root, { pluginRoot: '/plugins/claude-tweaks' });
  assert.strictEqual(entries.length, 1);
  assert.match(entries[0].line, /appears shipped/);
  assert.doesNotMatch(entries[0].line, /review-console/);
});

test('#3497 I1 banner carries no suffix while the parent worktree is locked by a live pid', () => {
  const { root, wt } = reentryFixture();
  reentryGit(root, 'worktree', 'lock', '--reason', `claude session (pid ${process.pid})`, wt);
  const entries = residue.collectStaleRuns(root, { pluginRoot: '/plugins/claude-tweaks' });
  assert.strictEqual(entries.length, 1);
  assert.ok(entries[0].line.startsWith('- 2026-08-01T090000-spec-11-12 (status: active)'), entries[0].line);
  assert.doesNotMatch(entries[0].line, /review-console/);
});

// #5377: collectStaleRuns and the check-session-residue verb run the integrity check's git children in
// the env the caller passes. The passed env is clean while the real process.env names no repository for
// the length of the call (restored in `finally`); the same call without `env` is the control and cannot
// see the merge.
const { hookEnv, runHookCli } = require('../../helpers/hook-event');
const { withBrokenGitDir } = require('../../helpers/process-env');

test('#5377 collectStaleRuns env: the shipped-unclosed verdict is reached through the passed env', () => {
  const { root } = reentryFixture({ events: [EV_BUILD] });
  reentryGit(root, 'merge', '-q', '--no-edit', 'feat-branch');
  const env = hookEnv();
  const withEnv = withBrokenGitDir(() => residue.collectStaleRuns(root, { pluginRoot: '/plugins/claude-tweaks', env }));
  assert.match(withEnv[0].line, /appears shipped/);
  const control = withBrokenGitDir(() => residue.collectStaleRuns(root, { pluginRoot: '/plugins/claude-tweaks' }));
  assert.doesNotMatch(control[0].line, /appears shipped/, 'control: without env the broken GIT_DIR is seen');
});

// checkPassReentry's liveness probes take the passed env too, but this test reads only the landed
// check's options, through an injected spy, with the caller's own session id skipping liveness.
test('#5377 checkPassReentry env: checkBranchLanded gets the passed env, and exactly { cache } when none is passed', () => {
  const { runDir } = reentryFixture();
  const stateFile = path.join(runDir, 'run-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(stateFile, 'utf8')), sessionId: 'S-5377' }));
  const passReentry = require('../../../plugin/bin/lib/flow/consolidated-pass');
  const seen = [];
  const deps = { checkBranchLanded: (_dir, opts) => { seen.push(opts); return { landed: false }; } };
  const env = hookEnv();
  assert.strictEqual(passReentry.checkPassReentry(runDir, { env, sessionId: 'S-5377', deps }).eligible, true);
  assert.strictEqual(passReentry.checkPassReentry(runDir, { sessionId: 'S-5377', deps }).eligible, true);
  assert.strictEqual(seen[0].env, env);
  assert.deepStrictEqual(Object.keys(seen[1]), ['cache']);
});

// The recorded worktree is live, so parentLiveDetail runs the liveness probes (worktree lock, last commit)
// and the landed check, every one of them a git child that must run in the passed env.
test('#5377 collectStaleRuns env: the re-entry check with a live recorded worktree runs its probes and landed check in the passed env', () => {
  const { root, wt, runDir } = reentryFixture();
  assert.ok(fs.existsSync(wt), 'precondition: the recorded worktree exists');
  const env = hookEnv();
  const withEnv = withBrokenGitDir(() => residue.collectStaleRuns(root, { pluginRoot: '/plugins/claude-tweaks', env }));
  assert.ok(withEnv[0].line.endsWith(reentrySuffix(runDir)), withEnv[0].line);
  const control = withBrokenGitDir(() => residue.collectStaleRuns(root, { pluginRoot: '/plugins/claude-tweaks' }));
  assert.doesNotMatch(control[0].line, /review-console/, 'control: without env the broken GIT_DIR is seen');
});

test('#5377 checkResumeFreshness env: an interrupted run with a live worktree is judged stale through the passed env', () => {
  const { runDir } = reentryFixture();
  const stateFile = path.join(runDir, 'run-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(stateFile, 'utf8')), status: 'interrupted' }));
  const { checkResumeFreshness } = require('../../../plugin/bin/lib/hooks/resume-freshness');
  const env = hookEnv();
  assert.strictEqual(withBrokenGitDir(() => checkResumeFreshness(runDir, { env })).verdict, 'stale');
  assert.strictEqual(withBrokenGitDir(() => checkResumeFreshness(runDir)).verdict, 'indeterminate', 'control: without env the broken GIT_DIR is seen');
});

test('#5377 collectStaleRuns env: an interrupted multi-spec run reaches checkResumeFreshness and the landed check through the passed env', () => {
  const { root, runDir } = reentryFixture();
  const stateFile = path.join(runDir, 'run-state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(stateFile, 'utf8')), status: 'interrupted' }));
  const env = hookEnv();
  const withEnv = withBrokenGitDir(() => residue.collectStaleRuns(root, { pluginRoot: '/plugins/claude-tweaks', env }));
  assert.ok(withEnv[0].line.endsWith(reentrySuffix(runDir)), withEnv[0].line);
  const control = withBrokenGitDir(() => residue.collectStaleRuns(root, { pluginRoot: '/plugins/claude-tweaks' }));
  assert.doesNotMatch(control[0].line, /review-console/, 'control: without env the broken GIT_DIR is seen');
});

test('#5377 lastCommitMs env: an unborn HEAD is recognised through the passed env', () => {
  const { execFileSync } = require('child_process');
  const { lastCommitMs } = require('../../../plugin/bin/lib/run-liveness/probes');
  const repo = fs.realpathSync(scratchDir('ct-sr5377-unborn-'));
  execFileSync('git', ['init', '-q', repo], { env: hookEnv() });
  const env = hookEnv();
  assert.strictEqual(withBrokenGitDir(() => lastCommitMs(repo, env)), null);
  assert.throws(() => withBrokenGitDir(() => lastCommitMs(repo)), /could not read the last commit time/, 'control: without env the broken GIT_DIR is seen');
});

test('#5377 probesFor: no env returns DEFAULT_PROBES itself, an env binds the ps child to it', () => {
  const cp = require('child_process');
  const { probesFor, DEFAULT_PROBES } = require('../../../plugin/bin/lib/run-liveness/probes');
  assert.strictEqual(probesFor(undefined), DEFAULT_PROBES);
  const real = cp.execFileSync;
  let seen = null;
  cp.execFileSync = (file, args, opts) => { seen = opts; return 'Sat Oct 24 08:08:15 2026\n'; };
  let started;
  try {
    started = probesFor({ SENTINEL_5377: 'ctx-env' }).pidStartTime(process.pid);
  } finally {
    cp.execFileSync = real;
  }
  if (process.platform === 'win32') {
    // pidStartTime is null on win32 by design (process-probe.js) and never starts ps.
    assert.strictEqual(started, null);
    assert.strictEqual(seen, null);
  } else {
    assert.strictEqual(started, 'Sat Oct 24 08:08:15 2026');
    assert.strictEqual(seen.env.SENTINEL_5377, 'ctx-env');
    assert.strictEqual(seen.env.LC_ALL, 'C');
  }
});

test('#5377 check-session-residue verb: the shipped-unclosed verdict is reached through the verb env', async () => {
  const { root } = reentryFixture({ events: [EV_BUILD] });
  reentryGit(root, 'merge', '-q', '--no-edit', 'feat-branch');
  const own = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-02T090000-own');
  fs.mkdirSync(own, { recursive: true });
  fs.writeFileSync(path.join(own, 'decisions.md'), '');
  const env = hookEnv();
  // The broken GIT_DIR stays in place until the awaited call settles.
  const { code, stdout } = await withBrokenGitDir(() => runHookCli(['check-session-residue', '--run', own], { cwd: root, env }));
  assert.strictEqual(code, 0);
  assert.match(stdout, /appears shipped/);
});
