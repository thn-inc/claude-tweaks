'use strict';
// tests/bin-lib/wrap-up/engine-cli.test.js — exercises bin/wrap-up-engine.js
// end to end: `plan` against a real fixture git repo (same builder shape as
// facts.test.js), `record` reading a payload off stdin, and `render`
// including the --strict completeness gate. Spawns the CLI as a real child
// process (execFileSync) so exit codes are asserted the way a caller would
// actually observe them, not by calling internals in-process.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'wrap-up-engine.js');

let repoDir;
let baseSha;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function run(args, { cwd, input } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: cwd || repoDir,
      input: input !== undefined ? input : undefined,
      encoding: 'utf8',
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return { status: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

before(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapup-engine-cli-'));
  git(['init', '-q'], repoDir);
  git(['config', 'user.email', 'test@example.com'], repoDir);
  git(['config', 'user.name', 'Test'], repoDir);

  fs.writeFileSync(
    path.join(repoDir, 'CLAUDE.md'),
    ['# Test project', '', '## Commands', '', 'npm run oldcmd', 'npm test', '', '## Other', '', 'irrelevant', ''].join('\n'),
  );
  fs.mkdirSync(path.join(repoDir, 'docs', 'journeys'), { recursive: true });
  fs.writeFileSync(
    path.join(repoDir, 'docs', 'journeys', 'j1.md'),
    ['---', 'title: Journey 1', 'files:', '  - src-a.js', '  - src-b.js', '---', '', '# Journey 1', ''].join('\n'),
  );
  fs.mkdirSync(path.join(repoDir, '.claude', 'skills'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, '.claude', 'skills', 's1.md'), '# Skill 1\n');
  fs.writeFileSync(path.join(repoDir, 'docs', 'guide.md'), '# Guide\n');

  git(['add', '.'], repoDir);
  git(['commit', '-q', '-m', 'base'], repoDir);
  baseSha = git(['rev-parse', 'HEAD'], repoDir);

  // Second commit: rename a file (renamedOrDeleted), change CLAUDE.md's
  // Commands section (claudeMdCommandRenamed), and touch 2 new files that
  // overlap j1.md's `files:` list (multiFileDiff + a frontmatter-overlap
  // candidate for the journeys row).
  git(['mv', 'docs/guide.md', 'docs/guide2.md'], repoDir);
  fs.writeFileSync(
    path.join(repoDir, 'CLAUDE.md'),
    ['# Test project', '', '## Commands', '', 'npm test', '', '## Other', '', 'irrelevant', ''].join('\n'),
  );
  fs.writeFileSync(path.join(repoDir, 'src-a.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(repoDir, 'src-b.js'), 'module.exports = 2;\n');
  git(['add', '.'], repoDir);
  git(['commit', '-q', '-m', 'second'], repoDir);
});

after(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

// #790/[IL-127]: wrap-up-engine.js now rejects a --run-dir that doesn't
// resolve under the main checkout (bin/lib/hooks/worktree-detect.js's
// isAnchoredUnderRoot). repoDir is that main checkout (git-init'd in
// before()), so run dirs must nest under it — a bare os.tmpdir() sibling no
// longer anchors, mirroring real usage where run dirs always live at
// <main>/.claude-tweaks/pipelines/...
function makeRunDir() {
  return fs.mkdtempSync(path.join(repoDir, 'wrapup-engine-rundir-'));
}

function readState(runDir) {
  return JSON.parse(fs.readFileSync(path.join(runDir, 'engine-state.json'), 'utf8'));
}

// Records a 'clean' payload for every open row in runDir's worklist — the
// "finish recording so --strict is satisfied" step shared by several render
// tests below. Returns the open rows recorded.
function recordAllOpenRowsClean(runDir) {
  const openRows = readState(runDir).worklist.rows.filter((row) => row.gate === 'open');
  for (const row of openRows) {
    const payload = JSON.stringify({
      version: 1, rowId: row.id, result: 'clean', read: [], findings: [], gapDetection: 'not-run', detail: 'nothing to change',
    });
    const rr = run(['record', '--run-dir', runDir, '--dry-run'], { input: payload });
    assert.strictEqual(rr.status, 0, rr.stderr);
  }
  return openRows;
}

// ---- plan -----------------------------------------------------------------

test('plan writes engine-state.json and prints parseable worklist JSON with 8 rows', () => {
  const runDir = makeRunDir();
  const r = run(['plan', '--run-dir', runDir, '--base', baseSha, '--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);

  const worklist = JSON.parse(r.stdout);
  assert.strictEqual(worklist.rows.length, 8);

  assert.ok(fs.existsSync(path.join(runDir, 'engine-state.json')));
  const state = readState(runDir);
  assert.strictEqual(state.worklist.rows.length, 8);
});

test('plan resolves the journeys row scope from frontmatter file overlap', () => {
  const runDir = makeRunDir();
  const r = run(['plan', '--run-dir', runDir, '--base', baseSha, '--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);
  const worklist = JSON.parse(r.stdout);
  const journeysRow = worklist.rows.find((row) => row.id === 'journeys');
  assert.strictEqual(journeysRow.gate, 'open');
  assert.deepStrictEqual(journeysRow.scope.candidates, ['docs/journeys/j1.md']);
});

test('plan --signals with malformed JSON exits 2 with a stderr reason', () => {
  const runDir = makeRunDir();
  const r = run(['plan', '--run-dir', runDir, '--base', baseSha, '--signals', '{not-json', '--dry-run']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /--signals is not valid JSON/);
  assert.strictEqual(r.stdout, '');
});

test('plan without --base or --run-dir exits 2 with usage on stderr', () => {
  const r1 = run(['plan', '--base', baseSha]);
  assert.strictEqual(r1.status, 2);
  assert.match(r1.stderr, /usage: wrap-up-engine\.js/);

  const r2 = run(['plan', '--run-dir', makeRunDir()]);
  assert.strictEqual(r2.status, 2);
  assert.match(r2.stderr, /usage: wrap-up-engine\.js/);
});

test('plan without --dry-run appends telemetry under the resolved repo root', () => {
  // In this fixture, repoDir is a normal (non-worktree) checkout, so
  // `git rev-parse --git-common-dir`'s parent resolves to repoDir itself.
  const runDir = makeRunDir();
  const telemetryPath = path.join(repoDir, '.claude-tweaks', 'wrap-up-outcomes.tsv');
  assert.strictEqual(fs.existsSync(telemetryPath), false);

  const r = run(['plan', '--run-dir', runDir, '--base', baseSha]);
  assert.strictEqual(r.status, 0, r.stderr);

  assert.ok(fs.existsSync(telemetryPath));
  const tsv = fs.readFileSync(telemetryPath, 'utf8');
  assert.ok(tsv.length > 0);
});

// ---- record -----------------------------------------------------------

function planFreshRunDir() {
  const runDir = makeRunDir();
  const r = run(['plan', '--run-dir', runDir, '--base', baseSha, '--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);
  return runDir;
}

test('record with a valid payload on stdin appends a SCANNED line, prints it, and exits 0', () => {
  const runDir = planFreshRunDir();
  const before = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8').trim().split('\n').length;

  const payload = JSON.stringify({
    version: 1, rowId: 'skills', result: 'clean',
    read: [{ path: '.claude/skills/s1.md', mode: 'full' }],
    findings: [], gapDetection: 'run', detail: 'nothing to change',
  });
  const r = run(['record', '--run-dir', runDir, '--dry-run'], { input: payload });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^SCANNED .* — Skills: gate open/);

  const after = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8').trim().split('\n');
  assert.strictEqual(after.length, before + 1);

  const state = readState(runDir);
  assert.strictEqual(state.results.skills.result, 'clean');
});

test('record with garbage stdin exits 1 (not 0, not 2) with a reason on stderr', () => {
  const runDir = planFreshRunDir();
  const r = run(['record', '--run-dir', runDir, '--dry-run'], { input: '{not-json' });
  assert.strictEqual(r.status, 1);
  assert.notStrictEqual(r.status, 0);
  assert.notStrictEqual(r.status, 2);
  assert.match(r.stderr, /not valid JSON/);
  assert.strictEqual(r.stdout, '');
});

test('record without --run-dir exits 2', () => {
  const payload = JSON.stringify({ version: 1, rowId: 'skills', result: 'clean', gapDetection: 'run' });
  const r = run(['record'], { input: payload });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: wrap-up-engine\.js/);
});

test('record against a run dir with no engine-state.json exits 2 (not 1, not 0), naming engine-state.json', () => {
  const runDir = makeRunDir(); // never plan'd — no engine-state.json
  const payload = JSON.stringify({ version: 1, rowId: 'skills', result: 'clean', gapDetection: 'run' });
  const r = run(['record', '--run-dir', runDir, '--dry-run'], { input: payload });
  assert.strictEqual(r.status, 2);
  assert.notStrictEqual(r.status, 1);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /engine-state\.json/);
  assert.strictEqual(r.stdout, '');
});

test('record rejects a payload that fails engine-record validation with exit 1', () => {
  const runDir = planFreshRunDir();
  const payload = JSON.stringify({ version: 1, rowId: 'skills', result: 'bogus', gapDetection: 'run' });
  const r = run(['record', '--run-dir', runDir, '--dry-run'], { input: payload });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /result/);
});

// --- #2546: record --batch <file> ---

function writeBatchFile(entries) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wrapup-batch-')), 'batch.json');
  fs.writeFileSync(file, JSON.stringify(entries));
  return file;
}

test('record --batch records every entry in one invocation, verified by re-reading the resulting records', () => {
  const runDir = planFreshRunDir();
  const openRows = readState(runDir).worklist.rows.filter((row) => row.gate === 'open');
  const entries = openRows.map((row) => ({
    version: 1, rowId: row.id, result: 'clean', read: [], findings: [], gapDetection: 'not-run', detail: 'batched',
  }));
  const batchFile = writeBatchFile(entries);

  const r = run(['record', '--run-dir', runDir, '--batch', batchFile, '--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);
  // One SCANNED line printed per entry, in order.
  const printedLines = r.stdout.trim().split('\n');
  assert.strictEqual(printedLines.length, entries.length);
  for (const line of printedLines) assert.match(line, /^SCANNED /);

  // plan() pre-resolves every CLOSED row to n/a before the model reads
  // anything (curation-engine.md section 1) — results already holds those
  // before this batch runs, so the count check is scoped to the open rows
  // this batch actually recorded, not the full results map.
  const state = readState(runDir);
  for (const row of openRows) {
    assert.ok(Object.prototype.hasOwnProperty.call(state.results, row.id), `row ${row.id} should be recorded`);
    assert.strictEqual(state.results[row.id].detail, 'batched');
  }
});

test('record --batch with a non-array JSON file exits 1 with a clear message, not a crash', () => {
  const runDir = planFreshRunDir();
  const batchFile = writeBatchFile({ not: 'an array' });
  const r = run(['record', '--run-dir', runDir, '--batch', batchFile, '--dry-run']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /non-empty JSON array/);
});

test('record --batch with an empty array exits 1', () => {
  const runDir = planFreshRunDir();
  const batchFile = writeBatchFile([]);
  const r = run(['record', '--run-dir', runDir, '--batch', batchFile, '--dry-run']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /non-empty JSON array/);
});

test('record --batch pointing at a nonexistent file exits 1 naming the path, not a stack trace', () => {
  const runDir = planFreshRunDir();
  const r = run(['record', '--run-dir', runDir, '--batch', '/nonexistent/batch.json', '--dry-run']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /could not read \/nonexistent\/batch\.json/);
});

test('record --batch with malformed JSON content exits 1 naming the parse failure', () => {
  const runDir = planFreshRunDir();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapup-batch-bad-'));
  const file = path.join(dir, 'batch.json');
  fs.writeFileSync(file, 'not json');
  const r = run(['record', '--run-dir', runDir, '--batch', file, '--dry-run']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /not valid JSON/);
});

test('record --batch stops at the first failing entry, naming its index — entries before it stay recorded', () => {
  const runDir = planFreshRunDir();
  const openRows = readState(runDir).worklist.rows.filter((row) => row.gate === 'open');
  assert.ok(openRows.length >= 2, 'fixture needs at least 2 open rows for this test');
  const entries = [
    { version: 1, rowId: openRows[0].id, result: 'clean', read: [], findings: [], gapDetection: 'not-run', detail: 'ok' },
    { version: 1, rowId: openRows[1].id, result: 'bogus', gapDetection: 'not-run' }, // invalid result
  ];
  const batchFile = writeBatchFile(entries);

  const r = run(['record', '--run-dir', runDir, '--batch', batchFile, '--dry-run']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /entry 1 \(of 2\) failed/);

  const state = readState(runDir);
  assert.ok(Object.prototype.hasOwnProperty.call(state.results, openRows[0].id), 'entry 0 should still be recorded despite entry 1 failing');
  assert.ok(!Object.prototype.hasOwnProperty.call(state.results, openRows[1].id), 'entry 1 itself should not be recorded');
});

test('record --batch against a run dir with no engine-state.json exits 2, same precondition as single-payload record', () => {
  const runDir = makeRunDir();
  const batchFile = writeBatchFile([{ version: 1, rowId: 'skills', result: 'clean', read: [], findings: [], gapDetection: 'not-run', detail: 'x' }]);
  const r = run(['record', '--run-dir', runDir, '--batch', batchFile, '--dry-run']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /engine-state\.json/);
});

// ---- render -----------------------------------------------------------

test('render --section trace contains the pinned header row', () => {
  const runDir = planFreshRunDir();
  const r = run(['render', '--run-dir', runDir, '--section', 'trace']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| Target \| Result \| Detail \|/);
});

test('render defaults to the trace section when --section is omitted', () => {
  const runDir = planFreshRunDir();
  const r = run(['render', '--run-dir', runDir]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\| Target \| Result \| Detail \|/);
});

test('render --strict exits 2 while open rows are unrecorded, and 0 once all are recorded', () => {
  const runDir = planFreshRunDir();

  const strictBefore = run(['render', '--run-dir', runDir, '--strict']);
  assert.strictEqual(strictBefore.status, 2);
  // Printed BEFORE the fatal exit — the hole is visible, not just fatal.
  assert.match(strictBefore.stdout, /\| Target \| Result \| Detail \|/);

  const openRows = recordAllOpenRowsClean(runDir);
  assert.ok(openRows.length > 0, 'fixture must have at least one open row');

  const strictAfter = run(['render', '--run-dir', runDir, '--strict']);
  assert.strictEqual(strictAfter.status, 0, strictAfter.stderr);
});

test('render --section console with two --spec-state flags prints one merged table and exits 0', () => {
  const runDirA = planFreshRunDir();
  const runDirB = planFreshRunDir();

  // Record a skills finding into runDirA so the merged output has content.
  const payload = JSON.stringify({
    version: 1, rowId: 'skills', result: 'findings',
    findings: [{ kind: 'additive', summary: 'Add row', targetPath: '.claude/skills/s1.md', action: 'applied', stagePath: null, commit: 'abc1234' }],
    gapDetection: 'run', detail: '1 change',
  });
  const rec = run(['record', '--run-dir', runDirA, '--dry-run'], { input: payload });
  assert.strictEqual(rec.status, 0, rec.stderr);

  const stateAPath = path.join(runDirA, 'engine-state.json');
  const stateBPath = path.join(runDirB, 'engine-state.json');

  const r = run(['render', '--section', 'console', '--spec-state', `157=${stateAPath}`, '--spec-state', `159=${stateBPath}`, '--start-at', '1']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\| # \| Spec \| Target \| Change \| Disposition \|$/m);
  assert.match(r.stdout, /^\| 1 \| 157 \|/m);
});

test('render --section console with --spec-state AND --run-dir exits 2 with usage on stderr', () => {
  const runDir = planFreshRunDir();
  const r = run(['render', '--run-dir', runDir, '--section', 'console', '--spec-state', `157=${path.join(runDir, 'engine-state.json')}`]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: wrap-up-engine\.js/);
});

test('render --section trace with --spec-state exits 2 with usage on stderr', () => {
  const runDir = planFreshRunDir();
  const r = run(['render', '--section', 'trace', '--spec-state', `157=${path.join(runDir, 'engine-state.json')}`]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: wrap-up-engine\.js/);
});

test('render --spec-state with a nonexistent path exits 2 naming the failing path, not a stack trace', () => {
  const r = run(['render', '--section', 'console', '--spec-state', '157=/nonexistent/path.json']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /157=\/nonexistent\/path\.json|\/nonexistent\/path\.json/);
  assert.doesNotMatch(r.stderr, /at Object\.<anonymous>/); // not a raw Node stack trace
});

test('render --spec-state with invalid JSON content exits 2 naming the failing path', () => {
  const badPath = path.join(makeRunDir(), 'bad.json');
  fs.writeFileSync(badPath, '{not-json');
  const r = run(['render', '--section', 'console', '--spec-state', `157=${badPath}`]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, new RegExp(badPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('render --spec-state pointing at a file containing literal null exits 2 with a clean message, not a raw stack trace', () => {
  const nullPath = path.join(makeRunDir(), 'null-state.json');
  fs.writeFileSync(nullPath, 'null');
  const r = run(['render', '--section', 'console', '--spec-state', `157=${nullPath}`]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /could not read spec state from/);
  assert.match(r.stderr, new RegExp(nullPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(r.stderr, /at Object\.<anonymous>/); // not a raw Node stack trace
  assert.strictEqual(r.stdout, '');
});

test('render --spec-state value with no "=" exits 2 with usage on stderr', () => {
  const r = run(['render', '--section', 'console', '--spec-state', '157']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: wrap-up-engine\.js/);
});

test('render --section console --spec-state --strict prints the merged table then exits 2 while any given state is incomplete', () => {
  const runDirA = planFreshRunDir(); // partially recorded below -> still incomplete
  const runDirB = planFreshRunDir();

  // Record exactly one 'findings' row in runDirA, leaving its other rows
  // unrecorded (incomplete) -> merged table has real content to print.
  const worklistA = JSON.parse(fs.readFileSync(path.join(runDirA, 'engine-state.json'), 'utf8')).worklist;
  const firstRowA = worklistA.rows[0];
  const findingsPayload = JSON.stringify({
    version: 1, rowId: firstRowA.id, result: 'findings',
    findings: [{ kind: 'additive', summary: 'Strict test row', targetPath: 'x.md', action: 'applied', stagePath: null, commit: 'ddd4444' }],
    gapDetection: 'run', detail: '1 change',
  });
  const rec = run(['record', '--run-dir', runDirA, '--dry-run'], { input: findingsPayload });
  assert.strictEqual(rec.status, 0, rec.stderr);

  // Fully record runDirB so only runDirA is incomplete.
  recordAllOpenRowsClean(runDirB);

  const r = run(['render', '--section', 'console', '--strict',
    '--spec-state', `157=${path.join(runDirA, 'engine-state.json')}`,
    '--spec-state', `159=${path.join(runDirB, 'engine-state.json')}`]);
  assert.strictEqual(r.status, 2);
  // Printed before the fatal exit, mirroring the single-state --strict behavior.
  assert.match(r.stdout, /Strict test row/);
  // Names the specific incomplete spec (157), not just "something's missing" —
  // and does not falsely implicate the fully-recorded spec (159).
  assert.match(r.stderr, /spec 157 incomplete/);
  assert.doesNotMatch(r.stderr, /spec 159 incomplete/);
});

test('render --section console --spec-state --strict exits 0 once every given state is complete', () => {
  const runDirA = planFreshRunDir();
  const runDirB = planFreshRunDir();
  for (const runDir of [runDirA, runDirB]) {
    recordAllOpenRowsClean(runDir);
  }
  const r = run(['render', '--section', 'console', '--strict',
    '--spec-state', `157=${path.join(runDirA, 'engine-state.json')}`,
    '--spec-state', `159=${path.join(runDirB, 'engine-state.json')}`]);
  assert.strictEqual(r.status, 0, r.stderr);
});

test('render without --run-dir exits 2', () => {
  const r = run(['render']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: wrap-up-engine\.js/);
});

test('render against a run dir with no engine-state.json exits 2', () => {
  const runDir = makeRunDir();
  const r = run(['render', '--run-dir', runDir]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /engine-state\.json/);
});

test('unknown verb exits 2 with usage', () => {
  const r = run(['bogus-verb']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: wrap-up-engine\.js/);
});

// --- #2546: render --section procedure:<name> ---

test('render --section procedure:review-console emits the head file verbatim and excludes the appendix content', () => {
  const r = run(['render', '--section', 'procedure:review-console']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /# Wrap-Up Review Console — Phase 4 \(CLOSE\)/);
  // The appendix-only content (the Multi-spec defer protocol's 6-step body)
  // must not appear in the head's own output — proves the split, not just
  // that *some* markdown was printed.
  assert.doesNotMatch(r.stdout, /Do NOT present the console/);
});

test('render --section procedure:curation-engine emits the head file and excludes its appendix content', () => {
  const r = run(['render', '--section', 'procedure:curation-engine']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /# Curation Engine — the Phase 2 mechanism/);
  assert.doesNotMatch(r.stdout, /Engine failure is never permission to skip a row/);
});

test('render --section procedure:cleanup-procedures-execution emits the head file and excludes its appendix content', () => {
  const r = run(['render', '--section', 'procedure:cleanup-procedures-execution']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /# Wrap-Up Cleanup Procedures — execution detail/);
  assert.doesNotMatch(r.stdout, /Delete unconditionally after \*\*2026-11-07\*\*/);
});

test('render --section procedure:pr-first-merge emits the head file and excludes its appendix content', () => {
  const r = run(['render', '--section', 'procedure:pr-first-merge']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /# PR-First Merge — the one canonical merge procedure/);
  assert.doesNotMatch(r.stdout, /keep each citing file's own pre-#411 procedure/);
});

test('render --section procedure:<unknown> exits 2 naming the unrecognized procedure, not a stack trace', () => {
  const r = run(['render', '--section', 'procedure:not-a-real-one']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /unknown procedure 'not-a-real-one'/);
});

test('render --section procedure: with an empty name exits 2 with a clear message', () => {
  const r = run(['render', '--section', 'procedure:']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /requires a name/);
});

test('render --section procedure:<name> combined with --run-dir exits 2 with usage', () => {
  const runDir = planFreshRunDir();
  const r = run(['render', '--section', 'procedure:review-console', '--run-dir', runDir]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: wrap-up-engine\.js/);
});

test('render --section procedure:<name> combined with --strict exits 2 with usage', () => {
  const r = run(['render', '--section', 'procedure:review-console', '--strict']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: wrap-up-engine\.js/);
});

test('render --section with a bare unrecognized value (no procedure: prefix) still rejects with the original usage-error shape', () => {
  const runDir = planFreshRunDir();
  const r = run(['render', '--run-dir', runDir, '--section', 'bogus']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /--section must be 'trace', 'console', or 'procedure:<name>'/);
});
