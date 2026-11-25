'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const { run, realDeps, USAGE } = require(path.join(ROOT, 'plugin', 'bin', 'recheck-followups'));
const { RECHECK_CAP, parseProposal } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'recheck'));
const { createRecord, defaultFacets } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'issues', 'local-store'));
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
    // `merge-base --is-ancestor` exits 0 (an ancestor) unless a test injects otherwise.
    if (args[0] === 'merge-base') return '';
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
  // Two diffs, then one read of the head commit for the proposals' Run-head header.
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2], ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  calls.pop();
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

test('stage: DONE with an empty verdicts array for a candidate with items is judge-failed, not nothing', () => {
  const f = stageFixture();
  const r = go(f, writeVerdicts(f, { 10: { status: 'DONE', verdicts: [] } }));
  assert.deepEqual(r.json, { staged: [], nothing: [], judgeFailed: [10] });
  assert.match(f.decisions(), /judge-failed #10/);
  assert.doesNotMatch(f.decisions(), /nothing for #10/);
});

test('--local: Updated-at comes from the record file mtime and a parent-issue facet excludes the record', () => {
  const f = fixture();
  const specs = path.join(f.main, 'specs');
  const body = '## Deliverables\n- [ ] Do the thing\n\n### Key Files\n- `src/a.js`\n';
  createRecord(specs, { slug: 'plain', title: 'Plain', body, facets: defaultFacets() });
  createRecord(specs, { slug: 'parent', title: 'Parent', body, facets: { ...defaultFacets(), isParentIssue: true } });
  for (const name of fs.readdirSync(specs)) fs.utimesSync(path.join(specs, name), new Date('2026-01-02T03:04:05Z'), new Date('2026-01-02T03:04:05Z'));
  const r = go(f, ['candidates', '--run', f.runDir, '--local', '--base', 'main']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.candidates.length, 1);
  assert.deepEqual(r.json.excluded.map((e) => e.reason), ['label:parent-issue']);
  const [c] = f.cands().candidates;
  assert.equal(c.updatedAt, '2026-01-02T03:04:05.000Z');
  const verdicts = writeVerdicts(f, {
    [c.number]: { status: 'DONE', verdicts: [{ deliverable: 'Do the thing', verdict: 'satisfied', quote: 'makeWidget()' }] },
  });
  assert.equal(go(f, verdicts).code, 0);
  const text = f.read(path.join(f.runDir, 'staged', `followup-recheck-${c.number}.md`));
  assert.match(text, /^Updated-at: 2026-01-02T03:04:05\.000Z$/m);
  assert.equal(parseProposal(text).action, 'close');
});

// ---- approve / execute (Task 5) -------------------------------------------------------------------------------

const { composeProposal } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'recheck'));
const sha = (t) => require('crypto').createHash('sha256').update(t).digest('hex');
const RECORD_BODY = '## Deliverables\n- [ ] Do the thing\n\n### Key Files\n- `src/a.js`\n';
const ID = 'followup-recheck-7.md';

function proposal(outcome = 'close', body = RECORD_BODY) {
  return composeProposal({
    number: 7, title: 'Record 7', outcome, checked: [{ item: 'Do the thing', verdict: 'satisfied', quote: 'makeWidget()' }],
    bodyHash: sha(body), updatedAt: '2026-11-25T00:00:00Z', runId: 'run-1',
  });
}

function stageProposal(f, text = proposal()) {
  fs.mkdirSync(path.join(f.runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(f.runDir, 'staged', ID), text);
}
const consolePath = (f) => path.join(f.runDir, 'console.json');
const readConsole = (f) => JSON.parse(fs.readFileSync(consolePath(f), 'utf8'));
const HEAD = 'a'.repeat(40);
// The hash approve would record for the staged file as it reads now ('' when there is none).
const stagedHashOf = (f, id = ID) => { try { return sha(fs.readFileSync(path.join(f.runDir, 'staged', id), 'utf8')); } catch { return sha(''); } };
function seedApproved(f, pr = '12', extra = {}) {
  fs.writeFileSync(consolePath(f), JSON.stringify({
    resolved: true, mode: 'recheck-approval', at: 'then',
    items: [{
      id: ID, section: 'Queue writes', resolution: 'pending', reason: 'followup-recheck-approved', approval: { at: 'then', pr, headSha: HEAD, stagedHash: stagedHashOf(f) }, ...extra,
    }],
  }));
}
// run-state.json (and optionally config.yml's integration-model pin) for approve's derivation.
function seedRunState(f, { pr = 12, model = null, dir = f.runDir, worktree, branch } = {}) {
  const state = { status: 'active' };
  if (pr !== null) state.pr = { number: pr, branch: branch || 'feature' };
  if (worktree) state.worktree = worktree;
  if (branch && pr === null) state.branch = branch;
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify(state));
  if (model) fs.writeFileSync(path.join(dir, 'config.yml'), `mode: auto\nintegration-model: ${model}\n`);
}

// A fake gh: records every argv (and stdin) and answers from a per-test table.
function fakeGh({
  pr = { state: 'MERGED' }, issue = { state: 'OPEN', labels: [], body: RECORD_BODY }, failPr = false, failIssue = false, failComment = false, failClose = false,
} = {}) {
  const calls = []; const inputs = [];
  const fn = (args, input) => {
    calls.push(args); inputs.push(input);
    const j = args.join(' ');
    if (/^pr view/.test(j)) { if (failPr) throw new Error('gh pr view failed'); return JSON.stringify(pr); }
    if (/^issue view/.test(j)) { if (failIssue) throw new Error('gh issue view failed'); return JSON.stringify(issue); }
    if (/^issue comment/.test(j)) { if (failComment) throw new Error('comment failed'); return ''; }
    if (/^issue close/.test(j)) { if (failClose) throw new Error('close failed'); return ''; }
    throw new Error(`unexpected gh call: ${j}`);
  };
  fn.calls = calls; fn.inputs = inputs;
  fn.writes = () => calls.filter((a) => /^issue (close|comment)/.test(a.join(' ')));
  return fn;
}
const writesOf = (gh, what) => gh.calls.filter((a) => a.slice(0, 2).join(' ') === `issue ${what}`);

