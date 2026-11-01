// tests/digest-rollover-cli.test.js — bin/digest-rollover.js (#4848). In-process tests pin the CLI's own
// decisions over run(argv, deps): which exit code each failure lands on, the exact gh argv, and that a
// refused read never prints. The planner has its own suite (tests/bin-lib/health-core/materiality-digest.test.js).
// The spawned tests run the commands the three readers document, as written, against a stub `gh` on PATH.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { run, realDeps } = require('../plugin/bin/digest-rollover');
const { digestReplacementMarker, materialityEntryLine } = require('../plugin/bin/lib/health-core/materiality-digest');
const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const NOT_ON_WIN32 = { skip: process.platform === 'win32' ? 'a bare executable stub is not a launchable gh on win32' : false };

const marker = (n) => digestReplacementMarker(n);
const oldIssue = (over = {}) => ({ number: 10, state: 'open', author_association: 'MEMBER', labels: [{ name: 'digest' }], body: '', ...over });
const issue = (number, over = {}) => ({ number, state: 'open', author_association: 'MEMBER', labels: [], body: marker(10), ...over });
const planted = (number) => issue(number, { author_association: 'NONE' });
const resume20 = { state: 'resume', replacement: 20, extras: [] };
const none = { state: 'none', replacement: null, extras: [] };

const entry = (finding) => materialityEntryLine({
  area: 'tidy', finding, fileRefs: 'a.js', deferReason: 'direct-filing-sweep', provenance: 'harness-health',
});
const comment = (body, id = 1, over = {}) => ({
  body, authorAssociation: 'MEMBER', createdAt: '2026-08-24T18:35:16Z', url: `https://github.com/o/r/issues/1#issuecomment-${id}`, ...over,
});

const issuePath = (n) => `repos/{owner}/{repo}/issues/${n}`;
const FORBIDDEN_GH = () => { throw new Error('gh must not be called'); };

function fakeDeps(over = {}) {
  const calls = { gh: [], stdout: [], stderr: [], written: {}, probes: 0 };
  return {
    calls,
    ghAvailable: () => { calls.probes += 1; return true; },
    gh: FORBIDDEN_GH,
    readFile: (p) => { throw new Error(`ENOENT: ${p}`); },
    carryDir: (old) => `/tmp/digest-carry-${old}`,
    writeFile: (p, body) => { calls.written[p] = body; },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
    ...over,
  };
}
// A fake gh answering by the joined argv; anything unlisted throws, so a wrong endpoint fails loudly.
const ghFrom = (calls, table) => (args) => {
  calls.push(args);
  const key = args.join(' ');
  if (!(key in table)) throw new Error(`unexpected gh ${key}`);
  const v = table[key];
  if (v instanceof Error) throw v;
  return typeof v === 'string' ? v : JSON.stringify(v);
};
const printed = (deps) => JSON.parse(deps.calls.stdout.join(''));
const silent = (deps) => assert.deepStrictEqual(deps.calls.stdout, [], 'a refused read prints nothing on stdout');

test('--help short-circuits before any probe, for any verb', () => {
  for (const argv of [['--help'], ['verdict', '--help'], ['carry', '-h']]) {
    const deps = fakeDeps();
    assert.strictEqual(run(argv, deps), 0, argv.join(' '));
    assert.match(deps.calls.stdout.join(''), /^usage: digest-rollover\.js verdict/);
    assert.strictEqual(deps.calls.probes, 0);
  }
});

