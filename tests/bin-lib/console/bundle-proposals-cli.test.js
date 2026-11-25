'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const { run, realDeps, USAGE } = require(path.join(ROOT, 'plugin', 'bin', 'bundle-proposals'));
const { specShapedBody, recordPayload } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'issues', 'record'));
const { readSnapshot, classifyStagedItem, SECTION_MAP } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'resolve'));

const fixtureRoots = [];
after(() => { for (const r of fixtureRoots) fs.rmSync(r, { recursive: true, force: true }); });

const LEDGER_HEAD = '# Open Items — x\n\n| # | Phase | Item | Status | Resolution |\n|---|-------|------|--------|------------|\n';

// An anchored run dir: <main>/.git is a directory, the run sits under <main>/.claude-tweaks/pipelines/.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-'));
  fixtureRoots.push(root);
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-11-25T090000-spec-1');
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  const f = {
    root, main, runDir, records: path.join(root, 'records.json'),
    staged: (name, dir = runDir) => path.join(dir, 'staged', name),
    ledger: path.join(runDir, 'ledger.md'),
    read: (p) => fs.readFileSync(p, 'utf8'),
    decisions: () => { try { return fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'); } catch { return ''; } },
    ls: (dir) => { try { return fs.readdirSync(dir).sort(); } catch { return []; } },
  };
  fs.writeFileSync(f.records, JSON.stringify([unrelatedOpen()]));
  return f;
}

function unrelatedOpen(over = {}) {
  return { number: 900, title: 'Unrelated backlog item', body: 'Nothing to do with the run.', labels: [], state: 'OPEN', ...over };
}

// A staged proposal text shaped like wrap-up/leftover-routing.md writes it.
function proposal({ title, files = [], labels = ['ready'], fp, deferReason = 'tangential' }) {
  const body = specShapedBody({
    currentState: `Finding for ${title}.`,
    deliverables: `- [ ] Fix ${title}`,
    acceptanceCriteria: `${title} is fixed.`,
    releaseNote: `Fixes ${title}.`,
    filedBy: 'wrap-up leftover routing',
    provenance: { origin: 'wrap-up leftover from #1', deferReason },
    keyFiles: files.map((p) => ({ path: p, change: 'modify' })),
  });
  const payload = recordPayload({ title, body, type: 'task', fingerprint: fp });
  return `Title: ${payload.title}\nType: ${payload.type}\nLabels: ${labels.join(', ')}\nDefer-reason: ${deferReason}\n\n${payload.body}`;
}

function put(f, name, opts, dir = f.runDir) {
  const text = proposal(opts);
  fs.mkdirSync(path.join(dir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'staged', name), text);
  return text;
}

// leftover-a, leftover-b and ledger-record-c share src/a.js; leftover-z is alone on src/z.js.
function seed(f) {
  const texts = {
    'leftover-a.md': put(f, 'leftover-a.md', { title: 'Alpha gap', files: ['src/a.js', 'src/a2.js'], fp: 'fp-a' }),
    'leftover-b.md': put(f, 'leftover-b.md', { title: 'Beta gap', files: ['src/a.js'], fp: 'fp-b' }),
    'ledger-record-c.md': put(f, 'ledger-record-c.md', { title: 'Gamma gap', files: ['src/a.js'], fp: 'fp-c' }),
    'leftover-z.md': put(f, 'leftover-z.md', { title: 'Zeta gap', files: ['src/z.js'], fp: 'fp-z' }),
  };
  fs.writeFileSync(f.ledger, `${LEDGER_HEAD}| 1 | review | gamma finding | deferred | staged/ledger-record-c.md |\n| 2 | review | other | open | — |\n`);
  fs.writeFileSync(path.join(f.runDir, 'decisions.md'), [
    '## /wrap-up',
    ...Object.keys(texts).map((n) => `- STAGED 10:00:00 — /wrap-up: leftover proposal staged/${n}. Reversibility: high.`),
    '',
  ].join('\n'));
  return texts;
}

function go(f, extra = [], overrides = {}, { records = true } = {}) {
  const out = []; const err = [];
  const deps = {
    ...realDeps, cwd: () => f.main, stdout: (s) => out.push(s), stderr: (s) => err.push(s), now: () => 0, ...overrides,
  };
  const withRecords = records && !extra.includes('--unbundle');
  const argv = ['--run', f.runDir, ...(withRecords ? ['--records-json', f.records] : []), ...extra];
  const code = run(argv, deps);
  const line = out.join('').trim();
  let json = null;
  try { json = JSON.parse(line); } catch { json = null; }
  return { code, out: out.join(''), err: err.join(''), json };
}

const snapshotDeps = () => ({
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
  readGrants: () => ({}),
});

test('happy path: two leftovers and a ledger record bundle into staged/bundle-1.md, the singleton stays', () => {
  const f = fixture();
  const texts = seed(f);
  const r = go(f);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.bundles.length, 1);
  const [b] = r.json.bundles;
  assert.equal(b.path, 'staged/bundle-1.md');
  assert.equal(b.class, 'ready');
  assert.deepEqual(b.members, ['staged/ledger-record-c.md', 'staged/leftover-a.md', 'staged/leftover-b.md']);
  assert.deepEqual(b.sharedPaths, ['src/a.js']);
  assert.deepEqual(r.json.singletons, ['staged/leftover-z.md']);
  assert.deepEqual(r.json.skipped, []);
  assert.deepEqual(f.ls(path.join(f.runDir, 'staged')), ['bundle-1.md', 'leftover-z.md']);
  assert.deepEqual(f.ls(path.join(f.runDir, 'bundled')), ['ledger-record-c.md', 'leftover-a.md', 'leftover-b.md']);
  const bundled = f.read(path.join(f.runDir, 'bundled', 'leftover-a.md'));
  assert.ok(bundled.startsWith('Bundled-into: staged/bundle-1.md\n'));
  assert.ok(bundled.endsWith(texts['leftover-a.md']));
  assert.match(f.read(f.staged('bundle-1.md')), /^Title: Bundle: 3 follow-ups touching src\/a\.js\n/);
});

