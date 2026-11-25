'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const { run, realDeps, USAGE } = require(path.join(ROOT, 'plugin', 'bin', 'recheck-followups'));
const { RECHECK_CAP, parseProposal } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'recheck'));
const { initRepo, fixtureGit, cleanGitEnv } = require(path.join(ROOT, 'tests', 'helpers', 'git-fixtures'));

const fixtureRoots = [];
after(() => { for (const r of fixtureRoots) fs.rmSync(r, { recursive: true, force: true }); });

// An anchored run dir: <main>/.git is a directory, the run sits under <main>/.claude-tweaks/pipelines/.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-'));
  fixtureRoots.push(root);
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-11-25T090000-spec-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  return {
    root, main, runDir, records: path.join(root, 'records.json'),
    read: (p) => fs.readFileSync(p, 'utf8'),
    decisions: () => { try { return fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'); } catch { return ''; } },
    cands: () => JSON.parse(fs.readFileSync(path.join(runDir, 'recheck', 'candidates.json'), 'utf8')),
  };
}

function rec(number, files, { labels = [], items = ['Do the thing'], title = `Record ${number}` } = {}) {
  const body = [
    '### Current State', 'Something.', '',
    '## Deliverables', ...items.map((i) => `- [ ] ${i}`), '',
    '### Key Files', ...files.map((f) => `- \`${f}\``), '',
  ].join('\n');
  return {
    number, title, labels, body, state: 'OPEN', updatedAt: '2026-11-25T00:00:00Z',
  };
}

const NAME_STATUS = 'M\0src/a.js\0';
const DIFF = [
  'diff --git a/src/a.js b/src/a.js',
  'index 1..2 100644',
  '--- a/src/a.js',
  '+++ b/src/a.js',
  '@@ -1,2 +1,3 @@',
  ' keep',
  '+const widget = makeWidget();',
  ' tail',
  '',
].join('\n');

function fakeGit(calls = [], { nameStatus = NAME_STATUS, diff = DIFF } = {}) {
  return (args) => {
    calls.push(args);
    return args.includes('--name-status') ? nameStatus : diff;
  };
}

function go(f, argv, overrides = {}) {
  const out = []; const err = [];
  const deps = {
    ...realDeps, cwd: () => f.main, stdout: (s) => out.push(s), stderr: (s) => err.push(s), now: () => 0, git: fakeGit(), ...overrides,
  };
  const code = run(argv, deps);
  let json = null;
  try { json = JSON.parse(out.join('').trim()); } catch { json = null; }
  return { code, out: out.join(''), err: err.join(''), json };
}

const candidatesArgv = (f, extra = []) => ['candidates', '--run', f.runDir, '--records-json', f.records, '--base', 'main', ...extra];
const seed = (f, records) => fs.writeFileSync(f.records, JSON.stringify(records));

test('candidates: a Key File in the diff makes the record a candidate; candidates.json carries items and hunks', () => {
  const f = fixture();
  seed(f, [rec(10, ['src/a.js']), rec(11, ['src/other.js'])]);
  const calls = [];
  const r = go(f, candidatesArgv(f), { git: fakeGit(calls) });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json, { candidates: [10], overCap: [], excluded: [] });
  const c = f.cands();
  assert.equal(c.base, 'main');
  assert.equal(c.candidates.length, 1);
  assert.equal(c.candidates[0].number, 10);
  assert.deepEqual(c.candidates[0].items, ['Do the thing']);
  assert.deepEqual(c.candidates[0].intersecting, ['src/a.js']);
  assert.equal(c.candidates[0].hunksOverCap, false);
  assert.equal(c.candidates[0].hunks.length, 1);
  assert.match(c.candidates[0].hunks[0], /makeWidget/);
  assert.match(f.decisions(), /- SCANNED \d\d:\d\d:\d\d — Follow-up re-check: .*#10/);
  assert.match(f.decisions(), /^## \/wrap-up$/m);
});

test('candidates: a rename in -z name-status output makes the record a candidate through its old path', () => {
  const f = fixture();
  seed(f, [rec(10, ['src/old name.js'])]);
  const r = go(f, candidatesArgv(f), { git: fakeGit([], { nameStatus: 'R100\0src/old name.js\0src/new.js\0M\0src/z.js\0' }) });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.candidates, [10]);
});

test('candidates: git is asked for both diffs with unquoted paths, no color, fixed prefixes and `--` before paths', () => {
  const f = fixture();
  seed(f, [rec(10, ['src/a.js'])]);
  const calls = [];
  go(f, candidatesArgv(f), { git: fakeGit(calls) });
  assert.equal(calls.length, 2);
  for (const args of calls) {
    assert.deepEqual(args.slice(0, 2), ['-c', 'core.quotePath=false']);
    assert.ok(args.includes('--no-color'));
    assert.equal(args[args.indexOf('main...HEAD') - 1], '--end-of-options');
    assert.equal(args[args.length - 1], '--');
  }
  assert.ok(calls[0].includes('--name-status') && calls[0].includes('-z') && calls[0].includes('-M'));
  assert.ok(calls[1].includes('--src-prefix=a/') && calls[1].includes('--dst-prefix=b/') && calls[1].includes('-M'));
});

test('AC3.2: with RECHECK_CAP qualifying + 2, the SCANNED line in decisions.md names the 2 over-cap numbers', () => {
  const f = fixture();
  const records = [];
  // Each record cites its own changed file: a path shared by every record is a hub and would be excluded.
  for (let n = 1; n <= RECHECK_CAP + 2; n++) records.push(rec(n, [`src/f${n}.js`]));
  seed(f, records);
  const nameStatus = records.map((x) => `M\0src/f${x.number}.js\0`).join('');
  const r = go(f, candidatesArgv(f), { git: fakeGit([], { nameStatus }) });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.overCap, [RECHECK_CAP + 1, RECHECK_CAP + 2]);
  assert.equal(f.cands().candidates.length, RECHECK_CAP);
  const scanned = f.decisions().split('\n').find((l) => /^- SCANNED/.test(l));
  assert.match(scanned, new RegExp(`over cap: #${RECHECK_CAP + 1}, #${RECHECK_CAP + 2}`));
});