const task5 = (f, argv, over = {}) => go(f, argv, {
  controlMode: () => false, workBackend: () => 'github-issues', integrationBranch: () => 'main', ...over,
});
const exec = (f, gh, extra = [], over = {}) => task5(f, ['execute', '--run', f.runDir, ...extra], { gh, ...over });
const skipLines = (f) => f.decisions().split('\n').filter((l) => /^- SKIP/.test(l));
const autoLines = (f) => f.decisions().split('\n').filter((l) => /^- AUTO/.test(l));

test('approve: creates console.json with resolved:false and one pending item carrying approval; logs one AUTO line', () => {
  const f = fixture(); stageProposal(f); seedRunState(f);
  const r = task5(f, ['approve', '--run', f.runDir, '--id', ID]);
  assert.equal(r.code, 0, r.err);
  const c = readConsole(f);
  assert.equal(c.resolved, false);
  assert.equal(c.mode, 'recheck-approval');
  assert.equal(c.items.length, 1);
  const { approval, ...rest } = c.items[0];
  assert.deepEqual(rest, {
    id: ID, section: 'Queue writes', resolution: 'pending', reason: 'followup-recheck-approved',
  });
  assert.equal(approval.pr, '12');
  assert.equal(approval.stagedHash, stagedHashOf(f));
  assert.ok(approval.at);
  assert.equal(autoLines(f).length, 1);
});

test('approve: on a PR-rendered console.json the approval lands on the existing --item q-N row, never an appended item', () => {
  const f = fixture(); stageProposal(f); seedRunState(f, { pr: 99 });
  fs.writeFileSync(consolePath(f), JSON.stringify({ commentIds: [5], prNumber: 99, items: [{ id: 'q-1', kind: 'x', summary: 's', stagedHash: 'h' }, { id: 'q-2', kind: 'x' }] }));
  const before = fs.readFileSync(consolePath(f), 'utf8');
  assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', ID]).code, 2, 'a PR console needs --item');
  assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', ID, '--item', 'q-9']).code, 2, 'an unknown row');
  assert.equal(fs.readFileSync(consolePath(f), 'utf8'), before);
  const r = task5(f, ['approve', '--run', f.runDir, '--id', ID, '--item', 'q-1']);
  assert.equal(r.code, 0, r.err);
  assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', ID, '--item', 'q-1']).code, 0, 're-approving the same row');
  const c = readConsole(f);
  assert.equal(c.prNumber, 99);
  assert.deepEqual(c.commentIds, [5]);
  assert.deepEqual(c.items.map((i) => i.id), ['q-1', 'q-2']);
  assert.equal(c.items[0].stagedFile, ID);
  assert.equal(c.items[0].resolution, 'pending');
  assert.equal(c.items[0].kind, 'x');
  assert.equal(c.items[0].approval.pr, '99');
  assert.equal(c.items[0].approval.stagedHash, stagedHashOf(f));
  fs.writeFileSync(path.join(f.runDir, 'staged', 'followup-recheck-8.md'), proposal());
  assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', 'followup-recheck-8.md', '--item', 'q-1']).code, 2, 'a row already approved for another file');
  const g = fixture(); stageProposal(g); seedRunState(g);
  assert.equal(task5(g, ['approve', '--run', g.runDir, '--id', ID, '--item', 'q-1']).code, 2, '--item on a non-PR console');
});

test('approve: refuses (exit 5, nothing written) under control mode and when the item is carried', () => {
  const f = fixture(); stageProposal(f);
  const r = task5(f, ['approve', '--run', f.runDir, '--id', ID, '--pr', '12'], { controlMode: () => true });
  assert.equal(r.code, 5);
  assert.equal(fs.existsSync(consolePath(f)), false);
  const g = fixture(); stageProposal(g);
  fs.writeFileSync(consolePath(g), JSON.stringify({ items: [{ id: ID, section: 'Queue writes', resolution: 'carried' }] }));
  const before = fs.readFileSync(consolePath(g), 'utf8');
  assert.equal(task5(g, ['approve', '--run', g.runDir, '--id', ID, '--pr', '12']).code, 5);
  assert.equal(fs.readFileSync(consolePath(g), 'utf8'), before);
});

test('approve: malformed --id / --pr exit 2; a missing staged file exits 3', () => {
  const f = fixture();
  assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', '../x.md', '--pr', '12']).code, 2);
  assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', ID, '--pr', 'abc']).code, 2);
  assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', ID, '--item', 'nope']).code, 2);
  assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', ID]).code, 3);
});

test('AC7.1: an approved close with the PR OPEN is not executed and stays pending with approval', () => {
  const f = fixture(); stageProposal(f); seedApproved(f);
  const gh = fakeGh({ pr: { state: 'OPEN' } });
  const r = exec(f, gh);
  assert.equal(r.code, 0, r.err);
  assert.equal(gh.writes().length, 0);
  const item = readConsole(f).items[0];
  assert.equal(item.resolution, 'pending');
  assert.equal(item.approval.pr, '12');
  assert.equal(skipLines(f).length, 1);
  assert.match(skipLines(f)[0], /not-merged/);
});