test('AC8: the console sees the bundle and no member; an older SECTION_MAP leaves the bundle unmapped; no member header survives', () => {
  const f = fixture();
  seed(f);
  const originalStagedLines = f.decisions().split('\n').filter((l) => /^- STAGED /.test(l));
  assert.equal(go(f).code, 0);
  const snap = readSnapshot({ runDir: f.runDir, deps: snapshotDeps() });
  const names = snap.staged.map((s) => s.name);
  assert.deepEqual(names, ['bundle-1.md', 'leftover-z.md']);
  assert.equal(classifyStagedItem('bundle-1.md', f.read(f.staged('bundle-1.md'))).section, SECTION_MAP.find(([re]) => re.test('bundle-1.md'))[1]);
  // An older resolve.js has no `bundle-` row: the same name falls through to the unmapped-prefix arm.
  const older = SECTION_MAP.filter(([re]) => !re.test('bundle-1.md'));
  assert.equal(older.some(([re]) => re.test('bundle-1.md')), false);
  assert.equal(older.length, SECTION_MAP.length - 1);
  // Every path a member's original STAGED line names is gone from staged/.
  for (const line of originalStagedLines) {
    const m = /staged\/(\S+?\.md)/.exec(line);
    if (m[1] === 'leftover-z.md') continue;
    assert.equal(fs.existsSync(f.staged(m[1])), false, m[1]);
  }
  // Only the bundle and the singleton carry a Title:/Type:/Labels: header under staged/.
  const withHeader = f.ls(path.join(f.runDir, 'staged')).filter((n) => /^(Title|Type|Labels): /m.test(f.read(f.staged(n))));
  assert.deepEqual(withHeader, ['bundle-1.md', 'leftover-z.md']);
});