test('AC12.2: a no-items record is named in the SCANNED line and absent from candidates.json', () => {
  const f = fixture();
  const noItems = { ...rec(12, ['src/a.js']), body: '### Key Files\n- `src/a.js`\n' };
  seed(f, [rec(10, ['src/a.js']), noItems]);
  const r = go(f, candidatesArgv(f));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.excluded, [{ number: 12, reason: 'no-items' }]);
  assert.deepEqual(f.cands().candidates.map((c) => c.number), [10]);
  assert.match(f.decisions(), /excluded: #12 \(no-items\)/);
});

test('candidates: --own coerces to numbers and excludes the run\'s own records; a non-integer exits 2', () => {
  const f = fixture();
  seed(f, [rec(10, ['src/a.js']), rec(11, ['src/a.js'])]);
  const r = go(f, candidatesArgv(f, ['--own', '10,7']));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.candidates, [11]);
  assert.deepEqual(r.json.excluded, [{ number: 10, reason: 'own' }]);
  const bad = go(fixture(), candidatesArgv(f, ['--own', '10,x']));
  assert.equal(bad.code, 2);
  assert.match(bad.err, /--own/);
});

test('candidates: an over-cap hunk set is flagged hunksOverCap with no hunks', () => {
  const f = fixture();
  seed(f, [rec(10, ['src/a.js'])]);
  const big = DIFF.replace('+const widget = makeWidget();', `+${'x'.repeat(25000)}`);
  const r = go(f, candidatesArgv(f), { git: fakeGit([], { diff: big }) });
  assert.equal(r.code, 0, r.err);
  assert.equal(f.cands().candidates[0].hunksOverCap, true);
  assert.deepEqual(f.cands().candidates[0].hunks, []);
});

test('fresh-but-empty records-json [] exits 4 and writes nothing', () => {
  const f = fixture();
  seed(f, []);
  const r = go(f, candidatesArgv(f));
  assert.equal(r.code, 4);
  assert.equal(fs.existsSync(path.join(f.runDir, 'recheck')), false);
  assert.equal(f.decisions(), '');
});

