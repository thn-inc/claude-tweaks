// tests/bin-lib/console/backfill-cli.test.js — plugin/bin/console-backfill.js
// (#3950): list / dispose / apply over closed and archived consoles. The CLI
// never calls a model or gh; apply is the only console.json writer, routes each
// entry to the console that lists its item, and re-checks the run is closed.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const { run, USAGE } = require(path.join(ROOT, 'plugin', 'bin', 'console-backfill'));
const { closeRunState } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'hooks', 'close-run-state'));
const { writeRunState } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'hooks', 'context'));
const { stripComments, stripperVerdict } = require('../../helpers/strip-comments');
const { readText } = require('../../helpers/read-skill');

const AT = Date.parse('2026-10-24T12:00:00.000Z');
const SINGLE = '- STAGED 10:00:00 — Reproduction: lens "3c" finding plugin/bin/lib/console/residue.js:40 not reproduced (single agent): the missing split ignores ids that carry a slash. Staged to Review Console as low-confidence. Reversibility: high.';
const NOPATH = '- STAGED 10:01:00 — Step 3 reproduction: a note with no location at all. Staged to Review Console as low-confidence.';
const LOW = 'Low-confidence findings';
const PENDING = (id) => ({ id, section: 'Pending review', resolution: 'pending', reason: 'unmapped-prefix' });
const KEEP = (id) => ({ id, section: LOW, resolution: 'keep-staged', reason: 'unconfirmed finding — never auto-applied' });
const decisionId = (line) => `decision:${line.slice(2, 60)}`;