test('AC10: a bundled ledger-record member row names staged/bundle-1.md and keeps its status', () => {
  const f = fixture();
  seed(f);
  assert.equal(go(f).code, 0);
  const text = f.read(f.ledger);
  assert.ok(text.includes('| 1 | review | gamma finding | deferred | staged/bundle-1.md |'), text);
  assert.ok(text.includes('| 2 | review | other | open | — |'));
  const header = f.read(path.join(f.runDir, 'bundled', 'ledger-record-c.md')).split('\n\n')[0];
  assert.match(header, new RegExp(`^Ledger-row: ${fs.realpathSync(f.ledger).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}#1$`, 'm'));
  assert.match(header, /^Ledger-resolution-was: staged\/ledger-record-c\.md$/m);
});

test('AC11/AC18: one AUTO line per bundle names the bundle, its members, the shared paths and Reversibility: high', () => {
  const f = fixture();
  seed(f);
  assert.equal(go(f).code, 0);
  const auto = f.decisions().split('\n').filter((l) => /^- AUTO /.test(l));
  assert.equal(auto.length, 1);
  assert.match(auto[0], /^- AUTO \d\d:\d\d:\d\d — Proposal bundling: bundled staged\/bundle-1\.md \(ready\) from staged\/ledger-record-c\.md, staged\/leftover-a\.md, staged\/leftover-b\.md; shared: src\/a\.js\. Reversibility: high\.$/);
  const lines = f.decisions().split('\n');
  assert.ok(lines.indexOf('## /wrap-up') < lines.findIndex((l) => /^- AUTO /.test(l)));
});

test('AC12: an empty input set exits 0, prints the empty envelope and writes nothing', () => {
  const f = fixture();
  const before = f.ls(f.runDir);
  const r = go(f);
  assert.equal(r.code, 0);
  assert.deepEqual(r.json, { bundles: [], singletons: [], skipped: [] });
  assert.deepEqual(f.ls(f.runDir), before);
  assert.equal(f.decisions(), '');
});

test('AC12: a malformed member stays in staged/ and is reported in skipped', () => {
  const f = fixture();
  seed(f);
  fs.writeFileSync(f.staged('leftover-bad.md'), 'no header at all, just prose\n');
  const r = go(f);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.bundles.length, 1);
  assert.ok(r.json.skipped.some((s) => s.path === 'staged/leftover-bad.md' && /unparseable|no Title/.test(s.reason)), JSON.stringify(r.json.skipped));
  assert.ok(fs.existsSync(f.staged('leftover-bad.md')));
});

test('input set: shadow-dup copies, sdd-ruling ledger records, bundle- files, Bundled-into files and Refused items are never members', () => {
  const f = fixture();
  seed(f);
  const keep = { title: 'Other', files: ['src/a.js'], fp: 'fp-o' };
  put(f, 'leftover-dup.md.shadow-dup', keep);
  put(f, 'ledger-record-sdd-ruling-1.md', keep);
  fs.writeFileSync(f.staged('leftover-held.md'), `Bundled-into: staged/bundle-9.md\n${proposal(keep)}`);
  put(f, 'leftover-refused.md', keep);
  fs.appendFileSync(path.join(f.runDir, 'decisions.md'), '- REFUSED 10:01:00 — /wrap-up: leftover proposal staged/leftover-refused.md refused. Reversibility: high.\n');
  const r = go(f);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.bundles[0].members, ['staged/ledger-record-c.md', 'staged/leftover-a.md', 'staged/leftover-b.md']);
  for (const n of ['leftover-dup.md.shadow-dup', 'ledger-record-sdd-ruling-1.md', 'leftover-held.md', 'leftover-refused.md']) {
    assert.ok(fs.existsSync(f.staged(n)), n);
  }
});