test('unreadable or non-array records-json exits 4', () => {
  const f = fixture();
  assert.equal(go(f, candidatesArgv(f)).code, 4); // file does not exist
  fs.writeFileSync(f.records, '{"not":"an array"}');
  assert.equal(go(f, candidatesArgv(f)).code, 4);
  fs.writeFileSync(f.records, 'not json');
  assert.equal(go(f, candidatesArgv(f)).code, 4);
});

test('unanchored --run exits 3', () => {
  const f = fixture();
  seed(f, [rec(10, ['src/a.js'])]);
  const stray = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-stray-'));
  fixtureRoots.push(stray);
  const r = go(f, ['candidates', '--run', stray, '--records-json', f.records, '--base', 'main']);
  assert.equal(r.code, 3);
  assert.match(r.err, /not anchored/);
});

test('usage errors exit 2: no verb, unknown verb, missing --base, base that looks like a flag, missing --run', () => {
  const f = fixture();
  seed(f, [rec(10, ['src/a.js'])]);
  assert.equal(go(f, []).code, 2);
  assert.equal(go(f, ['bogus', '--run', f.runDir]).code, 2);
  assert.equal(go(f, ['candidates', '--run', f.runDir, '--records-json', f.records]).code, 2);
  assert.equal(go(f, candidatesArgv(f).map((a) => (a === 'main' ? '-x' : a))).code, 2);
  assert.equal(go(f, ['candidates', '--records-json', f.records, '--base', 'main']).code, 2);
  assert.match(go(f, ['--help']).out, /usage: recheck-followups\.js/);
  assert.equal(go(f, ['--help']).code, 0);
  assert.ok(USAGE.includes('candidates') && USAGE.includes('stage'));
});

test('a failing git exits 3 and writes nothing', () => {
  const f = fixture();
  seed(f, [rec(10, ['src/a.js'])]);
  const r = go(f, candidatesArgv(f), { git: () => { throw new Error('bad revision'); } });
  assert.equal(r.code, 3);
  assert.match(r.err, /bad revision/);
  assert.equal(fs.existsSync(path.join(f.runDir, 'recheck')), false);
});

