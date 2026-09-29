'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/release-note-repair');
const { bodySha, CHECK_HEADER } = require('../../../plugin/bin/lib/release-note-repair/detect');
const { onlyReleaseNoteAdded } = require('../../../plugin/bin/lib/release-note-repair/apply');
const { writeRecord, readRecord } = require('../../../plugin/bin/lib/issues/local-store');
const F = require('./fixtures');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-cli-'));
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-09-29T120000-tidy-standalone');
  const shadow = path.join(main, '.claude', 'worktrees', 'wt', '.claude-tweaks', 'pipelines', '2026-09-29T120000-tidy-standalone');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(main, '.claude', 'worktrees', 'wt', '.git'), 'gitdir: ../../../.git/worktrees/wt\n');
  const write = (name, content) => { const p = path.join(root, name); fs.writeFileSync(p, content); return p; };
  return { root, main, runDir, shadow, write };
}

function deps(cwd) {
  const out = []; const err = [];
  return {
    d: { cwd: () => cwd, mainRoot: undefined, now: () => Date.UTC(2026, 8, 29, 12, 0, 0), stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
    out: () => out.join(''), err: () => err.join(''),
  };
}

const liveJson = (body, extra = {}) => JSON.stringify({ body, labels: [{ name: 'ready' }, { name: 'auto:build' }], state: 'OPEN', ...extra });

test('scan: writes every candidate to --out and prints one summary line', () => {
  const fx = fixture();
  const records = fx.write('recs.json', JSON.stringify([
    { number: 1, title: 'A', state: 'OPEN', labels: [{ name: 'ready' }], body: F.MISSING_RN, facets: { stage: 'ready' } },
    { number: 2, title: 'B', state: 'OPEN', labels: [{ name: 'ready' }], body: F.CONFORMING, facets: { stage: 'ready' } },
  ]));
  const outFile = path.join(fx.root, 'cands.json');
  const t = deps(fx.main);
  assert.equal(run(['scan', '--driver', 'github-issues', '--records', records, '--out', outFile], t.d), 0);
  const payload = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(payload.driver, 'github-issues');
  assert.deepEqual(payload.candidates.map((c) => c.ref), ['#1']);
  assert.equal(t.out(), `—\t[release-note] 1 ready record(s) missing only a Release Note, 0 scan error(s) — Fill Release Note (candidates: ${outFile})\n`);
});

test('scan: no match writes an empty list and prints nothing; bad input is exit 2', () => {
  const fx = fixture();
  const outFile = path.join(fx.root, 'cands.json');
  const empty = fx.write('empty.json', '[]');
  const t = deps(fx.main);
  assert.equal(run(['scan', '--driver', 'github-issues', '--records', empty, '--out', outFile], t.d), 0);
  assert.equal(t.out(), '');
  assert.deepEqual(JSON.parse(fs.readFileSync(outFile, 'utf8')).candidates, []);
  assert.equal(run(['scan', '--driver', 'nope', '--records', empty, '--out', outFile], deps(fx.main).d), 2);
  assert.equal(run(['scan', '--driver', 'github-issues', '--out', outFile], deps(fx.main).d), 2);
  assert.equal(run(['scan', '--driver', 'github-issues', '--records', path.join(fx.root, 'missing.json'), '--out', outFile], deps(fx.main).d), 2);
  assert.equal(run(['scan', '--driver', 'github-issues', '--records', fx.write('obj.json', '{}'), '--out', outFile], deps(fx.main).d), 2);
  assert.equal(run(['bogus'], deps(fx.main).d), 2);
});

function githubRepair(fx, { body = F.MISSING_RN, sha = bodySha(F.MISSING_RN), line = `${F.LINE}\n`, extra = {}, dest } = {}) {
  const live = fx.write('live.json', liveJson(body, extra));
  const lineFile = fx.write('line.txt', line);
  const out = path.join(fx.root, 'repaired.md');
  const t = deps(fx.main);
  const argv = ['repair', '--driver', 'github-issues', '--ref', '7', '--live-json', live, '--expect-sha', sha, '--line-file', lineFile, '--out', out, ...(dest || ['--run', fx.runDir])];
  return { code: run(argv, t.d), out, t };
}

test('repair (github-issues): snapshots first, writes the repaired body, never touches staged/', () => {
  const fx = fixture();
  const { code, out, t } = githubRepair(fx);
  assert.equal(code, 0, t.err());
  const snap = path.join(fx.runDir, 'snapshots', 'tidy-release-note-7.original.md');
  assert.equal(fs.readFileSync(snap, 'utf8'), F.MISSING_RN);
  assert.equal(fs.readFileSync(out, 'utf8'), F.REPAIRED);
  assert.equal(fs.existsSync(path.join(fx.runDir, 'staged')), false);
  const json = JSON.parse(t.out());
  assert.equal(json.ref, '#7');
  assert.equal(json.mode, 'inserted');
  assert.equal(json.line, F.LINE);
  assert.equal(fs.realpathSync(json.snapshot), fs.realpathSync(snap));
});

test('repair: a repair with no snapshot destination, or both, is refused (exit 2)', () => {
  const fx = fixture();
  assert.equal(githubRepair(fx, { dest: [] }).code, 2);
  assert.equal(githubRepair(fx, { dest: ['--run', fx.runDir, '--snapshot-file', path.join(fx.root, 's.md')] }).code, 2);
});

test('repair: --snapshot-file writes the snapshot there (interactive, no run dir)', () => {
  const fx = fixture();
  const snap = path.join(fx.root, 'snap', 'tidy-release-note-7.original.md');
  assert.equal(githubRepair(fx, { dest: ['--snapshot-file', snap] }).code, 0);
  assert.equal(fs.readFileSync(snap, 'utf8'), F.MISSING_RN);
});

test('repair: a worktree-local shadow run dir is exit 3 and writes nothing there', () => {
  const fx = fixture();
  const { code, out } = githubRepair(fx, { dest: ['--run', fx.shadow] });
  assert.equal(code, 3);
  assert.equal(fs.existsSync(path.join(fx.shadow, 'snapshots')), false);
  assert.equal(fs.existsSync(out), false);
});

test('repair: a line failing a bound is exit 4 with the violations, nothing written', () => {
  const fx = fixture();
  const { code, out, t } = githubRepair(fx, { line: 'feat: fixes #12\n' });
  assert.equal(code, 4);
  assert.match(t.err(), /  - record-ref/);
  assert.match(t.err(), /  - conventional-prefix/);
  assert.equal(fs.existsSync(out), false);
  assert.equal(fs.existsSync(path.join(fx.runDir, 'snapshots')), false);
});

test('repair: an edited body, a closed record, or a lost ready label is a stale premise (exit 5)', () => {
  const fx = fixture();
  assert.equal(githubRepair(fx, { body: `${F.MISSING_RN}edited\n` }).code, 5);
  assert.equal(githubRepair(fx, { extra: { state: 'CLOSED' } }).code, 5);
  assert.equal(githubRepair(fx, { extra: { labels: [{ name: 'auto:build' }] } }).code, 5);
  assert.equal(fs.existsSync(path.join(fx.runDir, 'snapshots')), false);
});

test('repair: an MCP-shaped live read (lowercase state, string labels) is not stale', () => {
  const fx = fixture();
  assert.equal(githubRepair(fx, { extra: { state: 'open', labels: ['ready', 'auto:build'] } }).code, 0);
});

test('repair: a mid-line Acceptance Criteria mention the gate accepts is a repair failure (exit 6), nothing written', () => {
  const fx = fixture();
  const { code, out } = githubRepair(fx, { body: F.MIDLINE_AC, sha: bodySha(F.MIDLINE_AC) });
  assert.equal(code, 6);
  assert.equal(fs.existsSync(out), false);
  assert.equal(fs.existsSync(path.join(fx.runDir, 'snapshots')), false);
});

function localFixture(facets = {}) {
  const fx = fixture();
  const recordFile = path.join(fx.main, 'specs', '42-widget-cache.md');
  writeRecord(recordFile, { title: 'Widget cache', body: F.MISSING_RN, facets: { type: 'task', risk: 'low', size: 'small', stage: 'ready', grants: { build: true }, ...facets } });
  return { ...fx, recordFile };
}

test('repair (local-files): writes the file, keeps facets and every other byte, logs AUTO, snapshots the raw file', () => {
  const fx = localFixture();
  const rawBefore = fs.readFileSync(fx.recordFile, 'utf8');
  const before = readRecord(fx.recordFile);
  const lineFile = fx.write('line.txt', F.LINE);
  const t = deps(fx.main);
  const code = run(['repair', '--driver', 'local-files', '--ref', '42', '--record-file', fx.recordFile, '--expect-sha', bodySha(before.body), '--line-file', lineFile, '--run', fx.runDir], t.d);
  assert.equal(code, 0, t.err());
  const rawAfter = fs.readFileSync(fx.recordFile, 'utf8');
  const after = readRecord(fx.recordFile);
  assert.deepEqual(after.facets, before.facets);
  assert.equal(after.title, before.title);
  assert.equal(onlyReleaseNoteAdded(rawBefore, rawAfter, F.LINE), true);
  assert.equal(fs.readFileSync(path.join(fx.runDir, 'snapshots', 'tidy-release-note-42.original.md'), 'utf8'), rawBefore);
  const decisions = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  assert.match(decisions, /- AUTO \d\d:\d\d:\d\d — Step 7 Fill Release Note: filled the Release Note on \S*42-widget-cache\.md with /);
  assert.ok(decisions.includes(`"${F.LINE}"`));
  assert.match(decisions, /Reversibility: high\./);
  const json = JSON.parse(t.out());
  assert.equal(json.written, true);
  assert.equal(json.logged, true);
});

test('a local repair whose written file fails re-verification is restored and exits 6', () => {
  const fx = localFixture();
  const rawBefore = fs.readFileSync(fx.recordFile, 'utf8');
  const before = readRecord(fx.recordFile);
  const lineFile = fx.write('line.txt', F.LINE);
  const t = deps(fx.main);
  // Three checkBody calls happen in this order for a successful-until-the-last-check repair:
  //   1. prepareRepair's pre-write check on the live (pre-fill) body -> must read as release-note-only
  //   2. prepareRepair's post-apply check on the composed (post-fill) body -> must read as conforming
  //   3. repairLocal's own post-write re-read check on the written-then-reread body -> forced to fail
  // so the write itself still succeeds but the CLI's own re-verification catches it and restores.
  let calls = 0;
  const checkCli = () => {
    calls += 1;
    if (calls === 1) return { code: 4, stderr: `${CHECK_HEADER}\n  - missing section: ## Release Note\n` };
    if (calls === 2) return { code: 0, stderr: '' };
    return { code: 4, stderr: `${CHECK_HEADER}\n  - missing section: ## Deliverables\n` };
  };
  const code = run(['repair', '--driver', 'local-files', '--ref', '42', '--record-file', fx.recordFile, '--expect-sha', bodySha(before.body), '--line-file', lineFile, '--run', fx.runDir], { ...t.d, checkCli });
  assert.equal(code, 6);
  assert.equal(calls, 3);
  assert.equal(fs.readFileSync(fx.recordFile, 'utf8'), rawBefore);
  assert.equal(fs.existsSync(path.join(fx.runDir, 'snapshots', 'tidy-release-note-42.original.md')), true);
});

test('repair (local-files): a file rewritten by another actor between write and re-read verification is exit 8, restore refused', () => {
  const fx = localFixture();
  const rawBefore = fs.readFileSync(fx.recordFile, 'utf8');
  const before = readRecord(fx.recordFile);
  const lineFile = fx.write('line.txt', F.LINE);
  const t = deps(fx.main);
  const tampered = `${rawBefore}tampered externally\n`;
  let calls = 0;
  // Same three-call shape as the mocked-checker restore test above, except the third call also
  // simulates a concurrent external write landing on the real record file (never on the tmp file
  // checkBody hands it) before reporting a check failure — the CLI's re-read verification must
  // notice the file no longer holds what it spliced, and refuse to restore over it.
  const checkCli = () => {
    calls += 1;
    if (calls === 1) return { code: 4, stderr: `${CHECK_HEADER}\n  - missing section: ## Release Note\n` };
    if (calls === 2) return { code: 0, stderr: '' };
    fs.writeFileSync(fx.recordFile, tampered);
    return { code: 4, stderr: `${CHECK_HEADER}\n  - missing section: ## Deliverables\n` };
  };
  const code = run(['repair', '--driver', 'local-files', '--ref', '42', '--record-file', fx.recordFile, '--expect-sha', bodySha(before.body), '--line-file', lineFile, '--run', fx.runDir], { ...t.d, checkCli });
  assert.equal(code, 8, t.err());
  assert.match(t.err(), /restore refused/);
  assert.equal(fs.readFileSync(fx.recordFile, 'utf8'), tampered, 'the concurrent write must survive untouched, never overwritten by our restore');
  assert.equal(fs.readFileSync(path.join(fx.runDir, 'snapshots', 'tidy-release-note-42.original.md'), 'utf8'), rawBefore);
});

test('repair (github-issues): a reused --out path is unlinked on entry, never carries a stale prior body past a skip/failure exit', () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.root, 'repaired.md'), 'stale body from a previous record\n');
  const { code, out } = githubRepair(fx, { line: 'feat: fixes #12\n' });
  assert.equal(code, 4);
  assert.equal(fs.existsSync(out), false, '--out must be unlinked even though this run never got far enough to write it');
});