test('AC12/AC17: an unreadable --records-json, [] and an all-closed array exit 4 and write nothing', () => {
  const f = fixture();
  seed(f);
  const before = f.ls(path.join(f.runDir, 'staged'));
  const decisions = f.decisions();
  const ledger = f.read(f.ledger);
  const cases = {
    unreadable: () => fs.rmSync(f.records, { force: true }),
    empty: () => fs.writeFileSync(f.records, '[]'),
    'all closed': () => fs.writeFileSync(f.records, JSON.stringify([unrelatedOpen({ state: 'CLOSED' }), unrelatedOpen({ number: 901, state: 'closed' })])),
    'not an array': () => fs.writeFileSync(f.records, '{"a":1}'),
    'not json': () => fs.writeFileSync(f.records, 'nope'),
  };
  for (const [label, setup] of Object.entries(cases)) {
    setup();
    const r = go(f);
    assert.equal(r.code, 4, label);
    assert.equal(r.out, '', label);
    assert.deepEqual(f.ls(path.join(f.runDir, 'staged')), before, label);
    assert.equal(fs.existsSync(path.join(f.runDir, 'bundled')), false, label);
    assert.equal(f.decisions(), decisions, label);
    assert.equal(f.read(f.ledger), ledger, label);
  }
});

test('closed records do not count toward hubs; the same three records open make the path a hub', () => {
  const body = specShapedBody({
    currentState: 'x', deliverables: '- [ ] x', acceptanceCriteria: 'x', releaseNote: 'x', filedBy: 't', provenance: { origin: 'o', deferReason: 'tangential' },
    keyFiles: [{ path: 'src/x.js', change: 'modify' }],
  });
  const citing = (state) => [1, 2, 3].map((n) => ({ number: n, title: `citing ${n}`, body, labels: [], state }));
  const files = (f) => {
    put(f, 'leftover-a.md', { title: 'Alpha gap', files: ['src/x.js'], fp: 'fp-a' });
    put(f, 'leftover-b.md', { title: 'Beta gap', files: ['src/x.js'], fp: 'fp-b' });
  };
  const closed = fixture(); files(closed);
  fs.writeFileSync(closed.records, JSON.stringify([...citing('CLOSED'), unrelatedOpen()]));
  assert.equal(go(closed).json.bundles.length, 1, 'x.js still bridges');
  const open = fixture(); files(open);
  fs.writeFileSync(open.records, JSON.stringify(citing('OPEN')));
  const r = go(open);
  assert.equal(r.code, 0);
  assert.equal(r.json.bundles.length, 0, 'three open citations make x.js a hub');
});