test('every malformed invocation exits 1 with usage, before any probe or read', () => {
  const cases = [
    [],
    ['nope'],
    ['constructor', '--old', '1', '--new', '2'],
    ['verdict'],
    ['verdict', '--old', '10'],
    ['verdict', '--candidates', '20'],
    ['verdict', '--old', '10', '--candidates'],
    ['verdict', '--old', '10', '--candidates', ''],
    ['verdict', '--old', '-1', '--candidates', '20'],
    ['verdict', '--old', '0', '--candidates', '20'],
    ['verdict', '--old', '10', '--candidates', '20,'],
    ['verdict', '--old', '10', '--candidates', '20,x'],
    ['verdict', '--old', '10', '--candidates', '--old-json'],
    ['verdict', '--old', '10', '--new', '20'],
    ['verdict', '--old-json', 'a'],
    ['verdict', '--candidates-json', 'a'],
    ['verdict', '--old', '10', '--candidates', '20', '--old-json', 'a'],
    ['verdict', '--old-json', 'a', '--candidates-json', 'b', '--candidates', '20'],
    ['carry', '--old', '10'],
    ['carry', '--new', '20'],
    ['carry', '--old', '10', '--new', '10'],
    ['carry', '--old', '10', '--new', 'x'],
    ['carry', '--old', '10', '--new', '20', '--candidates', '30'],
    ['carry', '--old', '10', '--new', '20', '--count', '3'],
    ['carry', '--old', '10', '--new', '20', '--old-json', 'a', '--new-json', 'b'],
    ['carry', '--old', '10', '--new', '20', '--count', '-1', '--old-json', 'a', '--new-json', 'b'],
  ];
  for (const argv of cases) {
    const deps = fakeDeps();
    assert.strictEqual(run(argv, deps), 1, JSON.stringify(argv));
    assert.match(deps.calls.stderr.join(''), /usage: digest-rollover\.js/, JSON.stringify(argv));
    silent(deps);
    assert.strictEqual(deps.calls.probes, 0, JSON.stringify(argv));
  }
});

test('a gh form with gh absent exits 2 naming the file form, and a probe that throws reads as absent', () => {
  for (const ghAvailable of [() => false, () => { throw new Error('boom'); }]) {
    for (const argv of [['verdict', '--old', '10', '--candidates', '20'], ['carry', '--old', '10', '--new', '20']]) {
      const deps = fakeDeps({ ghAvailable });
      assert.strictEqual(run(argv, deps), 2, argv.join(' '));
      assert.match(deps.calls.stderr.join(''), /file form/);
      silent(deps);
    }
  }
});

test('verdict reads each issue through REST, with the exact argv, once per issue', () => {
  const calls = [];
  const deps = fakeDeps({
    gh: ghFrom(calls, { [`api ${issuePath(10)}`]: oldIssue(), [`api ${issuePath(20)}`]: issue(20), [`api ${issuePath(25)}`]: issue(25) }),
  });
  assert.strictEqual(run(['verdict', '--old', '10', '--candidates', '25,20,25'], deps), 0);
  assert.deepStrictEqual(printed(deps), { state: 'resume', replacement: 20, extras: [25] });
  assert.deepStrictEqual(calls, [['api', issuePath(10)], ['api', issuePath(25)], ['api', issuePath(20)]]);
});

test('verdict decides over every issue naming {old}: a planted number on either side never displaces the real one', () => {
  const cases = [
    { name: 'planted below real', reps: [planted(15), issue(20)], want: resume20 },
    { name: 'planted above real', reps: [issue(20), planted(25)], want: resume20 },
    { name: 'planted on both sides', reps: [planted(15), issue(20), planted(25)], want: resume20 },
    { name: 'planted only', reps: [planted(15)], want: none },
    { name: 'two trusted', reps: [issue(25), issue(20)], want: { state: 'resume', replacement: 20, extras: [25] } },
  ];
  for (const c of cases) {
    const table = { [`api ${issuePath(10)}`]: oldIssue() };
    for (const r of c.reps) table[`api ${issuePath(r.number)}`] = r;
    const deps = fakeDeps({ gh: ghFrom([], table) });
    assert.strictEqual(run(['verdict', '--old', '10', '--candidates', c.reps.map((r) => r.number).join(',')], deps), 0, c.name);
    assert.deepStrictEqual(printed(deps), c.want, c.name);
  }
});