test('repair (local-files): a record edited between scan and write is skipped (exit 5), file byte-unchanged', () => {
  const fx = localFixture();
  const rawBefore = fs.readFileSync(fx.recordFile, 'utf8');
  const lineFile = fx.write('line.txt', F.LINE);
  const code = run(['repair', '--driver', 'local-files', '--ref', '42', '--record-file', fx.recordFile, '--expect-sha', bodySha(F.CONFORMING), '--line-file', lineFile, '--run', fx.runDir], deps(fx.main).d);
  assert.equal(code, 5);
  assert.equal(fs.readFileSync(fx.recordFile, 'utf8'), rawBefore);
  assert.equal(fs.existsSync(path.join(fx.runDir, 'snapshots')), false);
});

test('repair (local-files): a record no longer ready is stale (exit 5)', () => {
  const fx = localFixture({ stage: 'parked' });
  const body = readRecord(fx.recordFile).body;
  const code = run(['repair', '--driver', 'local-files', '--ref', '42', '--record-file', fx.recordFile, '--expect-sha', bodySha(body), '--line-file', fx.write('line.txt', F.LINE), '--run', fx.runDir], deps(fx.main).d);
  assert.equal(code, 5);
});

test('verify: identical labels + conforming body carrying the line is exit 0 and logs AUTO', () => {
  const fx = fixture();
  const before = fx.write('before.json', liveJson(F.MISSING_RN));
  const after = fx.write('after.json', JSON.stringify({ body: F.REPAIRED, labels: [{ name: 'auto:build' }, { name: 'ready' }], state: 'OPEN' }));
  const t = deps(fx.main);
  assert.equal(run(['verify', '--ref', '7', '--before-json', before, '--after-json', after, '--line-file', fx.write('line.txt', F.LINE), '--run', fx.runDir], t.d), 0, t.err());
  assert.deepEqual(JSON.parse(t.out()), { ref: '#7', verified: true, logged: true });
  const decisions = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  assert.ok(decisions.includes(`filled the Release Note on #7 with "${F.LINE}"; snapshot snapshots/tidy-release-note-7.original.md`));
});