test('AC8.1: an approved close after MERGED comments then closes, once each, and logs one AUTO line naming #7', () => {
  const f = fixture(); stageProposal(f); seedApproved(f);
  const gh = fakeGh();
  const r = exec(f, gh);
  assert.equal(r.code, 0, r.err);
  assert.equal(writesOf(gh, 'comment').length, 1);
  assert.equal(writesOf(gh, 'close').length, 1);
  const order = gh.calls.map((a) => a.slice(0, 2).join(' '));
  assert.ok(order.indexOf('issue comment') < order.indexOf('issue close'));
  assert.ok(gh.calls.every((a) => a.includes('--')), 'every gh call separates values with --');
  assert.match(gh.inputs[order.indexOf('issue comment')], /satisfy every deliverable/);
  assert.ok(writesOf(gh, 'close')[0].includes('completed'));
  assert.equal(readConsole(f).items[0].resolution, 'applied');
  assert.equal(autoLines(f).length, 1);
  assert.match(autoLines(f)[0], /#7/);
  assert.match(autoLines(f)[0], /Reversibility: high \(gh issue reopen\)/);
  assert.equal(skipLines(f).length, 0);
});

test('a narrow proposal posts the comment only, no close', () => {
  const f = fixture(); stageProposal(f, proposal('narrow')); seedApproved(f);
  const gh = fakeGh();
  assert.equal(exec(f, gh).code, 0);
  assert.equal(writesOf(gh, 'comment').length, 1);
  assert.equal(writesOf(gh, 'close').length, 0);
  assert.equal(readConsole(f).items[0].resolution, 'applied');
});

test('AC11.1: a proposal approved at a multi-spec parent run dir executes from that dir only after merge', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.runDir, 'manifest.yml'), 'specs: [1]\n');
  fs.mkdirSync(path.join(f.runDir, 'spec-1'));
  stageProposal(f); seedRunState(f);
  assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', ID]).code, 0);
  const open = fakeGh({ pr: { state: 'OPEN' } });
  assert.equal(exec(f, open).code, 0);
  assert.equal(open.writes().length, 0);
  const merged = fakeGh();
  assert.equal(exec(f, merged).code, 0);
  assert.equal(writesOf(merged, 'comment').length, 1);
  assert.equal(writesOf(merged, 'close').length, 1);
});

test('AC13.1: merge read failing holds with one SKIP line and no writes', () => {
  const f = fixture(); stageProposal(f); seedApproved(f);
  const gh = fakeGh({ failPr: true });
  assert.equal(exec(f, gh).code, 0);
  assert.equal(gh.writes().length, 0);
  assert.equal(readConsole(f).items[0].resolution, 'pending');
  assert.equal(skipLines(f).length, 1);
  assert.match(skipLines(f)[0], /merge-read-failed/);
});

test('AC13.2: record read failing holds with one SKIP line and no writes', () => {
  const f = fixture(); stageProposal(f); seedApproved(f);
  const gh = fakeGh({ failIssue: true });
  assert.equal(exec(f, gh).code, 0);
  assert.equal(gh.writes().length, 0);
  assert.equal(skipLines(f).length, 1);
  assert.match(skipLines(f)[0], /record-read-failed/);
});

test('AC14.1: approval pr "abc" holds as malformed-pr, with no gh call at all', () => {
  const f = fixture(); stageProposal(f); seedApproved(f, 'abc');
  const gh = fakeGh();
  assert.equal(exec(f, gh).code, 0);
  assert.equal(gh.calls.length, 0);
  assert.match(skipLines(f)[0], /malformed-pr/);
  assert.equal(readConsole(f).items[0].resolution, 'pending');
});

test('AC14.2: a staged file with no Target header holds as malformed-proposal', () => {
  const f = fixture(); stageProposal(f, proposal().replace(/^Target:.*\n/m, '')); seedApproved(f);
  const gh = fakeGh();
  assert.equal(exec(f, gh).code, 0);
  assert.equal(gh.calls.length, 0);
  assert.match(skipLines(f)[0], /malformed-proposal/);
});

test('a missing staged file holds as malformed-proposal', () => {
  const f = fixture(); seedApproved(f);
  const gh = fakeGh();
  assert.equal(exec(f, gh).code, 0);
  assert.equal(gh.calls.length, 0);
  assert.match(skipLines(f)[0], /malformed-proposal/);
});

test('AC15.1: a closed record holds', () => {
  const f = fixture(); stageProposal(f); seedApproved(f);
  const gh = fakeGh({ issue: { state: 'CLOSED', labels: [], body: RECORD_BODY } });
  assert.equal(exec(f, gh).code, 0);
  assert.equal(gh.writes().length, 0);
  assert.equal(skipLines(f).length, 1);
  assert.match(skipLines(f)[0], /record-closed/);
});

test('AC15.2: a record labelled bot:in-progress holds', () => {
  const f = fixture(); stageProposal(f); seedApproved(f);
  const gh = fakeGh({ issue: { state: 'OPEN', labels: [{ name: 'bot:in-progress' }], body: RECORD_BODY } });
  assert.equal(exec(f, gh).code, 0);
  assert.equal(gh.writes().length, 0);
  assert.equal(skipLines(f).length, 1);
  assert.match(skipLines(f)[0], /record-claimed/);
});

test('AC15.3: a changed body hash holds', () => {
  const f = fixture(); stageProposal(f); seedApproved(f);
  const gh = fakeGh({ issue: { state: 'OPEN', labels: [], body: `${RECORD_BODY}edited\n` } });
  assert.equal(exec(f, gh).code, 0);
  assert.equal(gh.writes().length, 0);
  assert.match(skipLines(f)[0], /body-changed/);
  assert.equal(readConsole(f).items[0].resolution, 'pending');
});