test('verdict: stalled needs an open old issue, and a closed pair with an open replacement prints orphan under none', () => {
  const run1 = (old, cand) => {
    const deps = fakeDeps({ gh: ghFrom([], { [`api ${issuePath(10)}`]: old, [`api ${issuePath(20)}`]: cand }) });
    assert.strictEqual(run(['verdict', '--old', '10', '--candidates', '20'], deps), 0);
    return printed(deps);
  };
  assert.strictEqual(run1(oldIssue({ labels: [] }), issue(20)).state, 'stalled');
  assert.deepStrictEqual(run1(oldIssue({ labels: [], state: 'closed' }), issue(20, { state: 'closed' })), none);
  assert.deepStrictEqual(run1(oldIssue({ labels: [], state: 'closed' }), issue(20)), { ...none, orphan: 20 });
  assert.strictEqual(run1(oldIssue({ labels: [], state: 'closed' }), issue(20, { labels: [{ name: 'digest' }] })).state, 'finished');
});

test('verdict file form makes no gh call and no probe', () => {
  const files = { '/o': JSON.stringify(oldIssue()), '/c': JSON.stringify([planted(15), issue(20)]) };
  const deps = fakeDeps({ readFile: (p) => files[p], ghAvailable: () => { throw new Error('must not probe'); } });
  assert.strictEqual(run(['verdict', '--old-json', '/o', '--candidates-json', '/c'], deps), 0);
  assert.deepStrictEqual(printed(deps), resume20);
});

