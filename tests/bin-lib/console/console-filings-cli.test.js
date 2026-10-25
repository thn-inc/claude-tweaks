'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const { run, USAGE } = require(path.join(ROOT, 'plugin', 'bin', 'console-filings'));
const { extractFingerprint } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'issues', 'record'));

const fixtureRoots = [];
after(() => { for (const r of fixtureRoots) fs.rmSync(r, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfl-'));
  fixtureRoots.push(root);
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-10-24T090000-spec-12');
  const shadow = path.join(main, '.claude', 'worktrees', 'flow-spec-12', '.claude-tweaks', 'pipelines', '2026-10-24T090000-spec-12');
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.mkdirSync(path.join(shadow, 'staged'), { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(main, '.claude', 'worktrees', 'flow-spec-12', '.git'), 'gitdir: ../../../.git/worktrees/flow-spec-12\n');
  return { root, main, runDir, shadow, outDir: path.join(root, 'out'), existing: path.join(root, 'existing.json') };
}

function fakeDeps(cwd, overrides = {}) {
  const out = []; const err = [];
  return {
    deps: {
      cwd: () => cwd,
      readFile: (p) => fs.readFileSync(p, 'utf8'),
      readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
      writeFile: (p, s) => fs.writeFileSync(p, s),
      mkdir: (p) => fs.mkdirSync(p, { recursive: true }),
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      ...overrides,
    },
    out,
    err,
  };
}

// A can't-tell console verdict line, as the tiebreak resolver logs it.
const verdictLine = ({ id, file, line, recommendation }) => `- STAGED 10:00:00 — Tiebreak tiebreak:${id}: lens "3a" finding ${file}:${line} console: verdict:cant-tell. Severity: medium. Recommendation: ${recommendation}.`;

// n can't-tell findings; `lineShift` moves every finding's line, which changes its id but not its claim.
function seed(f, { n = 3, lineShift = 0, dir = f.runDir } = {}) {
  const ids = Array.from({ length: n }, (_, i) => (lineShift * 16 + i + 1).toString(16).padStart(12, '0'));
  const findings = ids.map((id, i) => ({
    id, lens: '3a', path: `src/f${i}.js`, line: 10 + i + lineShift, claim: `The guard in f${i} runs after the read`, reporterSeverity: 'medium', kind: 'unconfirmed',
  }));
  // One carries recommendation drop: unattended, an agent that could not tell still files it.
  const lines = findings.map((x, i) => verdictLine({ id: x.id, file: x.path, line: x.line, recommendation: i === 1 ? 'drop' : 'file' }));
  fs.writeFileSync(path.join(dir, 'decisions.md'), `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'review-findings.json'), JSON.stringify(findings));
  return { ids, findings };
}

const argvOf = (f, extra = []) => ['--run', f.runDir, '--existing', f.existing, '--out-dir', f.outDir, ...extra];
const noRecords = (f) => fs.writeFileSync(f.existing, '[]');

test('AC5: N can\'t-tell items with an empty record map write N proposals', () => {
  const f = fixture();
  const { ids } = seed(f, { n: 3 });
  noRecords(f);
  const { deps, out } = fakeDeps(f.main);
  assert.equal(run(argvOf(f), deps), 0);
  const result = JSON.parse(out.join(''));
  assert.equal(result.file.length, 3);
  assert.deepEqual(result.deduped, []);
  assert.deepEqual(result.file.map((x) => x.item).sort(), ids.map((id) => `tiebreak:${id}`).sort(), 'the drop-recommendation item is planned too');
  result.file.forEach((x, i) => {
    assert.equal(x.proposal, path.join(f.outDir, `console-filing-${i + 1}.md`));
    const text = fs.readFileSync(x.proposal, 'utf8');
    assert.match(text, /^Title: /);
    assert.match(text, /^Labels: needs:definition$/m);
    assert.match(text, /^Defer-reason: needs-human-decision$/m);
    assert.equal(extractFingerprint(text), x.fingerprint);
  });
  assert.deepEqual(fs.readdirSync(f.outDir).sort(), ['console-filing-1.md', 'console-filing-2.md', 'console-filing-3.md']);
});

test('AC5: a re-run with the created records in --existing writes zero', () => {
  const f = fixture();
  seed(f, { n: 3 });
  noRecords(f);
  const first = fakeDeps(f.main);
  assert.equal(run(argvOf(f), first.deps), 0);
  const created = JSON.parse(first.out.join('')).file;
  fs.writeFileSync(f.existing, JSON.stringify(created.map((x, i) => ({ number: 100 + i, body: fs.readFileSync(x.proposal, 'utf8') }))));
  const again = { ...f, outDir: path.join(f.root, 'out2') };
  const second = fakeDeps(f.main);
  assert.equal(run(argvOf(again), second.deps), 0);
  const result = JSON.parse(second.out.join(''));
  assert.deepEqual(result.file, []);
  assert.deepEqual(result.deduped.map((d) => d.number).sort(), [100, 101, 102]);
  assert.deepEqual(result.deduped.map((d) => d.fingerprint).sort(), created.map((x) => x.fingerprint).sort());
  assert.equal(fs.existsSync(again.outDir) ? fs.readdirSync(again.outDir).length : 0, 0, 'nothing is written');
});

test('AC5: the same finding at a different line in a later run is deduplicated', () => {
  const f = fixture();
  seed(f, { n: 2 });
  noRecords(f);
  const first = fakeDeps(f.main);
  assert.equal(run(argvOf(f), first.deps), 0);
  const created = JSON.parse(first.out.join('')).file;
  fs.writeFileSync(f.existing, JSON.stringify(created.map((x, i) => ({ number: 200 + i, body: fs.readFileSync(x.proposal, 'utf8') }))));

  const later = fixture();
  seed(later, { n: 2, lineShift: 37 });
  fs.copyFileSync(f.existing, later.existing);
  const second = fakeDeps(later.main);
  assert.equal(run(argvOf(later), second.deps), 0);
  const result = JSON.parse(second.out.join(''));
  assert.deepEqual(result.file, []);
  assert.equal(result.deduped.length, 2);
});

test('AC5: a closed record still deduplicates', () => {
  const f = fixture();
  seed(f, { n: 1 });
  noRecords(f);
  const first = fakeDeps(f.main);
  assert.equal(run(argvOf(f), first.deps), 0);
  const [made] = JSON.parse(first.out.join('')).file;
  fs.writeFileSync(f.existing, JSON.stringify([{ number: 7, state: 'CLOSED', body: fs.readFileSync(made.proposal, 'utf8') }]));
  const second = fakeDeps(f.main);
  assert.equal(run(argvOf({ ...f, outDir: path.join(f.root, 'out2') }), second.deps), 0);
  const result = JSON.parse(second.out.join(''));
  assert.deepEqual(result.file, []);
  assert.deepEqual(result.deduped.map((d) => d.number), [7]);
});

test('a finding missing from review-findings.json is flagged claimMissing and named on stderr', () => {
  const f = fixture();
  const { findings } = seed(f, { n: 2 });
  fs.writeFileSync(path.join(f.runDir, 'review-findings.json'), JSON.stringify(findings.slice(1)));
  noRecords(f);
  const { deps, out, err } = fakeDeps(f.main);
  assert.equal(run(argvOf(f), deps), 0);
  const result = JSON.parse(out.join(''));
  const lost = result.file.find((x) => x.item === `tiebreak:${findings[0].id}`);
  assert.equal(lost.claimMissing, true);
  assert.equal(result.file.find((x) => x.item === `tiebreak:${findings[1].id}`).claimMissing, undefined);
  assert.match(err.join(''), new RegExp(`tiebreak:${findings[0].id}: the finding's claim text is unavailable`));
});

test('records without a fingerprint, or with an unrelated one, dedup nothing', () => {
  const f = fixture();
  seed(f, { n: 2 });
  fs.writeFileSync(f.existing, JSON.stringify([{ number: 1, body: 'no marker here' }, { number: 2, body: 'work-fingerprint: consolefinding-deadbeef' }, { number: 3, body: null }]));
  const { deps, out } = fakeDeps(f.main);
  assert.equal(run(argvOf(f), deps), 0);
  assert.equal(JSON.parse(out.join('')).file.length, 2);
});

test('--only narrows the selection to the named items', () => {
  const f = fixture();
  const { ids } = seed(f, { n: 3 });
  noRecords(f);
  const { deps, out } = fakeDeps(f.main);
  assert.equal(run(argvOf(f, ['--only', `tiebreak:${ids[2]},tiebreak:${ids[0]}`]), deps), 0);
  const result = JSON.parse(out.join(''));
  assert.deepEqual(result.file.map((x) => x.item).sort(), [`tiebreak:${ids[0]}`, `tiebreak:${ids[2]}`].sort());
  assert.equal(fs.readdirSync(f.outDir).length, 2);
});

test('--only naming an item that is not a can\'t-tell finding is exit 2, nothing written', () => {
  const f = fixture();
  const { ids } = seed(f, { n: 1 });
  noRecords(f);
  const { deps, err } = fakeDeps(f.main);
  assert.equal(run(argvOf(f, ['--only', 'tiebreak:ffffffffffff']), deps), 2);
  assert.match(err.join(''), /tiebreak:ffffffffffff/);
  assert.ok(err.join('').includes(`valid ids: tiebreak:${ids[0]}`), 'the refusal lists the ids --only accepts');
  assert.equal(fs.existsSync(f.outDir), false);
});

test('--list prints every Low-confidence/Contested row as JSON and writes nothing (#3949 I3)', () => {
  const f = fixture();
  const { ids, findings } = seed(f, { n: 2 });
  const legacy = '- STAGED 10:00:01 — Single-read (low tier): lens "3b" finding src/legacy.js:4 not directly verified. Staged to Review Console as low-confidence. Reversibility: high.';
  fs.appendFileSync(path.join(f.runDir, 'decisions.md'), `${legacy}\n`);
  const writes = [];
  const { deps, out } = fakeDeps(f.main, { writeFile: (p) => writes.push(p), mkdir: (p) => writes.push(p) });
  assert.equal(run(['--run', f.runDir, '--list'], deps), 0);
  const rows = JSON.parse(out.join(''));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.filter((r) => r.cantTell), ids.map((id, i) => ({
    id: `tiebreak:${id}`, section: 'Low-confidence findings', recommendation: i === 1 ? 'drop' : 'file', severity: 'medium',
    lens: '3a', path: findings[i].path, line: findings[i].line, resolution: i === 1 ? 'dropped' : 'filed', cantTell: true,
  })));
  const [legacyRow] = rows.filter((r) => !r.cantTell);
  assert.match(legacyRow.id, /^decision:STAGED 10:00:01/);
  assert.deepEqual({ ...legacyRow, id: undefined }, {
    id: undefined, section: 'Low-confidence findings', recommendation: null, severity: null, lens: null, path: null, line: null, resolution: 'keep-staged', cantTell: false,
  }, 'a legacy row lists with its keep-staged default and no verdict');
  assert.deepEqual(writes, [], 'nothing is written');
});

test('--list with --existing, --out-dir or --only is exit 2', () => {
  const f = fixture();
  seed(f, { n: 1 });
  noRecords(f);
  for (const extra of [['--existing', f.existing], ['--out-dir', f.outDir], ['--only', 'x']]) {
    const { deps } = fakeDeps(f.main);
    assert.equal(run(['--run', f.runDir, '--list', ...extra], deps), 2, extra[0]);
  }
});

test('a run with no can\'t-tell items writes nothing and prints empty lists', () => {
  const f = fixture();
  noRecords(f);
  const { deps, out } = fakeDeps(f.main);
  assert.equal(run(argvOf(f), deps), 0);
  assert.deepEqual(JSON.parse(out.join('')), { file: [], deduped: [] });
});

test('exit 2 on unparseable or non-array --existing, nothing written', () => {
  const f = fixture();
  seed(f, { n: 1 });
  for (const body of ['not json', '{"number":1}']) {
    fs.writeFileSync(f.existing, body);
    const { deps, err } = fakeDeps(f.main);
    assert.equal(run(argvOf(f), deps), 2, body);
    assert.match(err.join(''), /--existing/);
    assert.equal(fs.existsSync(f.outDir), false);
  }
  const { deps } = fakeDeps(f.main);
  assert.equal(run(['--run', f.runDir, '--existing', path.join(f.root, 'absent.json'), '--out-dir', f.outDir], deps), 2, 'an unreadable --existing is a malformed invocation too');
});

test('exit 2 for malformed invocations', () => {
  const f = fixture();
  noRecords(f);
  const good = argvOf(f);
  const cases = {
    'missing --run': good.slice(2),
    'missing --existing': ['--run', f.runDir, '--out-dir', f.outDir],
    'missing --out-dir': good.slice(0, 4),
    'unknown flag': [...good, '--bogus'],
    'flag as value': ['--run', f.runDir, '--existing', '--out-dir', f.outDir],
    'empty --only': [...good, '--only', ''],
  };
  for (const [label, argv] of Object.entries(cases)) {
    const { deps } = fakeDeps(f.main);
    assert.equal(run(argv, deps), 2, label);
  }
});

test('--help prints a USAGE that names every flag, exit 0', () => {
  const { deps, out } = fakeDeps(os.tmpdir());
  assert.equal(run(['--help'], deps), 0);
  assert.equal(out.join(''), USAGE);
  for (const flag of ['--run', '--existing', '--out-dir', '--only', '--list']) assert.ok(USAGE.includes(flag), flag);
});

test('exit 3 on a worktree-local run dir, nothing written', () => {
  const f = fixture();
  seed(f, { n: 1, dir: f.shadow });
  noRecords(f);
  const { deps } = fakeDeps(path.dirname(f.shadow));
  assert.equal(run(['--run', f.shadow, '--existing', f.existing, '--out-dir', f.outDir], deps), 3);
  assert.equal(fs.existsSync(f.outDir), false);
});

test('exit 3 for a run dir that does not exist', () => {
  const f = fixture();
  noRecords(f);
  const { deps } = fakeDeps(f.main);
  assert.equal(run(['--run', path.join(f.main, '.claude-tweaks', 'pipelines', 'gone'), '--existing', f.existing, '--out-dir', f.outDir], deps), 3);
});

test('exit 3 for an unwritable --out-dir', () => {
  const f = fixture();
  seed(f, { n: 1 });
  noRecords(f);
  const blocker = path.join(f.root, 'blocker');
  fs.writeFileSync(blocker, 'a file where a directory is needed');
  const { deps, err } = fakeDeps(f.main);
  assert.equal(run(['--run', f.runDir, '--existing', f.existing, '--out-dir', path.join(blocker, 'sub')], deps), 3);
  assert.match(err.join(''), /--out-dir/);
});

test('a multi-spec per-spec run dir names the run as {parent-run-id}/spec-{N} in the proposal', () => {
  const f = fixture();
  const specDir = path.join(f.main, '.claude-tweaks', 'pipelines', '2026-10-24T213805-spec-7-8', 'spec-7');
  fs.mkdirSync(path.join(specDir, 'staged'), { recursive: true });
  seed(f, { n: 1, dir: specDir });
  noRecords(f);
  const { deps, out } = fakeDeps(f.main);
  assert.equal(run(['--run', specDir, '--existing', f.existing, '--out-dir', f.outDir], deps), 0);
  const [made] = JSON.parse(out.join('')).file;
  assert.match(fs.readFileSync(made.proposal, 'utf8'), /run 2026-10-24T213805-spec-7-8\/spec-7:/);
});