test('AC16.2: a PR CLOSED unmerged drops the approval with one logged line and no close or comment', () => {
  const f = fixture(); stageProposal(f); seedApproved(f);
  const gh = fakeGh({ pr: { state: 'CLOSED' } });
  assert.equal(exec(f, gh).code, 0);
  assert.equal(gh.writes().length, 0);
  assert.equal(readConsole(f).items[0].resolution, 'dropped');
  assert.equal(autoLines(f).length, 1);
  assert.match(autoLines(f)[0], /#7/);
});

test('a failed comment leaves the item pending with one SKIP line and never closes', () => {
  const f = fixture(); stageProposal(f); seedApproved(f);
  const gh = fakeGh({ failComment: true });
  assert.equal(exec(f, gh).code, 0);
  assert.equal(writesOf(gh, 'close').length, 0);
  assert.equal(readConsole(f).items[0].resolution, 'pending');
  assert.equal(skipLines(f).length, 1);
});

test('a comment that posted but a close that failed stays pending and the SKIP line says the comment was posted', () => {
  const f = fixture(); stageProposal(f); seedApproved(f);
  const gh = fakeGh({ failClose: true });
  assert.equal(exec(f, gh).code, 0);
  assert.equal(writesOf(gh, 'comment').length, 1);
  assert.equal(readConsole(f).items[0].resolution, 'pending');
  assert.equal(skipLines(f).length, 1);
  assert.match(skipLines(f)[0], /comment was posted/);
});

test('execute twice: the second run makes no gh calls', () => {
  const f = fixture(); stageProposal(f); seedApproved(f);
  assert.equal(exec(f, fakeGh()).code, 0);
  const again = fakeGh();
  assert.equal(exec(f, again).code, 0);
  assert.equal(again.calls.length, 0);
});

test('execute: --id restricts to one item; an unapproved or absent console.json makes no gh call', () => {
  const f = fixture(); stageProposal(f);
  const none = fakeGh();
  assert.equal(exec(f, none).code, 0);
  assert.equal(none.calls.length, 0);
  fs.writeFileSync(consolePath(f), JSON.stringify({ items: [{ id: ID, section: 'Queue writes', resolution: 'pending' }] }));
  assert.equal(exec(f, none).code, 0);
  assert.equal(none.calls.length, 0);
  seedApproved(f);
  const other = fakeGh();
  assert.equal(exec(f, other, ['--id', 'followup-recheck-9.md']).code, 0);
  assert.equal(other.calls.length, 0);
});

test('execute: a local PR is not-merged without --local-merged', () => {
  const f = fixture(); stageProposal(f); seedApproved(f, 'local');
  const gh = fakeGh();
  assert.equal(exec(f, gh).code, 0);
  assert.equal(gh.calls.length, 0);
  assert.match(skipLines(f)[0], /not-merged/);
});

test('local-files: --local --local-merged closes via local-store and appends the comment to the body', () => {
  const f = fixture();
  const specs = path.join(f.main, 'specs');
  const { id } = createRecord(specs, {
    slug: 'plain', title: 'Plain', body: RECORD_BODY, facets: defaultFacets(),
  });
  // The candidates pass hashes the body local-store hands back, which is what the guard re-reads.
  const stored = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'issues', 'local-store')).queryRecords(specs)[0].body;
  const staged = composeProposal({
    number: Number(id), title: 'Plain', outcome: 'close', checked: [{ item: 'Do the thing', verdict: 'satisfied', quote: 'makeWidget()' }],
    bodyHash: sha(stored), updatedAt: '2026-11-25T00:00:00Z', runId: 'run-1',
  });
  const sid = `followup-recheck-${id}.md`;
  fs.mkdirSync(path.join(f.runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(f.runDir, 'staged', sid), staged);
  fs.writeFileSync(consolePath(f), JSON.stringify({ items: [{ id: sid, section: 'Queue writes', resolution: 'pending', approval: { at: 'then', pr: 'local', headSha: HEAD, stagedHash: stagedHashOf(f, sid) } }] }));
  const gh = fakeGh();
  const r = exec(f, gh, ['--local', '--local-merged']);
  assert.equal(r.code, 0, r.err);
  assert.equal(gh.calls.length, 0);
  assert.equal(readConsole(f).items[0].resolution, 'applied');
  const after = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'issues', 'local-store')).readRecord(path.join(specs, fs.readdirSync(specs).find((n) => n.endsWith('.md'))));
  assert.equal(after.facets.closed, true);
  assert.match(after.body, /satisfy every deliverable/);
  assert.match(after.body, /Do the thing/);
});

test('backend resolution: a local-files backend without --local still routes through local-store, not gh', () => {
  const f = fixture(); stageProposal(f); seedApproved(f, 'local');
  const gh = fakeGh();
  assert.equal(exec(f, gh, ['--local-merged'], { workBackend: () => 'local-files' }).code, 0);
  assert.equal(gh.calls.length, 0);
  assert.match(skipLines(f)[0], /record-read-failed/);
});

// ---- Task 5 fix round 1 ---------------------------------------------------------------------------------------

test('partial failure: comment posts, close fails, re-run posts no second comment and closes exactly once', () => {
  const f = fixture(); stageProposal(f); seedApproved(f);
  const first = fakeGh({ failClose: true });
  assert.equal(exec(f, first).code, 0);
  assert.equal(writesOf(first, 'comment').length, 1);
  const item = readConsole(f).items[0];
  assert.equal(item.resolution, 'pending');
  assert.ok(item.approval.commentedAt);
  const second = fakeGh();
  assert.equal(exec(f, second).code, 0);
  assert.equal(writesOf(second, 'comment').length, 0);
  assert.equal(writesOf(second, 'close').length, 1);
  assert.equal(readConsole(f).items[0].resolution, 'applied');
});

test('partial failure on a narrow proposal: a settle write that fails after the comment does not repost it', () => {
  const f = fixture(); stageProposal(f, proposal('narrow')); seedApproved(f);
  const first = fakeGh();
  let writes = 0;
  // Let the commentedAt marker write through; fail the settle write that follows.
  const writeAtomic = (p, text) => { writes += 1; if (writes === 2) throw new Error('disk full'); fs.writeFileSync(p, text); };
  assert.equal(exec(f, first, [], { writeAtomic }).code, 3);
  assert.equal(writesOf(first, 'comment').length, 1);
  assert.equal(readConsole(f).items[0].resolution, 'pending');
  assert.ok(readConsole(f).items[0].approval.commentedAt);
  const second = fakeGh();
  assert.equal(exec(f, second).code, 0);
  assert.equal(writesOf(second, 'comment').length, 0);
  assert.equal(readConsole(f).items[0].resolution, 'applied');
});