test('verify: a labels-only mismatch (body verified clean) is exit 8 — never a restore candidate', () => {
  // REVISED RULING (#2828 final-fix I2): `gh issue edit --body-file` can't touch labels, so a
  // label-only diff means another actor (e.g. a grant stamping `bot:in-progress`) — there is
  // nothing here for a body-file restore to fix. This deliberately changes the prior expectation
  // (exit 7, "restore once, automatically") to exit 8, "restore refused, reported distinctly".
  const fx = fixture();
  const before = fx.write('before.json', liveJson(F.MISSING_RN));
  const after = fx.write('after.json', JSON.stringify({ body: F.REPAIRED, labels: [{ name: 'ready' }], state: 'OPEN' }));
  const t = deps(fx.main);
  assert.equal(run(['verify', '--ref', '7', '--before-json', before, '--after-json', after, '--line-file', fx.write('line.txt', F.LINE), '--run', fx.runDir], t.d), 8);
  assert.match(t.err(), /labels changed, body verified/);
  assert.match(t.err(), /label set changed/);
  assert.equal(fs.existsSync(path.join(fx.runDir, 'decisions.md')), false);
});

test('verify: a live body drifted beyond the Release Note section (Technical Approach rewritten) is exit 7, restore never attempted by the CLI', () => {
  const fx = fixture();
  const before = fx.write('before.json', liveJson(F.MISSING_RN));
  const drifted = F.REPAIRED.replace('Use a Map.', 'Use a Set.');
  const after = fx.write('after.json', JSON.stringify({ body: drifted, labels: [{ name: 'ready' }, { name: 'auto:build' }], state: 'OPEN' }));
  const t = deps(fx.main);
  assert.equal(run(['verify', '--ref', '7', '--before-json', before, '--after-json', after, '--line-file', fx.write('line.txt', F.LINE), '--run', fx.runDir], t.d), 7);
  assert.match(t.err(), /more than the Release Note section changed/);
  assert.equal(fs.existsSync(path.join(fx.runDir, 'decisions.md')), false);
});

test('--help prints usage and exits 0', () => {
  const t = deps(process.cwd());
  assert.equal(run(['--help'], t.d), 0);
  assert.match(t.out(), /usage: release-note-repair\.js scan/);
});