test('near-duplicate: an open record near-duplicating the bundle adds a Related line to the bundle text', () => {
  const f = fixture();
  seed(f);
  assert.equal(go(f).code, 0);
  const bundle = f.read(f.staged('bundle-1.md'));
  const title = /^Title: (.*)$/m.exec(bundle)[1];
  const body = bundle.slice(bundle.indexOf('\n\n') + 2);
  assert.doesNotMatch(bundle, /\*\*Related:\*\*/);
  assert.equal(go(f, ['--unbundle', 'bundle-1.md']).code, 0);
  fs.writeFileSync(f.records, JSON.stringify([unrelatedOpen(), { number: 77, title, body, labels: ['ready'], state: 'OPEN' }]));
  assert.equal(go(f).code, 0);
  assert.match(f.read(f.staged('bundle-1.md')), /\*\*Related:\*\* #77/);
});

test('AC9: a write failure after step 1 and after step 2 exits 3 and restores every member, the ledger and staged/', () => {
  const stages = {
    'after step 1 (first retire write fails)': () => ({ writeFile: () => { throw new Error('disk full'); } }),
    'after step 2 (ledger settle fails)': () => ({ settleRow: () => { throw new Error('ledger locked'); } }),
    'step 4 (decisions append fails)': () => ({ appendEntries: () => { throw new Error('decisions locked'); } }),
    'second member retire fails': () => {
      let n = 0;
      return { writeFile: (p, s) => { n += 1; if (n === 2) throw new Error('disk full'); return realDeps.writeFile(p, s); } };
    },
  };
  for (const [label, makeOverrides] of Object.entries(stages)) {
    const f = fixture();
    const texts = seed(f);
    const ledger = f.read(f.ledger);
    const decisions = f.decisions();
    const r = go(f, [], makeOverrides());
    assert.equal(r.code, 3, `${label}: ${r.err}`);
    assert.equal(r.out, '', label);
    assert.deepEqual(f.ls(path.join(f.runDir, 'staged')), Object.keys(texts).sort(), label);
    for (const [name, text] of Object.entries(texts)) assert.equal(f.read(f.staged(name)), text, `${label} ${name}`);
    assert.deepEqual(f.ls(path.join(f.runDir, 'bundled')), [], label);
    assert.equal(f.read(f.ledger), ledger, label);
    assert.equal(f.decisions(), decisions, label);
  }
});

test('AC9: bundling is all-or-nothing per invocation — a second bundle failing rolls the first back too', () => {
  const f = fixture();
  const texts = seed(f);
  Object.assign(texts, {
    'leftover-p.md': put(f, 'leftover-p.md', { title: 'Pi gap', files: ['src/p.js'], fp: 'fp-p' }),
    'leftover-q.md': put(f, 'leftover-q.md', { title: 'Rho gap', files: ['src/p.js'], fp: 'fp-q' }),
  });
  const ledger = f.read(f.ledger);
  let writes = 0;
  const r = go(f, [], { writeFile: (p, s) => { writes += 1; if (writes === 5) throw new Error('disk full'); return realDeps.writeFile(p, s); } });
  assert.equal(r.code, 3, r.err);
  assert.ok(writes >= 5, 'the first bundle completed before the failure');
  assert.deepEqual(f.ls(path.join(f.runDir, 'staged')), Object.keys(texts).sort());
  for (const [name, text] of Object.entries(texts)) assert.equal(f.read(f.staged(name)), text, name);
  assert.deepEqual(f.ls(path.join(f.runDir, 'bundled')), []);
  assert.equal(f.read(f.ledger), ledger);
  assert.equal(f.decisions().includes('AUTO'), false);
});

test('crash recovery: a stray staged/bundle-1.md with no bundled/ members is removed on the next run', () => {
  const f = fixture();
  seed(f);
  fs.writeFileSync(f.staged('bundle-1.md'), proposal({ title: 'Stray', files: ['src/a.js'] }));
  const r = go(f);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.bundles[0].path, 'staged/bundle-1.md', 'the stray was deleted, so allocate gets slot 1 back');
  assert.doesNotMatch(f.read(f.staged('bundle-1.md')), /Stray/);
});

test('crash recovery: a bundled/ member whose bundle file is missing goes back to staged/ with its ledger Resolution', () => {
  const f = fixture();
  const texts = seed(f);
  const ledger = f.read(f.ledger);
  assert.equal(go(f).code, 0);
  fs.rmSync(f.staged('bundle-1.md'));
  // Three open records citing src/a.js make it a hub, so the restored members do not bundle again.
  const body = specShapedBody({
    currentState: 'x', deliverables: '- [ ] x', acceptanceCriteria: 'x', releaseNote: 'x', filedBy: 't', provenance: { origin: 'o', deferReason: 'tangential' },
    keyFiles: [{ path: 'src/a.js', change: 'modify' }],
  });
  fs.writeFileSync(f.records, JSON.stringify([1, 2, 3].map((n) => ({ number: n, title: `c${n}`, body, labels: [], state: 'OPEN' }))));
  const r = go(f);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.bundles, []);
  for (const [name, text] of Object.entries(texts)) assert.equal(f.read(f.staged(name)), text, name);
  assert.deepEqual(f.ls(path.join(f.runDir, 'bundled')), []);
  assert.equal(f.read(f.ledger), ledger);
});