test('local-files partial failure: a close that failed after the append re-runs without re-appending or holding as body-changed', () => {
  const f = fixture();
  const specs = path.join(f.main, 'specs');
  const ls = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'issues', 'local-store'));
  const { id } = createRecord(specs, {
    slug: 'plain', title: 'Plain', body: RECORD_BODY, facets: defaultFacets(),
  });
  const stored = ls.queryRecords(specs)[0].body;
  const sid = `followup-recheck-${id}.md`;
  fs.mkdirSync(path.join(f.runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(f.runDir, 'staged', sid), composeProposal({
    number: Number(id), title: 'Plain', outcome: 'close', checked: [{ item: 'Do the thing', verdict: 'satisfied', quote: 'makeWidget()' }],
    bodyHash: sha(stored), updatedAt: '2026-11-25T00:00:00Z', runId: 'run-1',
  }));
  fs.writeFileSync(consolePath(f), JSON.stringify({ items: [{ id: sid, section: 'Queue writes', resolution: 'pending', approval: { at: 'then', pr: 'local', headSha: HEAD, stagedHash: stagedHashOf(f, sid), commentedAt: 'then' } }] }));
  // State left by a first run: the comment is already appended, the close never happened.
  const file = path.join(specs, fs.readdirSync(specs).find((n) => n.endsWith('.md')));
  const rec = ls.readRecord(file);
  const comment = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'recheck')).parseProposal(fs.readFileSync(path.join(f.runDir, 'staged', sid), 'utf8')).comment;
  ls.writeRecord(file, { title: rec.title, body: `${rec.body}\n\n${comment}\n`, facets: rec.facets });
  const r = exec(f, fakeGh(), ['--local', '--local-merged']);
  assert.equal(r.code, 0, r.err);
  assert.equal(readConsole(f).items[0].resolution, 'applied', f.decisions());
  const after = ls.readRecord(file);
  assert.equal(after.facets.closed, true);
  assert.equal(after.body.split('satisfy every deliverable').length - 1, 1);
});

test('approve refuses (exit 5, nothing written) an item already applied or dropped', () => {
  for (const resolution of ['applied', 'dropped']) {
    const f = fixture(); stageProposal(f);
    fs.writeFileSync(consolePath(f), JSON.stringify({ items: [{ id: ID, section: 'Queue writes', resolution, approval: { at: 'then', pr: '12' } }] }));
    const before = fs.readFileSync(consolePath(f), 'utf8');
    assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', ID, '--pr', '12']).code, 5);
    assert.equal(fs.readFileSync(consolePath(f), 'utf8'), before);
    assert.equal(autoLines(f).length, 0);
  }
});

test('execute: an item id that is not followup-recheck-<n>.md holds as malformed-proposal with no gh call', () => {
  const f = fixture(); stageProposal(f);
  fs.writeFileSync(path.join(f.runDir, 'staged', 'other.md'), proposal());
  fs.writeFileSync(consolePath(f), JSON.stringify({ items: [{ id: 'other.md', section: 'Queue writes', resolution: 'pending', approval: { at: 'then', pr: '12' } }] }));
  const gh = fakeGh();
  assert.equal(exec(f, gh).code, 0);
  assert.equal(gh.calls.length, 0);
  assert.equal(skipLines(f).length, 1);
  assert.match(skipLines(f)[0], /malformed-proposal/);
});

test('execute: a proposal whose Target number differs from the id number holds as malformed-proposal with no gh call', () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(f.runDir, 'staged', 'followup-recheck-9.md'), proposal());
  fs.writeFileSync(consolePath(f), JSON.stringify({ items: [{ id: 'followup-recheck-9.md', section: 'Queue writes', resolution: 'pending', approval: { at: 'then', pr: '12' } }] }));
  const gh = fakeGh();
  assert.equal(exec(f, gh).code, 0);
  assert.equal(gh.calls.length, 0);
  assert.equal(skipLines(f).length, 1);
  assert.match(skipLines(f)[0], /malformed-proposal/);
});

test('local execute reads records from the run dir main-checkout root, not the cwd', () => {
  const f = fixture();
  const specs = path.join(f.main, 'specs');
  const { id } = createRecord(specs, {
    slug: 'plain', title: 'Plain', body: RECORD_BODY, facets: defaultFacets(),
  });
  const ls = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'issues', 'local-store'));
  const sid = `followup-recheck-${id}.md`;
  fs.mkdirSync(path.join(f.runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(f.runDir, 'staged', sid), composeProposal({
    number: Number(id), title: 'Plain', outcome: 'close', checked: [{ item: 'Do the thing', verdict: 'satisfied', quote: 'makeWidget()' }],
    bodyHash: sha(ls.queryRecords(specs)[0].body), updatedAt: '2026-11-25T00:00:00Z', runId: 'run-1',
  }));
  fs.writeFileSync(consolePath(f), JSON.stringify({ items: [{ id: sid, section: 'Queue writes', resolution: 'pending', approval: { at: 'then', pr: 'local', headSha: HEAD, stagedHash: stagedHashOf(f, sid) } }] }));
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-cwd-'));
  fixtureRoots.push(elsewhere);
  const r = exec(f, fakeGh(), ['--local', '--local-merged'], { cwd: () => elsewhere, mainRoot: f.main });
  assert.equal(r.code, 0, r.err);
  assert.equal(readConsole(f).items[0].resolution, 'applied');
});

// ---- final-review fix wave (#6284) -----------------------------------------------------------------------------