test('an unreadable or wrong-shaped read of a pair exits 3 with nothing printed, on both transports', () => {
  const refused = (name, deps, argv) => {
    assert.strictEqual(run(argv, deps), 3, name);
    silent(deps);
    assert.match(deps.calls.stderr.join(''), /refused/, name);
  };
  const GH = ['verdict', '--old', '10', '--candidates', '20,99'];
  const failure = Object.assign(new Error('Command failed'), { stderr: 'HTTP 404: Not Found' });
  const table = { [`api ${issuePath(10)}`]: oldIssue(), [`api ${issuePath(20)}`]: issue(20) };
  const a = fakeDeps({ gh: ghFrom([], { ...table, [`api ${issuePath(99)}`]: failure }) });
  refused('a failed candidate read', a, GH);
  assert.match(a.calls.stderr.join(''), /issue #99: HTTP 404/);
  refused('a failed old read', fakeDeps({ gh: ghFrom([], { [`api ${issuePath(10)}`]: failure }) }), GH);
  refused('non-JSON from gh', fakeDeps({ gh: ghFrom([], { ...table, [`api ${issuePath(99)}`]: 'not json' }) }), GH);
  refused('an error body with exit 0', fakeDeps({ gh: ghFrom([], { ...table, [`api ${issuePath(99)}`]: { message: 'Not Found' } }) }), GH);

  const FILES = ['verdict', '--old-json', '/o', '--candidates-json', '/c'];
  const withFiles = (o, c) => fakeDeps({ readFile: (p) => { const v = { '/o': o, '/c': c }[p]; if (v === undefined) throw new Error('ENOENT'); return v; } });
  const O = JSON.stringify(oldIssue());
  const C = JSON.stringify([issue(20)]);
  refused('an absent old file', withFiles(undefined, C), FILES);
  refused('an absent candidates file', withFiles(O, undefined), FILES);
  refused('an unparseable file', withFiles(O, '{not json'), FILES);
  refused('candidates not an array', withFiles(O, JSON.stringify(issue(20))), FILES);
  refused('an MCP error recorded as a candidate', withFiles(O, JSON.stringify([issue(20), { message: 'Not Found' }])), FILES);
  refused('a candidate with no number, which must not read as a clean none', withFiles(O, JSON.stringify([{ author_association: 'MEMBER', body: marker(10) }])), FILES);
  refused('an MCP error recorded as the old issue', withFiles(JSON.stringify({ message: 'Not Found' }), C), FILES);
  refused('an old issue with no state', withFiles(JSON.stringify({ number: 10 }), C), FILES);
});

// --- carry ---

const carryArgs = ['carry', '--old', '10', '--new', '20'];
const viewArgs = (n) => `issue view ${n} --json comments --jq .comments`;
const countArgs = (n) => `api ${issuePath(n)} --jq .comments`;

test('carry reads the true count, then both issues\' paginated comments, and writes each body under its own old issue\'s dir', () => {
  const calls = [];
  const live = entry('one');
  const deps = fakeDeps({
    gh: ghFrom(calls, { [countArgs(10)]: '1\n', [viewArgs(10)]: [comment(live)], [viewArgs(20)]: [] }),
  });
  assert.strictEqual(run(carryArgs, deps), 0);
  assert.deepStrictEqual(calls.map((c) => c.join(' ')), [countArgs(10), viewArgs(10), viewArgs(20)]);
  const out = printed(deps);
  assert.deepStrictEqual(
    { ...out, paths: undefined },
    {
      old: 10, replacement: 20, count: 1, live: 1, carried: 0, pending: 1, tombstones: 0, tombstonesCarried: 0, tombstonesPending: 0, unfingerprintedMarked: 0, verified: false, skipped: [], paths: undefined, edits: [],
    },
  );
  assert.deepStrictEqual(out.paths, ['/tmp/digest-carry-10/carry-0.md']);
  assert.ok(deps.calls.written[out.paths[0]].startsWith(live), 'the carried line keeps its text');
  assert.ok(deps.calls.written[out.paths[0]].includes('materiality-first-seen: 2026-08-24T18:35:16Z'), 'and its original date');
});

test('carry re-run after posting is verified, and a mark made since prints an edit file with its comment id', () => {
  const live = entry('one');
  const first = fakeDeps({ gh: ghFrom([], { [countArgs(10)]: '1', [viewArgs(10)]: [comment(live)], [viewArgs(20)]: [] }) });
  run(carryArgs, first);
  const posted = comment(Object.values(first.calls.written)[0], 77);
  const second = fakeDeps({ gh: ghFrom([], { [countArgs(10)]: '1', [viewArgs(10)]: [comment(live)], [viewArgs(20)]: [posted] }) });
  assert.strictEqual(run(carryArgs, second), 0);
  assert.strictEqual(printed(second).verified, true);
  assert.deepStrictEqual(printed(second).paths, []);
  const third = fakeDeps({ gh: ghFrom([], { [countArgs(10)]: '1', [viewArgs(10)]: [comment(`${live} → #99`)], [viewArgs(20)]: [posted] }) });
  assert.strictEqual(run(carryArgs, third), 0);
  const out = printed(third);
  assert.strictEqual(out.verified, false);
  assert.deepStrictEqual(out.edits, [{ commentId: '77', path: '/tmp/digest-carry-10/edit-0.md' }]);
  assert.match(third.calls.written[out.edits[0].path], /→ #99/);
});

test('a true count of 0 with an empty read prints empty and verified, and never reads the new side', () => {
  const calls = [];
  const deps = fakeDeps({ gh: ghFrom(calls, { [countArgs(10)]: '0', [viewArgs(10)]: [] }) });
  assert.strictEqual(run(carryArgs, deps), 0);
  const out = printed(deps);
  assert.strictEqual(out.empty, true);
  assert.strictEqual(out.verified, true);
  assert.deepStrictEqual(out.paths, []);
  assert.strictEqual(calls.length, 2);
  assert.deepStrictEqual(deps.calls.written, {});
});

test('a refused carry read exits 3 with nothing printed or written: the plan is never an empty one', () => {
  const live = comment(entry('one'));
  const cases = [
    ['a short read', { [countArgs(10)]: '2', [viewArgs(10)]: [live], [viewArgs(20)]: [] }],
    ['an append between the reads', { [countArgs(10)]: '1', [viewArgs(10)]: [live, live], [viewArgs(20)]: [] }],
    ['an empty read of a non-empty issue', { [countArgs(10)]: '3', [viewArgs(10)]: [], [viewArgs(20)]: [] }],
    ['comments behind a zero count', { [countArgs(10)]: '0', [viewArgs(10)]: [live], [viewArgs(20)]: [] }],
    ['a wrapped read', { [countArgs(10)]: '1', [viewArgs(10)]: { comments: [live] }, [viewArgs(20)]: [] }],
    ['a paged read', { [countArgs(10)]: '1', [viewArgs(10)]: [[live]], [viewArgs(20)]: [] }],
    ['a wrapped new side', { [countArgs(10)]: '1', [viewArgs(10)]: [live], [viewArgs(20)]: { comments: [] } }],
    ['a count that is no number', { [countArgs(10)]: 'null', [viewArgs(10)]: [live], [viewArgs(20)]: [] }],
    ['a blank count over an empty read, which must not pass as an empty issue', { [countArgs(10)]: '\n', [viewArgs(10)]: [] }],
    ['a failed count read', { [countArgs(10)]: new Error('HTTP 502') }],
    ['a failed comment read', { [countArgs(10)]: '1', [viewArgs(10)]: new Error('HTTP 502') }],
    ['a failed new-side read', { [countArgs(10)]: '1', [viewArgs(10)]: [live], [viewArgs(20)]: new Error('HTTP 502') }],
    ['non-JSON comments', { [countArgs(10)]: '1', [viewArgs(10)]: 'gh: not json' }],
  ];
  for (const [name, table] of cases) {
    const deps = fakeDeps({ gh: ghFrom([], table) });
    assert.strictEqual(run(carryArgs, deps), 3, name);
    silent(deps);
    assert.match(deps.calls.stderr.join(''), /refused/, name);
    assert.deepStrictEqual(deps.calls.written, {}, name);
  }
});

test('carry file form takes the count from the flag and makes no gh call and no probe; a bad file exits 3', () => {
  const FILES = ['carry', '--old', '10', '--new', '20', '--count', '1', '--old-json', '/o', '--new-json', '/n'];
  const live = comment(entry('one'));
  const reading = (o, n) => (p) => { const v = { '/o': o, '/n': n }[p]; if (v === undefined) throw new Error('ENOENT'); return v; };
  const ok = fakeDeps({ readFile: reading(JSON.stringify([live]), '[]'), ghAvailable: () => { throw new Error('must not probe'); } });
  assert.strictEqual(run(FILES, ok), 0);
  assert.strictEqual(printed(ok).live, 1);
  assert.strictEqual(printed(ok).count, 1);
  // MCP spellings: created_at and html_url
  const mcp = { body: entry('one'), author_association: 'MEMBER', created_at: '2026-08-24T18:35:16Z', html_url: 'https://github.com/o/r/issues/1#issuecomment-5' };
  const shaped = fakeDeps({ readFile: reading(JSON.stringify([mcp]), '[]') });
  assert.strictEqual(run(FILES, shaped), 0);
  assert.strictEqual(printed(shaped).live, 1);
  const refused = (o, n) => {
    const deps = fakeDeps({ readFile: reading(o, n) });
    assert.strictEqual(run(FILES, deps), 3, `${o} / ${n}`);
    silent(deps);
  };
  refused(undefined, '[]');
  refused(JSON.stringify([live]), undefined);
  refused('{not json', '[]');
  refused(JSON.stringify({ message: 'Not Found' }), '[]');
  refused(JSON.stringify([{ message: 'Not Found' }]), '[]');
  const zero = fakeDeps({ readFile: reading('[]', undefined) });
  assert.strictEqual(run(['carry', '--old', '10', '--new', '20', '--count', '0', '--old-json', '/o', '--new-json', '/n'], zero), 0);
  assert.strictEqual(printed(zero).empty, true);
});

test('each old issue carries into its own temp dir, since step 4 runs carry once per stranded issue', () => {
  assert.notStrictEqual(realDeps.carryDir(10), realDeps.carryDir(11));
  assert.match(realDeps.carryDir(10), /digest-carry-10$/);
});

test('a body that cannot be written exits 3 with nothing printed', () => {
  const deps = fakeDeps({
    gh: ghFrom([], { [countArgs(10)]: '1', [viewArgs(10)]: [comment(entry('one'))], [viewArgs(20)]: [] }),
    writeFile: () => { throw new Error('EACCES'); },
  });
  assert.strictEqual(run(carryArgs, deps), 3);
  silent(deps);
  assert.match(deps.calls.stderr.join(''), /EACCES/);
});

test('a bug is not flattened into a refused read', () => {
  const deps = fakeDeps({
    gh: ghFrom([], { [`api ${issuePath(10)}`]: oldIssue(), [`api ${issuePath(20)}`]: issue(20) }),
    stdout: () => { throw new TypeError('a bug'); },
  });
  assert.throws(() => run(['verdict', '--old', '10', '--candidates', '20'], deps), TypeError);
});

// --- the documented commands, as written ---

const READERS = {
  'tidy/digest-sweep.md': 'digest-resume-',
  'tidy/step-1-records.md': 'tidy-step1-rollover-',
  'specify/next-mode.md': 'specify-next-rollover-',
};
const skillText = (rel) => readText(path.join(REPO_ROOT, 'plugin/skills', rel));
const CLI = 'node "${CLAUDE_PLUGIN_ROOT}/bin/digest-rollover.js"';
// The single ```bash fence line holding a documented command, fence indentation dropped.
const documented = (src, lead, label, { whole = false } = {}) => {
  const lines = src.split('\n').map((l) => l.trim()).filter((l) => (whole ? l === `${CLI} ${lead}` : l.startsWith(`${CLI} ${lead}`)));
  assert.strictEqual(lines.length, 1, `${label}: ${lines.length} lines start with ${lead}`);
  const at = src.indexOf(lines[0]);
  const open = src.lastIndexOf('```bash', at);
  const close = src.indexOf('```', at);
  assert.ok(open !== -1 && close !== -1 && !src.slice(open + 7, at).includes('```'), `${label}: ${lead} is not in a bash fence`);
  return lines[0];
};
const GH_LINE = 'verdict --old {old} --candidates {n},{n}';
const FILE_LINE = 'verdict --old-json ';

const scratch = (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-rollover-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
// A stub `gh` answering from a JSON table of joined argv, as real gh does: a failed call prints to
// stderr and exits non-zero. Real `gh api` output has no final newline.
function ghStubDir(dir, table) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(dir, 'table.json'), JSON.stringify(table));
  const stub = path.join(bin, 'gh');
  fs.writeFileSync(stub, `#!${process.execPath}
const table = JSON.parse(require('fs').readFileSync(${JSON.stringify(path.join(dir, 'table.json'))}, 'utf8'));
const key = process.argv.slice(2).join(' ');
if (key === '--version') { console.log('gh version 2.0.0'); process.exit(0); }
if (!(key in table) || table[key] === null) { process.stderr.write('HTTP 404: Not Found (' + key + ')\\n'); process.exit(1); }
process.stdout.write(typeof table[key] === 'string' ? table[key] : JSON.stringify(table[key]));
`);
  fs.chmodSync(stub, 0o755);
  return bin;
}
const sessionEnv = (dir) => ({ CLAUDE_CODE_SESSION_ID: 'digest-rollover-test', TMPDIR: dir, TEMP: dir, TMP: dir });
const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugin').split(path.sep).join('/');
const runLine = (line, env) => spawnSync('/bin/bash', ['-c', line], {
  encoding: 'utf8', cwd: REPO_ROOT, env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...env },
});
const withGh = (dir, table) => ({ ...sessionEnv(dir), PATH: `${ghStubDir(dir, table)}${path.delimiter}${process.env.PATH}` });
// A PATH holding node alone, so `gh` is absent however the machine is set up.
const noGh = (dir) => {
  const bin = path.join(dir, 'nogh');
  fs.mkdirSync(bin, { recursive: true });
  fs.rmSync(path.join(bin, 'node'), { force: true });
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  return { ...sessionEnv(dir), PATH: bin };
};
const resolved = (dir, name) => spawnSync(process.execPath, [path.join(REPO_ROOT, 'plugin/bin/session-tmp-resolve.js'), '--value', name], {
  env: { ...process.env, ...sessionEnv(dir) }, encoding: 'utf8',
}).stdout.trim();