test('Review Focus 3: a ledger-record member with no ledger row stays a singleton and is not retired', () => {
  const f = fixture();
  seed(f);
  fs.writeFileSync(f.ledger, `${LEDGER_HEAD}| 2 | review | other | open | — |\n`);
  const r = go(f);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.bundles[0].members, ['staged/leftover-a.md', 'staged/leftover-b.md']);
  assert.ok(r.json.singletons.includes('staged/ledger-record-c.md'));
  assert.ok(r.json.skipped.some((s) => s.path === 'staged/ledger-record-c.md' && s.reason === 'singleton: ledger row not found'));
  assert.ok(fs.existsSync(f.staged('ledger-record-c.md')));
  assert.equal(fs.existsSync(path.join(f.runDir, 'bundled', 'ledger-record-c.md')), false);
});

test('AC14: a second run over the same dir is a no-op', () => {
  const f = fixture();
  seed(f);
  assert.equal(go(f).code, 0);
  const snapshot = () => ({
    staged: f.ls(path.join(f.runDir, 'staged')).map((n) => [n, f.read(f.staged(n))]),
    bundled: f.ls(path.join(f.runDir, 'bundled')),
    ledger: f.read(f.ledger),
    decisions: f.decisions(),
  });
  const before = snapshot();
  const r = go(f);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.bundles, []);
  assert.deepEqual(snapshot(), before);
});

test('AC16: --unbundle restores every member byte for byte, the original ledger Resolution, and logs one AUTO line', () => {
  const f = fixture();
  const texts = seed(f);
  const ledger = f.read(f.ledger);
  assert.equal(go(f).code, 0);
  const r = go(f, ['--unbundle', 'bundle-1.md']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(f.ls(path.join(f.runDir, 'staged')), Object.keys(texts).sort());
  for (const [name, text] of Object.entries(texts)) assert.equal(f.read(f.staged(name)), text, name);
  assert.deepEqual(f.ls(path.join(f.runDir, 'bundled')), []);
  assert.equal(f.read(f.ledger), ledger);
  const unbundled = f.decisions().split('\n').filter((l) => /^- AUTO .*un-bundled/.test(l));
  assert.equal(unbundled.length, 1);
  assert.match(unbundled[0], /un-bundled staged\/bundle-1\.md → staged\/ledger-record-c\.md, staged\/leftover-a\.md, staged\/leftover-b\.md\. Reversibility: high\.$/);
  assert.equal(go(f, ['--unbundle', 'bundle-1.md']).code, 2, 'an absent bundle is a usage error');
});

test('multi-spec: members in spec-1/staged and spec-2/staged bundle into {run}/staged and retire into their own spec-N/bundled', () => {
  const f = fixture();
  const s1 = path.join(f.runDir, 'spec-1');
  const s2 = path.join(f.runDir, 'spec-2');
  put(f, 'leftover-a.md', { title: 'Alpha gap', files: ['src/a.js'], fp: 'fp-a' }, s1);
  put(f, 'leftover-b.md', { title: 'Beta gap', files: ['src/a.js'], fp: 'fp-b' }, s2);
  put(f, 'ledger-record-c.md', { title: 'Gamma gap', files: ['src/a.js'], fp: 'fp-c' }, s2);
  fs.writeFileSync(f.ledger, `${LEDGER_HEAD}| 1 | review | gamma | deferred | spec-2/staged/ledger-record-c.md |\n`);
  const r = go(f, ['--ledger', f.ledger]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.bundles[0].members, ['spec-1/staged/leftover-a.md', 'spec-2/staged/ledger-record-c.md', 'spec-2/staged/leftover-b.md']);
  assert.equal(r.json.bundles[0].path, 'staged/bundle-1.md');
  assert.deepEqual(f.ls(path.join(f.runDir, 'staged')), ['bundle-1.md']);
  assert.deepEqual(f.ls(path.join(s1, 'staged')), []);
  assert.deepEqual(f.ls(path.join(s1, 'bundled')), ['leftover-a.md']);
  assert.deepEqual(f.ls(path.join(s2, 'bundled')), ['ledger-record-c.md', 'leftover-b.md']);
  assert.ok(f.read(f.ledger).includes('| 1 | review | gamma | deferred | staged/bundle-1.md |'));
  assert.equal(go(f, ['--ledger', f.ledger, '--unbundle', 'bundle-1.md']).code, 0);
  assert.ok(f.read(f.ledger).includes('| 1 | review | gamma | deferred | spec-2/staged/ledger-record-c.md |'));
  assert.deepEqual(f.ls(path.join(s2, 'staged')), ['ledger-record-c.md', 'leftover-b.md']);
});

test('multi-spec: spec dirs read in manifest.yml order', () => {
  const f = fixture();
  const s1 = path.join(f.runDir, 'spec-1');
  const s2 = path.join(f.runDir, 'spec-2');
  put(f, 'leftover-a.md', { title: 'Alpha gap', files: ['src/a.js'], fp: 'fp-a' }, s1);
  put(f, 'leftover-b.md', { title: 'Beta gap', files: ['src/a.js'], fp: 'fp-b' }, s2);
  fs.writeFileSync(path.join(f.runDir, 'manifest.yml'), 'multispec:\n  parent: run\n  specs:\n    - id: 2\n      status: pending\n    - id: 1\n      status: pending\n');
  const r = go(f);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json.bundles[0].members, ['spec-2/staged/leftover-b.md', 'spec-1/staged/leftover-a.md']);
});