const realGitEnv = () => {
  const env = { ...cleanGitEnv(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  delete env.GIT_TEMPLATE_DIR;
  return env;
};

// A real repository at f.main (replacing the fixture's bare .git dir): trunk 'main' with one commit, and a
// 'feature' branch one commit ahead. Returns the feature head and a git helper.
function realRepo(f) {
  fs.rmSync(path.join(f.main, '.git'), { recursive: true, force: true });
  const env = realGitEnv();
  const g = (...args) => fixtureGit(['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: f.main, env, encoding: 'utf8' }).trim();
  initRepo(f.main, { branch: 'main', env });
  fs.writeFileSync(path.join(f.main, 'base.txt'), 'base\n');
  g('add', 'base.txt');
  g('commit', '-q', '-m', 'base');
  g('checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(f.main, 'feature.txt'), 'feature\n');
  g('add', 'feature.txt');
  g('commit', '-q', '-m', 'feature');
  const head = g('rev-parse', 'HEAD');
  g('checkout', '-q', 'main');
  return { env, g, head };
}

test('C2: a local approval whose recorded head is not on the integration branch holds not-merged even with --local-merged; once merged it executes', () => {
  const f = fixture(); stageProposal(f);
  const { env, g, head } = realRepo(f);
  seedApproved(f, 'local', { approval: { at: 'then', pr: 'local', headSha: head, stagedHash: stagedHashOf(f) } });
  const over = { git: realDeps.git, env };
  const gh = fakeGh();
  assert.equal(exec(f, gh, ['--local-merged'], over).code, 0);
  assert.equal(gh.writes().length, 0);
  assert.equal(readConsole(f).items[0].resolution, 'pending');
  assert.match(skipLines(f)[0], /not-merged/);
  g('merge', '-q', '--no-ff', '-m', 'merge feature', 'feature');
  const merged = fakeGh();
  assert.equal(exec(f, merged, ['--local-merged'], over).code, 0);
  assert.equal(writesOf(merged, 'comment').length, 1);
  assert.equal(writesOf(merged, 'close').length, 1);
  assert.equal(readConsole(f).items[0].resolution, 'applied');
});

test('C2: a local approval with no recorded head, or an unresolvable integration branch, holds not-merged', () => {
  const f = fixture(); stageProposal(f);
  seedApproved(f, 'local', { approval: { at: 'then', pr: 'local', stagedHash: stagedHashOf(f) } });
  const gh = fakeGh();
  assert.equal(exec(f, gh, ['--local-merged']).code, 0);
  assert.equal(gh.calls.length, 0);
  seedApproved(f, 'local');
  assert.equal(exec(f, gh, ['--local-merged'], { integrationBranch: () => null }).code, 0);
  assert.equal(gh.calls.length, 0);
  assert.equal(exec(f, gh, ['--local-merged'], { integrationBranch: () => { throw new Error('no origin/HEAD'); } }).code, 0);
  const failing = (args) => { if (args[0] === 'merge-base') throw new Error('exit 128'); return ''; };
  assert.equal(exec(f, gh, ['--local-merged'], { git: failing }).code, 0);
  assert.equal(gh.calls.length, 0);
  assert.equal(skipLines(f).filter((l) => /not-merged/.test(l)).length, 4);
});

test('C2: approve records the run worktree head as approval.headSha, and a local approval without one exits 3', () => {
  const f = fixture(); stageProposal(f);
  const { env, head, g } = realRepo(f);
  g('checkout', '-q', 'feature');
  seedRunState(f, { pr: null, model: 'local-merge', worktree: f.main });
  const r = task5(f, ['approve', '--run', f.runDir, '--id', ID], { git: realDeps.git, env });
  assert.equal(r.code, 0, r.err);
  assert.equal(readConsole(f).items[0].approval.headSha, head);
  assert.equal(readConsole(f).items[0].approval.pr, 'local');
  const h = fixture(); stageProposal(h); seedRunState(h, { pr: null, model: 'local-merge' });
  assert.equal(task5(h, ['approve', '--run', h.runDir, '--id', ID]).code, 3);
  assert.equal(fs.existsSync(consolePath(h)), false);
});

test('I3: an approved PR-console q-N row executes through its stagedFile; --id names it by either id', () => {
  const f = fixture(); stageProposal(f);
  fs.writeFileSync(consolePath(f), JSON.stringify({
    commentIds: [5], prNumber: 12, items: [{ id: 'q-1', kind: 'x', resolution: 'pending', stagedFile: ID, approval: { at: 'then', pr: '12', stagedHash: stagedHashOf(f) } }],
  }));
  const other = fakeGh();
  assert.equal(exec(f, other, ['--id', 'q-2']).code, 0);
  assert.equal(other.calls.length, 0);
  const gh = fakeGh();
  const r = exec(f, gh, ['--id', ID]);
  assert.equal(r.code, 0, r.err);
  assert.equal(writesOf(gh, 'close').length, 1);
  assert.equal(readConsole(f).items[0].resolution, 'applied');
  assert.match(autoLines(f)[0], /q-1 \(followup-recheck-7\.md\)/);
});

test('I3: a q-N row whose stagedFile is not a followup-recheck name holds as malformed-proposal with no gh call', () => {
  const f = fixture(); stageProposal(f);
  fs.writeFileSync(path.join(f.runDir, 'staged', 'other.md'), proposal());
  fs.writeFileSync(consolePath(f), JSON.stringify({
    commentIds: [5], prNumber: 12, items: [{ id: 'q-1', resolution: 'pending', stagedFile: 'other.md', approval: { at: 'then', pr: '12', stagedHash: stagedHashOf(f, 'other.md') } }],
  }));
  const gh = fakeGh();
  assert.equal(exec(f, gh).code, 0);
  assert.equal(gh.calls.length, 0);
  assert.match(skipLines(f)[0], /malformed-proposal/);
});

test('I4: a staged file re-staged or edited after approval holds as proposal-changed with one SKIP line and no gh call', () => {
  const f = fixture(); stageProposal(f, proposal('narrow')); seedRunState(f);
  assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', ID]).code, 0);
  stageProposal(f, proposal('close'));
  const gh = fakeGh();
  assert.equal(exec(f, gh).code, 0);
  assert.equal(gh.calls.length, 0);
  assert.equal(skipLines(f).length, 1);
  assert.match(skipLines(f)[0], /proposal-changed/);
  assert.equal(readConsole(f).items[0].resolution, 'pending');
});

test('I5: approve derives --pr from run-state.json; a disagreeing --pr exits 2 and writes nothing', () => {
  const f = fixture(); stageProposal(f); seedRunState(f, { pr: 12 });
  assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', ID, '--pr', '13']).code, 2);
  assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', ID, '--pr', 'local']).code, 2);
  assert.equal(fs.existsSync(consolePath(f)), false);
  assert.equal(autoLines(f).length, 0);
  assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', ID, '--pr', '12']).code, 0);
  assert.equal(readConsole(f).items[0].approval.pr, '12');
});

test('I5: a local-merge config pin, or a run with no PR, derives local', () => {
  const head = (args) => (args[0] === 'rev-parse' ? `${HEAD}\n` : '');
  const f = fixture(); stageProposal(f); seedRunState(f, { pr: 12, model: 'local-merge', worktree: '/wt' });
  assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', ID], { git: head }).code, 0);
  assert.equal(readConsole(f).items[0].approval.pr, 'local');
  assert.equal(readConsole(f).items[0].approval.headSha, HEAD);
  const g = fixture(); stageProposal(g); seedRunState(g, { pr: null, worktree: '/wt' });
  assert.equal(task5(g, ['approve', '--run', g.runDir, '--id', ID, '--pr', '12'], { git: head }).code, 2);
  assert.equal(task5(g, ['approve', '--run', g.runDir, '--id', ID], { git: head }).code, 0);
  assert.equal(readConsole(g).items[0].approval.pr, 'local');
});

test('I5: approve at a multi-spec spec dir derives the parent run PR', () => {
  const f = fixture(); seedRunState(f, { pr: 44 });
  const spec = path.join(f.runDir, 'spec-3');
  fs.mkdirSync(path.join(spec, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(spec, 'staged', ID), proposal());
  const r = task5(f, ['approve', '--run', spec, '--id', ID]);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(fs.readFileSync(path.join(spec, 'console.json'), 'utf8')).items[0].approval.pr, '44');
});

test('M8: a second execute attempted between the first one\'s console read and its write is refused by the lock', () => {
  const f = fixture(); stageProposal(f); seedApproved(f);
  const env = { ...process.env, CLAUDE_TWEAKS_LOCK_WAIT_MS: '50' };
  const gh = fakeGh();
  let consoleReads = 0;
  let second = null;
  const readFile = (p) => {
    const text = realDeps.readFile(p);
    if (path.basename(p) === 'console.json') {
      consoleReads += 1;
      // The second read is the in-lock re-read: the moment the lock exists to protect.
      if (consoleReads === 2) {
        try { second = exec(f, gh, [], { env, readFile: realDeps.readFile }); } catch (err) { second = { code: 'threw', err: String(err) }; }
      }
    }
    return text;
  };
  const first = exec(f, gh, [], { env, readFile });
  assert.equal(first.code, 0, first.err);
  assert.equal(second.code, 3, JSON.stringify(second));
  assert.match(second.err, /locked by another execute/);
  assert.equal(writesOf(gh, 'comment').length, 1);
  assert.equal(writesOf(gh, 'close').length, 1);
  assert.equal(readConsole(f).items[0].resolution, 'applied');
  const again = fakeGh();
  assert.equal(exec(f, again, [], { env }).code, 0);
  assert.equal(again.calls.length, 0);
});

test('a second approve attempted inside the first one\'s console read is refused by the console lock', () => {
  const f = fixture(); stageProposal(f); seedRunState(f);
  const env = { ...process.env, CLAUDE_TWEAKS_LOCK_WAIT_MS: '50' };
  let second = null;
  let fired = false;
  const readFile = (p) => {
    const text = realDeps.readFile(p);
    if (!fired && path.basename(p) === 'console.json') {
      fired = true;
      try { second = task5(f, ['approve', '--run', f.runDir, '--id', ID], { env, readFile: realDeps.readFile }); } catch (err) { second = { code: 'threw', err: String(err) }; }
    }
    return text;
  };
  // console.json does not exist yet, so the first approve's own read throws ENOENT before the hook sees a path: seed one.
  fs.writeFileSync(consolePath(f), JSON.stringify({ resolved: false, mode: 'recheck-approval', at: 'then', items: [] }));
  const first = task5(f, ['approve', '--run', f.runDir, '--id', ID], { env, readFile });
  assert.equal(first.code, 0, first.err);
  assert.equal(second.code, 3, JSON.stringify(second));
  assert.match(second.err, /locked by another approve or execute/);
  assert.equal(readConsole(f).items.length, 1);
});

test('a proposal-changed hold tells the human to re-run approve', () => {
  const f = fixture(); stageProposal(f, proposal('narrow')); seedRunState(f);
  assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', ID]).code, 0);
  stageProposal(f, proposal('close'));
  assert.equal(exec(f, fakeGh()).code, 0);
  assert.match(skipLines(f)[0], /proposal-changed.*re-run approve/);
});

test('M9: a failing AUTO log leaves the approve unwritten and the executed item unsettled', () => {
  const f = fixture(); stageProposal(f); seedRunState(f);
  const failAuto = (arg) => { if (arg.items.some((i) => /^- AUTO/.test(i.entry))) throw new Error('log down'); return realDeps.appendEntries(arg); };
  assert.equal(task5(f, ['approve', '--run', f.runDir, '--id', ID], { appendEntries: failAuto }).code, 3);
  assert.equal(fs.existsSync(consolePath(f)), false);
  seedApproved(f);
  const gh = fakeGh();
  assert.equal(exec(f, gh, [], { appendEntries: failAuto }).code, 3);
  assert.equal(readConsole(f).items[0].resolution, 'pending');
  assert.ok(readConsole(f).items[0].approval.commentedAt, 'the comment marker is kept, so a re-run does not repost');
});

test('A6: a staged write that fails partway still logs the SCANNED summary of what was staged before exit 3', () => {
  const f = fixture();
  seed(f, [rec(10, ['src/a.js']), rec(11, ['src/a.js'])]);
  assert.equal(go(f, candidatesArgv(f)).code, 0);
  const v = { status: 'DONE', verdicts: [{ deliverable: 1, verdict: 'satisfied', quote: 'const widget = makeWidget();' }] };
  let n = 0;
  const writeStaged = (arg) => { n += 1; if (n === 2) throw new Error('disk full'); return realDeps.writeStaged(arg); };
  const r = go(f, writeVerdicts(f, { 10: v, 11: v }), { writeStaged });
  assert.equal(r.code, 3);
  const scanned = f.decisions().split('\n').filter((l) => /^- SCANNED/.test(l)).pop();
  assert.match(scanned, /staged close #10/);
  assert.match(scanned, /stopped: a write failed \(disk full\)/);
});

test('A7: execute --local on an already-closed local record holds as record-closed, not record-read-failed', () => {
  const f = fixture();
  const specs = path.join(f.main, 'specs');
  const ls = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'issues', 'local-store'));
  const { id } = createRecord(specs, {
    slug: 'plain', title: 'Plain', body: RECORD_BODY, facets: defaultFacets(),
  });
  const stored = ls.queryRecords(specs)[0];
  const sid = `followup-recheck-${id}.md`;
  fs.mkdirSync(path.join(f.runDir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(f.runDir, 'staged', sid), composeProposal({
    number: Number(id), title: 'Plain', outcome: 'close', checked: [{ item: 'Do the thing', verdict: 'satisfied', quote: 'makeWidget()' }],
    bodyHash: sha(stored.body), updatedAt: '2026-11-25T00:00:00Z', runId: 'run-1',
  }));
  ls.closeRecord(stored.path);
  fs.writeFileSync(consolePath(f), JSON.stringify({ items: [{ id: sid, section: 'Queue writes', resolution: 'pending', approval: { at: 'then', pr: 'local', headSha: HEAD, stagedHash: stagedHashOf(f, sid) } }] }));
  assert.equal(exec(f, fakeGh(), ['--local', '--local-merged']).code, 0);
  assert.match(skipLines(f)[0], /record-closed/);
});

test('A8: a marker write that fails after the comment posted says so and holds the proposal', () => {
  const f = fixture(); stageProposal(f); seedApproved(f);
  const gh = fakeGh();
  const writeAtomic = () => { throw new Error('disk full'); };
  const r = exec(f, gh, [], { writeAtomic });
  assert.equal(r.code, 0, r.err);
  assert.equal(writesOf(gh, 'comment').length, 1);
  assert.equal(writesOf(gh, 'close').length, 0);
  assert.match(skipLines(f)[0], /comment posted; marker write failed/);
  assert.doesNotMatch(skipLines(f)[0], /the comment failed/);
  assert.equal(readConsole(f).items[0].resolution, 'pending');
  assert.deepEqual(r.json.held, [{ id: ID, reason: 'marker-write-failed' }]);
});

// ---- targeted fix: torn-down local-merge runs (#6284) ----------------------------------------------------------

test('candidates records the checkout HEAD and stage writes it as the proposal Run-head header', () => {
  const f = fixture();
  seed(f, [rec(10, ['src/a.js'])]);
  const calls = [];
  const base = fakeGit(calls);
  const git = (args, opts) => (args[0] === 'rev-parse' ? `${HEAD}\n` : base(args, opts));
  assert.equal(go(f, candidatesArgv(f), { git }).code, 0);
  assert.equal(f.cands().head, HEAD);
  assert.ok(calls.length >= 2);
  const v = { status: 'DONE', verdicts: [{ deliverable: 1, verdict: 'satisfied', quote: 'const widget = makeWidget();' }] };
  assert.equal(go(f, writeVerdicts(f, { 10: v })).code, 0);
  const text = fs.readFileSync(path.join(f.runDir, 'staged', 'followup-recheck-10.md'), 'utf8');
  assert.match(text, new RegExp(`^Run-head: ${HEAD}$`, 'm'));
  assert.equal(parseProposal(text).runHead, HEAD);
});

test('a torn-down local-merge run (worktree null after close-run) approves from the staged Run-head, and execute holds until it is an ancestor', () => {
  const f = fixture();
  const { env, g, head } = realRepo(f);
  stageProposal(f, composeProposal({
    number: 7, title: 'Record 7', outcome: 'close', checked: [{ item: 'Do the thing', verdict: 'satisfied', quote: 'makeWidget()' }],
    bodyHash: sha(RECORD_BODY), updatedAt: '2026-11-25T00:00:00Z', runId: 'run-1', runHead: head,
  }));
  fs.writeFileSync(path.join(f.runDir, 'run-state.json'), JSON.stringify({ status: 'closed', worktree: null, worktreeAtClose: '/gone/worktree' }));
  fs.writeFileSync(path.join(f.runDir, 'config.yml'), 'mode: auto\nintegration-model: local-merge\n');
  const over = { git: realDeps.git, env };
  const r = task5(f, ['approve', '--run', f.runDir, '--id', ID], over);
  assert.equal(r.code, 0, r.err);
  assert.equal(readConsole(f).items[0].approval.pr, 'local');
  assert.equal(readConsole(f).items[0].approval.headSha, head);
  const held = fakeGh();
  assert.equal(exec(f, held, ['--local-merged'], over).code, 0);
  assert.equal(held.writes().length, 0);
  assert.match(skipLines(f)[0], /not-merged/);
  g('merge', '-q', '--no-ff', '-m', 'merge feature', 'feature');
  const merged = fakeGh();
  assert.equal(exec(f, merged, ['--local-merged'], over).code, 0);
  assert.equal(writesOf(merged, 'close').length, 1);
  assert.equal(readConsole(f).items[0].resolution, 'applied');
});

test('a local-merge approval with no live head and a missing or malformed Run-head exits 3 and writes nothing', () => {
  for (const runHead of [undefined, 'not-a-sha']) {
    const f = fixture();
    const text = proposal();
    stageProposal(f, runHead === undefined ? text : text.replace(/^Run: (.*)$/m, `Run: $1\nRun-head: ${runHead}`));
    fs.writeFileSync(path.join(f.runDir, 'run-state.json'), JSON.stringify({ status: 'closed', worktree: null }));
    fs.writeFileSync(path.join(f.runDir, 'config.yml'), 'integration-model: local-merge\n');
    const r = task5(f, ['approve', '--run', f.runDir, '--id', ID]);
    assert.equal(r.code, 3, `${runHead}: ${r.err}`);
    assert.equal(fs.existsSync(consolePath(f)), false);
  }
});

test('execute hands deps.env to integrationBranch, and realDeps.integrationBranch takes that env', () => {
  const f = fixture(); stageProposal(f); seedApproved(f, 'local');
  const env = { ...process.env, MARKER: 'x' };
  const seen = [];
  assert.equal(exec(f, fakeGh(), ['--local-merged'], { env, integrationBranch: (root, e) => { seen.push(e); return 'main'; } }).code, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], env);
  assert.equal(realDeps.integrationBranch.length, 2);
});