test('every reader documents both verdict commands, the gh form and one file form under its own temp names', () => {
  const names = [];
  for (const [rel, prefix] of Object.entries(READERS)) {
    const src = skillText(rel);
    documented(src, GH_LINE, rel);
    const line = documented(src, FILE_LINE, rel);
    const mine = [...line.matchAll(/--value (\S+?)\)/g)].map((m) => m[1]);
    assert.strictEqual(mine.length, 2, `${rel}: ${line}`);
    assert.ok(mine.every((n) => n.startsWith(prefix)), `${rel}: ${mine}`);
    for (const n of mine) assert.ok(src.includes(`--value ${n}\` `) || src.includes(`--value ${n}\` print`), `${rel}: the Write sentence names ${n}`);
    names.push(...mine);
    assert.ok(!src.includes('node -e "const fs=require(\'fs\');const [root,c,o]'), `${rel}: the inlined verdict script is gone`);
  }
  assert.strictEqual(new Set(names).size, names.length, `a temp name is shared between readers: ${names}`);
});

test('each reader\'s documented gh verdict runs as written, and a refused read prints no verdict', NOT_ON_WIN32, (t) => {
  for (const [rel, prefix] of Object.entries(READERS)) {
    const line = documented(skillText(rel), GH_LINE, rel);
    const filled = (reps) => line.replace('{old}', '10').replace('{n},{n}', reps.join(','));
    const table = {
      [`api ${issuePath(10)}`]: oldIssue(),
      [`api ${issuePath(15)}`]: planted(15),
      [`api ${issuePath(20)}`]: issue(20),
      [`api ${issuePath(25)}`]: issue(25),
    };
    const dir = scratch(t);
    const env = withGh(dir, table);
    for (const [reps, want] of [
      [[20], resume20],
      [[15, 20], resume20],
      [[25, 20], { state: 'resume', replacement: 20, extras: [25] }],
      [[15], none],
    ]) {
      const r = runLine(filled(reps), env);
      assert.strictEqual(r.status, 0, `${rel} ${reps}: ${r.stderr}`);
      assert.deepStrictEqual(JSON.parse(r.stdout), want, `${rel} ${reps}`);
    }
    const unreadable = runLine(filled([20, 99]), env);
    assert.strictEqual(unreadable.status, 3, `${prefix}: ${unreadable.stderr}`);
    assert.strictEqual(unreadable.stdout, '');
    assert.match(unreadable.stderr, /issue #99/);
    const absent = runLine(filled([20]), noGh(dir));
    assert.strictEqual(absent.status, 2, `${prefix} ${absent.stderr}`);
  }
});

test('each reader\'s documented file-form verdict runs as written with gh absent', NOT_ON_WIN32, (t) => {
  for (const [rel] of Object.entries(READERS)) {
    const src = skillText(rel);
    const line = documented(src, FILE_LINE, rel);
    const [oldName, candName] = [...line.matchAll(/--value (\S+?)\)/g)].map((m) => m[1]);
    const dir = scratch(t);
    fs.writeFileSync(resolved(dir, oldName), JSON.stringify(oldIssue(), null, 2));
    fs.writeFileSync(resolved(dir, candName), JSON.stringify([planted(15), issue(20)], null, 2));
    const r = runLine(line, noGh(dir));
    assert.strictEqual(r.status, 0, `${rel}: ${r.stderr}`);
    assert.deepStrictEqual(JSON.parse(r.stdout), resume20, rel);
    // An unreadable candidate: an MCP error the agent wrote as data.
    fs.writeFileSync(resolved(dir, candName), JSON.stringify([issue(20), { message: 'Not Found' }]));
    const bad = runLine(line, noGh(dir));
    assert.strictEqual(bad.status, 3, `${rel}: ${bad.stderr}`);
    assert.strictEqual(bad.stdout, '');
  }
});