test('AC10.3: real git fixture — git mv of a Key File makes the record a candidate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-git-'));
  fixtureRoots.push(root);
  const main = path.join(root, 'main');
  const env = { ...cleanGitEnv(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  delete env.GIT_TEMPLATE_DIR;
  const g = (...args) => fixtureGit(['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: main, env, encoding: 'utf8' }).trim();
  fs.mkdirSync(main);
  initRepo(main, { branch: 'trunk', env });
  fs.mkdirSync(path.join(main, 'src'));
  fs.writeFileSync(path.join(main, 'src', 'old name.js'), `${'line of code\n'.repeat(20)}`);
  g('add', '.');
  g('commit', '-q', '-m', 'base');
  const base = g('rev-parse', 'HEAD');
  g('mv', 'src/old name.js', 'src/new.js');
  g('commit', '-q', '-m', 'rename');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-11-25T090000-spec-1');
  fs.mkdirSync(runDir, { recursive: true });
  const records = path.join(root, 'records.json');
  fs.writeFileSync(records, JSON.stringify([rec(10, ['src/old name.js'])]));
  const out = []; const err = [];
  const code = run(['candidates', '--run', runDir, '--records-json', records, '--base', base], {
    ...realDeps, cwd: () => main, env, stdout: (s) => out.push(s), stderr: (s) => err.push(s), now: () => 0,
  });
  assert.equal(code, 0, err.join(''));
  assert.deepEqual(JSON.parse(out.join('').trim()).candidates, [10]);
});

// ---- stage ----

function stageFixture(items = ['First thing', 'Second thing']) {
  const f = fixture();
  seed(f, [rec(10, ['src/a.js'], { items })]);
  assert.equal(go(f, candidatesArgv(f)).code, 0);
  return f;
}
const writeVerdicts = (f, obj) => {
  const p = path.join(f.root, 'verdicts.json');
  fs.writeFileSync(p, JSON.stringify(obj));
  return ['stage', '--run', f.runDir, '--verdicts', p];
};
const staged = (f) => { try { return fs.readdirSync(path.join(f.runDir, 'staged')).sort(); } catch { return []; } };

test('stage: judge status BLOCKED stages nothing and is logged judge-failed', () => {
  const f = stageFixture();
  const r = go(f, writeVerdicts(f, { 10: { status: 'BLOCKED', verdicts: [] } }));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json, { staged: [], nothing: [], judgeFailed: [10] });
  assert.deepEqual(staged(f), []);
  assert.match(f.decisions(), /judge-failed #10/);
});

test('stage: missing or unparseable verdicts for a candidate is judge-failed too', () => {
  const f = stageFixture();
  assert.deepEqual(go(f, writeVerdicts(f, {})).json.judgeFailed, [10]);
  assert.deepEqual(go(f, writeVerdicts(f, { 10: { status: 'DONE', verdicts: 'nope' } })).json.judgeFailed, [10]);
  assert.deepEqual(staged(f), []);
});

test('stage: all-satisfied verdict writes staged/followup-recheck-{n}.md whose parseProposal action is close', () => {
  const f = stageFixture();
  const r = go(f, writeVerdicts(f, {
    10: {
      status: 'DONE',
      verdicts: [
        { deliverable: 'First thing', verdict: 'satisfied', quote: '+const widget = makeWidget();' },
        { deliverable: '2', verdict: 'satisfied', quote: 'const widget = makeWidget();' },
      ],
    },
  }));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json, { staged: ['followup-recheck-10'], nothing: [], judgeFailed: [] });
  assert.deepEqual(staged(f), ['followup-recheck-10.md']);
  const text = f.read(path.join(f.runDir, 'staged', 'followup-recheck-10.md'));
  const p = parseProposal(text);
  assert.equal(p.action, 'close');
  assert.equal(p.number, 10);
  assert.match(text, /^Run: 2026-11-25T090000-spec-1$/m);
  const log = f.decisions();
  assert.match(log, /- STAGED \d\d:\d\d:\d\d — Follow-up re-check: .*staged\/followup-recheck-10\.md/);
  assert.match(log, /SCANNED .*staged close #10/);
});

test('stage: a partly satisfied record narrows; a fabricated quote counts as cant-tell and stages nothing', () => {
  const f = stageFixture();
  const narrow = go(f, writeVerdicts(f, {
    10: {
      status: 'DONE_WITH_CONCERNS',
      verdicts: [
        { deliverable: 'First thing', verdict: 'satisfied', quote: 'makeWidget()' },
        { deliverable: 'Second thing', verdict: 'not-satisfied' },
      ],
    },
  }));
  assert.equal(parseProposal(f.read(path.join(f.runDir, 'staged', 'followup-recheck-10.md'))).action, 'narrow');
  assert.match(f.decisions(), /staged narrow #10/);
  assert.deepEqual(narrow.json.staged, ['followup-recheck-10']);

  const g = stageFixture();
  const fake = go(g, writeVerdicts(g, {
    10: { status: 'DONE', verdicts: [{ deliverable: 'First thing', verdict: 'satisfied', quote: 'never in the diff' }] },
  }));
  assert.deepEqual(fake.json, { staged: [], nothing: [10], judgeFailed: [] });
  assert.deepEqual(staged(g), []);
  assert.match(g.decisions(), /nothing for #10 \(no satisfied\)/);
});

test('stage: a hunksOverCap candidate is judged against no hunks, so a satisfied verdict stages nothing', () => {
  const f = fixture();
  seed(f, [rec(10, ['src/a.js'])]);
  const big = DIFF.replace('+const widget = makeWidget();', `+${'x'.repeat(25000)}`);
  go(f, candidatesArgv(f), { git: fakeGit([], { diff: big }) });
  const r = go(f, writeVerdicts(f, {
    10: { status: 'DONE', verdicts: [{ deliverable: 'Do the thing', verdict: 'satisfied', quote: 'xxxx' }] },
  }));
  assert.deepEqual(r.json.nothing, [10]);
  assert.deepEqual(staged(f), []);
});

test('stage: exit codes — no candidates.json 3, unreadable verdicts 2-or-3 per contract, unanchored 3', () => {
  const f = fixture();
  assert.equal(go(f, writeVerdicts(f, {})).code, 3); // candidates never ran
  const g = stageFixture();
  assert.equal(go(g, ['stage', '--run', g.runDir]).code, 2); // --verdicts missing
  assert.equal(go(g, ['stage', '--run', g.runDir, '--verdicts', path.join(g.root, 'absent.json')]).code, 3);
});