const tmpDirs = [];
after(() => { for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-backfill-cli-'));
  tmpDirs.push(root);
  execFileSync('git', ['init', '-q', root]);
  const pipelines = path.join(root, '.claude-tweaks', 'pipelines');
  fs.mkdirSync(pipelines, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-backfill-cli-out-'));
  tmpDirs.push(scratch);
  return { root, pipelines, scratch };
}

function closedRun(pipelines, name) {
  const dir = path.join(pipelines, name);
  fs.mkdirSync(dir, { recursive: true });
  assert.strictEqual(closeRunState(dir, { explicit: true }).status, 'closed');
  return dir;
}
function writeConsole(dir, items, extra = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify({ resolved: true, items, ...extra }));
}
function writeDecisions(dir, lines) {
  fs.writeFileSync(path.join(dir, 'decisions.md'), `# Decisions\n\n${lines.join('\n')}\n`);
}
function writeStaged(dir, name, text) {
  fs.mkdirSync(path.join(dir, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'staged', name), text);
}

function call(f, argv, overrides = {}) {
  const out = []; const err = [];
  const code = run(argv, {
    mainRoot: f.root, cwd: () => f.root, now: () => AT, stdout: (s) => out.push(s), stderr: (s) => err.push(s), ...overrides,
  });
  return { code, out: out.join(''), err: err.join('') };
}
const json = (r) => JSON.parse(r.out);

// A closed run holding one staged-kind item (digest) and one pathless no-claim item (digest).
function seedRun(f, name = '2026-10-20T100000-record-1') {
  const dir = closedRun(f.pipelines, name);
  writeConsole(dir, [PENDING('zz-1.md'), KEEP(decisionId(NOPATH))]);
  writeDecisions(dir, [NOPATH]);
  writeStaged(dir, 'zz-1.md', 'zz\n');
  return dir;
}

function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[p] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

function listToFile(f) {
  const out = path.join(f.scratch, 'work-list.json');
  const r = call(f, ['list', '--main-sha', '0000000', '--out', out]);
  assert.strictEqual(r.code, 0, r.err);
  return { out, workList: JSON.parse(fs.readFileSync(out, 'utf8')) };
}

// work list -> dispose -> entries with the refs the procedure would fill in.
function entriesFor(f, workListFile) {
  const verdicts = path.join(f.scratch, 'verdicts.json');
  fs.writeFileSync(verdicts, '{}');
  const outDir = path.join(f.scratch, 'filings');
  const r = call(f, ['dispose', '--work-list', workListFile, '--verdicts', verdicts, '--out-dir', outDir]);
  assert.strictEqual(r.code, 0, r.err);
  return json(r).entries.map((e) => ({ ...e, ref: e.ref === null ? 'https://example.test/c/1' : e.ref }));
}
function writeEntries(f, entries) {
  const file = path.join(f.scratch, 'entries.json');
  fs.writeFileSync(file, JSON.stringify(entries));
  return file;
}

test('AC1.1c: list after a full apply is empty and the console is byte-identical on a second apply', () => {
  const f = fixture();
  const dir = seedRun(f);
  const { out, workList } = listToFile(f);
  assert.strictEqual(workList.runs.flatMap((r) => r.items).length, 2);
  const entriesFile = writeEntries(f, entriesFor(f, out));

  const first = call(f, ['apply', '--entries', entriesFile]);
  assert.strictEqual(first.code, 0, first.err);
  const r1 = json(first);
  assert.strictEqual(r1.applied.length, 2);
  assert.deepStrictEqual(r1.refused, []);
  assert.deepStrictEqual(r1.written, [path.join(dir, 'console.json')]);
  assert.deepStrictEqual(r1.acknowledged, [dir]);

  assert.strictEqual(listToFile(f).workList.runs.flatMap((r) => r.items).length, 0);

  const before = fs.readFileSync(path.join(dir, 'console.json'));
  const second = call(f, ['apply', '--entries', entriesFile]);
  assert.strictEqual(second.code, 0);
  const r2 = json(second);
  assert.deepStrictEqual(r2.applied, []);
  assert.deepStrictEqual(r2.written, []);
  assert.deepStrictEqual(r2.refused.map((x) => x.reason), ['already-settled', 'already-settled']);
  assert.ok(before.equals(fs.readFileSync(path.join(dir, 'console.json'))), 'a second apply left the bytes alone');
});

// The scan the bin-source-scan-conformance skill describes: comments stripped with the shared helper,
// the stripper's verdict checked per file, then the banned tokens counted.
const SPAWN_RE = /child_process|execFile|spawn|fetch\(/g;
const spawnHits = (src) => (stripComments(src).match(SPAWN_RE) || []);

test('AC6.1: the CLI never spawns a process', () => {
  const files = [
    path.join(ROOT, 'plugin', 'bin', 'console-backfill.js'),
    ...['backfill.js', 'backfill-apply.js', 'backfill-dispose.js'].map((n) => path.join(ROOT, 'plugin', 'bin', 'lib', 'console', n)),
  ];
  for (const file of files) {
    const raw = readText(file);
    assert.strictEqual(stripperVerdict(raw), 'ok', `${file}: the comment stripper mis-parsed this file`);
    assert.deepStrictEqual(spawnHits(raw), [], `${file} spawns a process or calls fetch`);
  }
  // Go-red: the matcher sees a spawn in live code, and ignores one in a comment.
  assert.deepStrictEqual(spawnHits("const cp = require('child_process');\n"), ['child_process']);
  assert.deepStrictEqual(spawnHits("// child_process is banned\nconst a = 1;\n"), []);
});

test('list --dry-run writes nothing and prints the four summary lines', () => {
  const f = fixture();
  seedRun(f);
  const live = path.join(f.pipelines, '2026-10-21T100000-record-2');
  fs.mkdirSync(live, { recursive: true });
  writeRunState(live, { status: 'active' });
  writeConsole(live, [PENDING('zz-2.md')]);
  const finding = closedRun(f.pipelines, '2026-10-19T100000-record-3');
  writeConsole(finding, [KEEP(decisionId(SINGLE))]);
  writeDecisions(finding, [SINGLE]);
  const before = snapshot(f.pipelines);

  const r = call(f, ['list', '--dry-run']);
  assert.strictEqual(r.code, 0, r.err);
  const lines = r.out.split('\n');
  assert.ok(lines.includes('runs: 2 (live skipped: 1)'), r.out);
  assert.ok(lines.includes('items: 3 — findings 1, no-claim 1, staged-kind 1'), r.out);
  assert.ok(lines.includes('deterministic: digest 2, dismiss 0, file 0'), r.out);
  assert.ok(lines.includes('tiebreak dispatches: 1; records filed at most: 1'), r.out);
  assert.ok(lines.includes('live runs holding unresolved items (skipped): 1'), r.out);
  assert.ok(r.out.includes('2026-10-21T100000-record-2'), 'the live run holding items is named');
  assert.deepStrictEqual(snapshot(f.pipelines), before);
});

test('list --dry-run names only live runs holding unresolved items, capped at 10 with a remainder', () => {
  const f = fixture();
  seedRun(f);
  const idle = path.join(f.pipelines, '2026-10-21T090000-record-50');
  fs.mkdirSync(idle, { recursive: true });
  writeRunState(idle, { status: 'active' });
  writeConsole(idle, [{ id: 'zz-9.md', section: 'Documentation updates', resolution: 'approve', reason: 'r' }]);
  const bare = path.join(f.pipelines, '2026-10-21T090001-record-51');
  fs.mkdirSync(bare, { recursive: true });
  writeRunState(bare, { status: 'active' });
  for (let n = 0; n < 12; n++) {
    const live = path.join(f.pipelines, `2026-10-22T1000${String(n).padStart(2, '0')}-record-${100 + n}`);
    fs.mkdirSync(live, { recursive: true });
    writeRunState(live, { status: 'active' });
    writeConsole(live, [PENDING('zz-2.md')]);
  }
  const r = call(f, ['list', '--dry-run']);
  assert.strictEqual(r.code, 0, r.err);
  const lines = r.out.split('\n');
  assert.ok(lines.includes('runs: 1 (live skipped: 14)'), r.out);
  assert.ok(lines.includes('live runs holding unresolved items (skipped): 12'), r.out);
  assert.strictEqual(lines.filter((l) => /^ {2}.*record-1\d\d \(active\)$/.test(l)).length, 10);
  assert.ok(lines.includes('  … and 2 more'), r.out);
  assert.ok(!r.out.includes('record-50'), 'a live run with nothing unresolved is not named');
  assert.ok(!r.out.includes('record-51'), 'a live run with no console is not named');
});

test('minor 6: the dry-run live check reads through the injected run-listing seam, so an unlistable live run is named', () => {
  const f = fixture();
  seedRun(f);
  const idle = path.join(f.pipelines, '2026-10-21T090000-record-60');
  fs.mkdirSync(idle, { recursive: true });
  writeRunState(idle, { status: 'active' });
  writeConsole(idle, [{ id: 'zz-9.md', section: 'Documentation updates', resolution: 'approve', reason: 'r' }]);
  const clean = call(f, ['list', '--dry-run']);
  assert.ok(!clean.out.includes('record-60'), 'precondition: a listable idle live run is not named');
  const unlistable = {
    readdirStrict: (p) => {
      if (p === idle) { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; }
      return fs.readdirSync(p);
    },
  };
  const r = call(f, ['list', '--dry-run'], unlistable);
  assert.strictEqual(r.code, 0, r.err);
  assert.ok(r.out.split('\n').includes('live runs holding unresolved items (skipped): 1'), r.out);
  assert.ok(r.out.includes('2026-10-21T090000-record-60 (active)'), r.out);
});

test('list without --dry-run prints the work list, or writes it to --out', () => {
  const f = fixture();
  seedRun(f);
  const printed = json(call(f, ['list', '--main-sha', 'abc1234']));
  assert.strictEqual(printed.mainSha, 'abc1234');
  assert.strictEqual(printed.runs.flatMap((r) => r.items).length, 2);
  const { out, workList } = listToFile(f);
  assert.deepStrictEqual(workList.runs, printed.runs);
  assert.ok(fs.existsSync(out));
});

test('apply refuses a runDir outside the pipelines root', () => {
  const f = fixture();
  seedRun(f);
  const stray = path.join(f.scratch, '2026-10-20T100000-record-9');
  writeConsole(stray, [PENDING('zz-1.md')]);
  const bytes = fs.readFileSync(path.join(stray, 'console.json'));
  const entries = writeEntries(f, [{ runDir: stray, itemId: 'bf:x', itemHash: 'h', outcome: 'digested', source: 'digest', ref: 'r' }]);
  const r = call(f, ['apply', '--entries', entries]);
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(json(r).refused, [{ itemId: 'bf:x', reason: 'run-not-anchored' }]);
  assert.match(r.err, /run-not-anchored/);
  assert.ok(bytes.equals(fs.readFileSync(path.join(stray, 'console.json'))));
});

test('apply refuses an entry for a live run', () => {
  const f = fixture();
  const liveDir = path.join(f.pipelines, '2026-10-21T100000-record-2');
  fs.mkdirSync(liveDir, { recursive: true });
  writeRunState(liveDir, { status: 'active' });
  writeConsole(liveDir, [PENDING('zz-2.md')]);
  writeStaged(liveDir, 'zz-2.md', 'zz\n');
  const bytes = fs.readFileSync(path.join(liveDir, 'console.json'));
  const entries = writeEntries(f, [{ runDir: liveDir, itemId: 'bf:x', itemHash: 'h', outcome: 'digested', source: 'digest', ref: 'r' }]);
  const r = call(f, ['apply', '--entries', entries]);
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(json(r).refused, [{ itemId: 'bf:x', reason: 'run-live' }]);
  assert.match(r.err, /run-live/);
  assert.ok(bytes.equals(fs.readFileSync(path.join(liveDir, 'console.json'))));
});

test('apply --dry-run writes nothing', () => {
  const f = fixture();
  seedRun(f);
  const { out } = listToFile(f);
  const entries = writeEntries(f, entriesFor(f, out));
  const before = snapshot(f.pipelines);
  const r = call(f, ['apply', '--entries', entries, '--dry-run']);
  assert.strictEqual(r.code, 0, r.err);
  const result = json(r);
  assert.strictEqual(result.applied.length, 2);
  assert.deepStrictEqual(result.written, []);
  assert.strictEqual(result.acknowledged.length, 1, 'the dry run reports what a real apply would acknowledge');
  assert.deepStrictEqual(snapshot(f.pipelines), before);
});

test('apply routes each entry to the console that lists its item, never by runDir alone', () => {
  const f = fixture();
  const runDir = closedRun(f.pipelines, '2026-10-20T100000-spec-3-4');
  writeConsole(runDir, [PENDING('zz-0.md')]);
  writeStaged(runDir, 'zz-0.md', 'zz\n');
  for (const n of ['spec-3', 'spec-4']) {
    const sub = path.join(runDir, n);
    writeConsole(sub, [PENDING(`zz-${n}.md`)]);
    writeStaged(sub, `zz-${n}.md`, 'zz\n');
  }
  const { workList } = listToFile(f);
  const items = workList.runs.flatMap((r) => r.items);
  assert.strictEqual(items.length, 3);
  // Settle only the spec-4 item: its console is the only one rewritten.
  const spec4 = items.find((i) => i.consoleDir === path.join(runDir, 'spec-4'));
  const entries = writeEntries(f, [{ runDir, itemId: spec4.itemId, itemHash: spec4.itemHash, outcome: 'digested', source: 'digest', ref: 'r' }]);
  const rootBytes = fs.readFileSync(path.join(runDir, 'console.json'));
  const spec3Bytes = fs.readFileSync(path.join(runDir, 'spec-3', 'console.json'));
  const r = call(f, ['apply', '--entries', entries]);
  assert.strictEqual(r.code, 0, r.err);
  const result = json(r);
  assert.deepStrictEqual(result.applied, [spec4.itemId]);
  assert.deepStrictEqual(result.written, [path.join(runDir, 'spec-4', 'console.json')]);
  assert.ok(rootBytes.equals(fs.readFileSync(path.join(runDir, 'console.json'))));
  assert.ok(spec3Bytes.equals(fs.readFileSync(path.join(runDir, 'spec-3', 'console.json'))));
});

test('apply refuses an item no console of the run lists, as unknown-item', () => {
  const f = fixture();
  const dir = seedRun(f);
  const entries = writeEntries(f, [{ runDir: dir, itemId: 'bf:nope', itemHash: 'h', outcome: 'digested', source: 'digest', ref: 'r' }]);
  const r = call(f, ['apply', '--entries', entries]);
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(json(r).refused, [{ itemId: 'bf:nope', reason: 'unknown-item' }]);
});

test('apply refuses a run that is neither closed nor live, as run-not-closed', () => {
  const f = fixture();
  const name = '2026-10-20T100000-record-1';
  // A top-level copy whose archive twin is clean: the listing walks the twin, never this copy.
  const top = closedRun(f.pipelines, name);
  writeConsole(top, [PENDING('zz-1.md')]);
  const twin = path.join(f.pipelines, 'archive', name);
  fs.mkdirSync(twin, { recursive: true });
  assert.strictEqual(closeRunState(twin, { explicit: true }).status, 'closed');
  const gone = path.join(f.pipelines, '2026-10-20T120000-record-7');
  const bytes = fs.readFileSync(path.join(top, 'console.json'));
  const entry = (runDir, itemId) => ({ runDir, itemId, itemHash: 'h', outcome: 'digested', source: 'digest', ref: 'r' });
  const r = call(f, ['apply', '--entries', writeEntries(f, [entry(top, 'bf:a'), entry(gone, 'bf:b')])]);
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(json(r).refused, [{ itemId: 'bf:a', reason: 'run-not-closed' }, { itemId: 'bf:b', reason: 'run-not-closed' }]);
  assert.ok(bytes.equals(fs.readFileSync(path.join(top, 'console.json'))));
});

test('apply refuses an entry as console-unreadable when its run has a console it cannot read', () => {
  const f = fixture();
  const dir = closedRun(f.pipelines, '2026-10-20T100000-record-1');
  fs.writeFileSync(path.join(dir, 'console.json'), '{not json');
  const bytes = fs.readFileSync(path.join(dir, 'console.json'));
  const entries = writeEntries(f, [{ runDir: dir, itemId: 'bf:a', itemHash: 'h', outcome: 'digested', source: 'digest', ref: 'r' }]);
  const r = call(f, ['apply', '--entries', entries]);
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(json(r).refused, [{ itemId: 'bf:a', reason: 'console-unreadable' }]);
  assert.match(r.err, /console-unreadable/);
  assert.ok(bytes.equals(fs.readFileSync(path.join(dir, 'console.json'))));
});

test('a run dir that cannot be listed is unreadable: named by list, refused by apply', () => {
  const f = fixture();
  const dir = seedRun(f);
  const vanished = { readdirStrict: (p) => { const e = new Error('ENOENT: no such file or directory'); e.code = 'ENOENT'; throw e; } };

  const listed = json(call(f, ['list', '--main-sha', 'abc'], vanished));
  assert.deepStrictEqual(listed.unreadable, [dir]);
  assert.deepStrictEqual(listed.runs, []);

  const bytes = fs.readFileSync(path.join(dir, 'console.json'));
  const entries = writeEntries(f, [{ runDir: dir, itemId: 'bf:a', itemHash: 'h', outcome: 'digested', source: 'digest', ref: 'r' }]);
  const r = call(f, ['apply', '--entries', entries], vanished);
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(json(r).refused, [{ itemId: 'bf:a', reason: 'console-unreadable' }]);
  assert.ok(bytes.equals(fs.readFileSync(path.join(dir, 'console.json'))));
});

test('apply accepts planBatch\'s result shape: an object with an `entries` array', () => {
  const f = fixture();
  seedRun(f);
  const { out } = listToFile(f);
  const entries = writeEntries(f, { entries: entriesFor(f, out), awaitingVerdict: [] });
  const r = call(f, ['apply', '--entries', entries]);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(json(r).applied.length, 2);
  assert.deepStrictEqual(json(r).refused, []);
});

test('apply works on an archived run', () => {
  const f = fixture();
  const name = '2026-10-20T100000-record-1';
  const dir = path.join(f.pipelines, 'archive', name);
  writeConsole(dir, [PENDING('zz-1.md')]);
  writeStaged(dir, 'zz-1.md', 'zz\n');
  const { out } = listToFile(f);
  const r = call(f, ['apply', '--entries', writeEntries(f, entriesFor(f, out))]);
  assert.strictEqual(r.code, 0, r.err);
  assert.deepStrictEqual(json(r).written, [path.join(dir, 'console.json')]);
});

test('dispose writes each new filing to out-dir, prints its path, and lists the findings still awaiting a verdict', () => {
  const f = fixture();
  const dir = closedRun(f.pipelines, '2026-10-20T100000-record-1');
  writeConsole(dir, [KEEP(decisionId(SINGLE))]);
  writeDecisions(dir, [SINGLE]);
  const { out, workList } = listToFile(f);
  const [item] = workList.runs.flatMap((r) => r.items);
  const outDir = path.join(f.scratch, 'filings');
  const verdicts = path.join(f.scratch, 'verdicts.json');

  fs.writeFileSync(verdicts, '{}');
  const waiting = json(call(f, ['dispose', '--work-list', out, '--verdicts', verdicts, '--out-dir', outDir]));
  assert.deepStrictEqual(waiting.awaitingVerdict, [item.itemId]);
  assert.deepStrictEqual(waiting.file, []);

  fs.writeFileSync(verdicts, JSON.stringify({ [item.itemId]: { outcome: 'console', severity: 'medium', reason: 'cannot tell', recommendation: 'file' } }));
  const r = call(f, ['dispose', '--work-list', out, '--verdicts', verdicts, '--out-dir', outDir]);
  assert.strictEqual(r.code, 0, r.err);
  const planned = json(r);
  assert.strictEqual(planned.file.length, 1);
  const expectedPath = path.join(outDir, `backfill-filing-${item.itemId.replace(/^bf:/, '')}.md`);
  assert.strictEqual(planned.file[0].path, expectedPath, 'named by the item, not by position');
  assert.strictEqual(planned.file[0].text, undefined, 'the entry carries the path and no proposal body');
  const body = fs.readFileSync(expectedPath, 'utf8');
  assert.ok(body.includes('the missing split ignores ids that carry a slash'), 'the written file holds the proposal body');
  assert.deepStrictEqual(planned.awaitingVerdict, []);
  assert.strictEqual(planned.entries[0].itemId, item.itemId);
  // No proposal body anywhere in stdout: a disposition keeps its fingerprint and title, plus the path.
  // The title carries the claim by design; every other substantial body line must be absent.
  const bodyOnly = body.split('\n').map((l) => l.trim()).filter((l) => l.length > 20 && !planned.file[0].title.includes(l));
  assert.ok(bodyOnly.length >= 3, 'the proposal has body lines of its own to look for');
  for (const l of bodyOnly) assert.ok(!r.out.includes(JSON.stringify(l).slice(1, -1)), `body line leaked into stdout: ${l}`);
  assert.ok(!r.out.includes('## '), 'no markdown body in stdout');
  assert.strictEqual(planned.dispositions[0].proposal.text, undefined);
  assert.strictEqual(planned.dispositions[0].proposal.path, expectedPath);
  assert.strictEqual(planned.dispositions[0].proposal.title, planned.file[0].title);
  assert.strictEqual(planned.dispositions[0].proposal.fingerprint, planned.file[0].fingerprint);

  const limited = json(call(f, ['dispose', '--work-list', out, '--verdicts', verdicts, '--out-dir', outDir, '--limit', '0']));
  assert.strictEqual(limited.dispositions.length, 0);
});

test('dispose batches into one --out-dir never overwrite each other', () => {
  const f = fixture();
  const other = '- STAGED 10:02:00 — Reproduction: lens "3c" finding plugin/bin/lib/console/alpha.js:10 not reproduced (single agent): the alpha reader drops a trailing newline. Staged to Review Console as low-confidence.';
  for (const [name, line] of [['2026-10-20T100000-record-1', SINGLE], ['2026-10-20T110000-record-2', other]]) {
    const dir = closedRun(f.pipelines, name);
    writeConsole(dir, [KEEP(decisionId(line))]);
    writeDecisions(dir, [line]);
  }
  const { out, workList } = listToFile(f);
  const [a, b] = workList.runs.flatMap((r) => r.items).map((i) => i.itemId);
  const outDir = path.join(f.scratch, 'filings');
  const verdict = { outcome: 'console', severity: 'medium', reason: 'cannot tell', recommendation: 'file' };
  const batch = (id) => {
    const verdicts = path.join(f.scratch, `verdicts-${id.slice(3)}.json`);
    fs.writeFileSync(verdicts, JSON.stringify({ [id]: verdict }));
    const r = call(f, ['dispose', '--work-list', out, '--verdicts', verdicts, '--out-dir', outDir]);
    assert.strictEqual(r.code, 0, r.err);
    return json(r).file.map((x) => x.path);
  };
  const first = batch(a);
  const second = batch(b);
  assert.strictEqual(first.length, 1);
  assert.strictEqual(second.length, 1);
  assert.notStrictEqual(first[0], second[0]);
  assert.ok(fs.existsSync(first[0]) && fs.existsSync(second[0]), 'the first batch\'s file survives the second');
});

test('--help prints the usage and exits 0, reading nothing', () => {
  const f = fixture();
  const r = call(f, ['apply', '--entries', '/does/not/exist.json', '--help'], { mainRoot: path.join(f.root, 'missing') });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.out, USAGE);
  assert.strictEqual(call(f, ['-h']).out, USAGE);
});

test('exit 2 on an unknown subcommand, on list without --main-sha or --dry-run, on unparseable --entries', () => {
  const f = fixture();
  seedRun(f);
  assert.strictEqual(call(f, ['frobnicate']).code, 2);
  assert.strictEqual(call(f, []).code, 2);
  assert.strictEqual(call(f, ['list']).code, 2);
  assert.strictEqual(call(f, ['list', '--dry-run', '--out', 'x.json']).code, 2);
  assert.strictEqual(call(f, ['list', '--dry-run', '--bogus']).code, 2);
  assert.strictEqual(call(f, ['apply']).code, 2);
  const bad = path.join(f.scratch, 'bad.json');
  fs.writeFileSync(bad, '{not json');
  const r = call(f, ['apply', '--entries', bad]);
  assert.strictEqual(r.code, 2);
  assert.match(r.err, /console-backfill\.js/);
  fs.writeFileSync(bad, '{"notEntries": 1}');
  assert.strictEqual(call(f, ['apply', '--entries', bad]).code, 2);
  assert.strictEqual(call(f, ['dispose', '--work-list', bad, '--verdicts', bad, '--out-dir', f.scratch]).code, 2);
  assert.strictEqual(call(f, ['dispose', '--work-list', bad, '--verdicts', bad, '--out-dir', f.scratch, '--limit', 'many']).code, 2);
});

test('exit 3 when the pipelines root is missing, or an --out or --out-dir cannot be written', () => {
  const f = fixture();
  const none = { mainRoot: path.join(f.root, 'nowhere') };
  assert.strictEqual(call(f, ['list', '--dry-run'], none).code, 3);
  assert.strictEqual(call(f, ['list', '--main-sha', 'abc'], none).code, 3);
  const entries = writeEntries(f, []);
  assert.strictEqual(call(f, ['apply', '--entries', entries], none).code, 3);

  seedRun(f);
  const blocker = path.join(f.scratch, 'blocker');
  fs.writeFileSync(blocker, 'a file, not a directory');
  assert.strictEqual(call(f, ['list', '--main-sha', 'abc', '--out', path.join(blocker, 'x.json')]).code, 3);
  const verdicts = path.join(f.scratch, 'v.json');
  const dir = closedRun(f.pipelines, '2026-10-19T100000-record-3');
  writeConsole(dir, [KEEP(decisionId(SINGLE))]);
  writeDecisions(dir, [SINGLE]);
  const withFinding = listToFile(f);
  const [finding] = withFinding.workList.runs.flatMap((r) => r.items).filter((i) => i.kind === 'finding');
  fs.writeFileSync(verdicts, JSON.stringify({ [finding.itemId]: { outcome: 'console', severity: 'medium', reason: 'r', recommendation: 'file' } }));
  const r = call(f, ['dispose', '--work-list', withFinding.out, '--verdicts', verdicts, '--out-dir', path.join(blocker, 'sub')]);
  assert.strictEqual(r.code, 3);
});

test('exit 3 when a console.json cannot be written; the entries are refused as write-failed, not applied', () => {
  const f = fixture();
  const dir = seedRun(f);
  const { out } = listToFile(f);
  const entries = writeEntries(f, entriesFor(f, out));
  const r = call(f, ['apply', '--entries', entries], { writeFile: () => { throw new Error('EACCES'); } });
  assert.strictEqual(r.code, 3);
  const result = json(r);
  assert.deepStrictEqual(result.applied, []);
  assert.deepStrictEqual(result.written, []);
  assert.ok(result.refused.every((x) => x.reason === 'write-failed'));
  assert.match(r.err, /EACCES/);
  assert.ok(fs.existsSync(path.join(dir, 'console.json')));
});