test('step 2\'s documented carry runs as written against a stubbed gh, posts converge, and a refused read exits 3', NOT_ON_WIN32, (t) => {
  const SWEEP = skillText('tidy/digest-sweep.md');
  const line = documented(SWEEP, 'carry --old {old} --new {replacement}', 'gh carry', { whole: true }).replace('{old}', '10').replace('{replacement}', '20');
  const dir = scratch(t);
  const live = entry('one');
  const r = runLine(line, withGh(dir, { [countArgs(10)]: '1', [viewArgs(10)]: [comment(live)], [viewArgs(20)]: [] }));
  assert.strictEqual(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.strictEqual(plan.verified, false);
  assert.strictEqual(plan.paths.length, 1);
  const body = fs.readFileSync(plan.paths[0], 'utf8');
  assert.ok(body.startsWith(live), body);
  assert.ok(plan.paths[0].includes('digest-carry-10'), 'each old issue gets its own dir');
  const again = runLine(line, withGh(dir, { [countArgs(10)]: '1', [viewArgs(10)]: [comment(live)], [viewArgs(20)]: [comment(body, 5)] }));
  assert.strictEqual(again.status, 0, again.stderr);
  assert.strictEqual(JSON.parse(again.stdout).verified, true);
  const short = runLine(line, withGh(dir, { [countArgs(10)]: '2', [viewArgs(10)]: [comment(live)], [viewArgs(20)]: [] }));
  assert.strictEqual(short.status, 3, short.stderr);
  assert.strictEqual(short.stdout, '');
  assert.match(short.stderr, /truncated or partial read/);
  const failed = runLine(line, withGh(dir, { [countArgs(10)]: '1', [viewArgs(10)]: null }));
  assert.strictEqual(failed.status, 3, failed.stderr);
  assert.strictEqual(failed.stdout, '');
  assert.strictEqual(runLine(line, noGh(dir)).status, 2);
});

test('step 2\'s documented file-form carry runs as written with gh absent', NOT_ON_WIN32, (t) => {
  const SWEEP = skillText('tidy/digest-sweep.md');
  const line = documented(SWEEP, 'carry --old {old} --new {replacement} --count {count}', 'file carry')
    .replace('{old}', '10').replace('{replacement}', '20');
  const dir = scratch(t);
  const [oldName, newName] = [...line.matchAll(/--value (\S+?)\)/g)].map((m) => m[1]);
  assert.ok(oldName.startsWith('digest-carry-') && newName.startsWith('digest-carry-'), line);
  fs.writeFileSync(resolved(dir, oldName), JSON.stringify([comment(entry('one'))]));
  fs.writeFileSync(resolved(dir, newName), '[]');
  const r = runLine(line.replace('{count}', '1'), noGh(dir));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).live, 1);
  const short = runLine(line.replace('{count}', '2'), noGh(dir));
  assert.strictEqual(short.status, 3, short.stderr);
  assert.strictEqual(short.stdout, '');
});