test('--local reads open records through local-store; an empty specs dir exits 4', () => {
  const f = fixture();
  seed(f);
  const local = (extra) => go(f, extra, {}, { records: false });
  assert.equal(local(['--local']).code, 4);
  fs.mkdirSync(path.join(f.main, 'specs'));
  fs.writeFileSync(path.join(f.main, 'specs', '01-unrelated.md'), '# Unrelated\n\nbody\n');
  const r = local(['--local']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json.bundles.length, 1);
});

test('invocation errors exit 2; an unanchored run dir exits 3', () => {
  const f = fixture();
  seed(f);
  const bare = (argv) => {
    const err = [];
    return { code: run(argv, { ...realDeps, cwd: () => f.main, stdout: () => {}, stderr: (s) => err.push(s) }), err: err.join('') };
  };
  assert.equal(bare([]).code, 2);
  assert.equal(bare(['--run', f.runDir]).code, 2, 'needs --records-json or --local');
  assert.equal(bare(['--run', f.runDir, '--records-json', f.records, '--local']).code, 2);
  assert.equal(bare(['--run', f.runDir, '--records-json', f.records, '--group-size-guard', '1']).code, 2);
  assert.equal(bare(['--run', f.runDir, '--records-json', f.records, '--group-size-guard', 'x']).code, 2);
  assert.equal(bare(['--run', f.runDir, '--records-json', f.records, '--bogus']).code, 2);
  assert.equal(bare(['--run', f.runDir, '--unbundle', '../x.md']).code, 2);
  assert.equal(bare(['--help']).code, 0);
  assert.match(USAGE, /--unbundle/);
  const outside = path.join(f.root, 'elsewhere');
  fs.mkdirSync(path.join(outside, 'staged'), { recursive: true });
  assert.equal(bare(['--run', outside, '--records-json', f.records]).code, 3);
  assert.equal(bare(['--run', path.join(f.root, 'missing'), '--records-json', f.records]).code, 3);
});

test('--group-size-guard splits an oversized overlap group', () => {
  const f = fixture();
  for (const n of ['a', 'b', 'c', 'd']) put(f, `leftover-${n}.md`, { title: `Gap ${n}`, files: ['src/a.js'], fp: `fp-${n}` });
  const r = go(f, ['--group-size-guard', '2']);
  assert.equal(r.code, 0, r.err);
  assert.ok(r.json.bundles.every((b) => b.members.length <= 2));
  assert.equal(r.json.bundles.length, 2);
});
