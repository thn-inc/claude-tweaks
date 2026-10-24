// tests/release-run-dir-lifecycle-conformance.test.js — pins #3898: /release Step 0 adopted the most
// recent matching run directory at step 2 of run-dir-resolution whatever its run-state.json said, so a
// later release inherited a finished release run's directory (status clean/closed) — and the new run's
// decisions, config and staged proposals landed in a directory already archived or closed out. Step 0
// now refuses a step-2 directory whose status is terminal (anything outside run-integrity.js's
// NON_TERMINAL) or that a prior release run stamped createdBy: "release-standalone" (an early stop leaves
// it active), mints a fresh one, and classifies the run as created. The guard is extracted from the
// live SKILL.md fence and executed against fixture directories (extract-and-run form), and the prose
// facts around it are pinned with go-red proofs.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { gitRepo, FIXTURE_TIMEOUT_MS } = require('./helpers/git-fixtures');

const ROOT = path.join(__dirname, '..');
const SKILL = path.join(ROOT, 'plugin', 'skills', 'release', 'SKILL.md');
// Forward slashes: the guard hands CLAUDE_PLUGIN_ROOT to node through the environment, but a Windows
// backslash root would still break any shell expansion of it.
const PLUGIN_ROOT = path.join(ROOT, 'plugin').split(path.sep).join('/');

function stepZeroOf(text) {
  const start = text.indexOf('\n## Step 0');
  assert.notEqual(start, -1, 'extraction pattern is out of sync: release/SKILL.md has no "## Step 0" heading');
  const next = text.indexOf('\n## Step 1', start + 1);
  assert.notEqual(next, -1, 'extraction pattern is out of sync: release/SKILL.md has no "## Step 1" heading after Step 0');
  return text.slice(start, next);
}

// The `bash` fence of Step 0 that resolves the run directory.
function resolveFence(stepZero) {
  const fences = [...stepZero.matchAll(/```bash\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  const fence = fences.find((f) => f.includes('resolve-run-dir --spec-slug release'));
  assert.ok(fence, 'extraction pattern is out of sync: no Step 0 bash fence contains "resolve-run-dir --spec-slug release"');
  return fence;
}

// The guard command: from `PLUGIN_ROOT=` on the guard line to just before that line's LAST `; then`.
const GUARD_LINE_PREFIX = 'if [ -n "$RUN_DIR" ] && PLUGIN_ROOT=';
function extractGuard(stepZero) {
  const line = resolveFence(stepZero).split('\n').find((l) => l.startsWith(GUARD_LINE_PREFIX));
  assert.ok(line, `extraction pattern is out of sync: no Step 0 fence line starts with ${GUARD_LINE_PREFIX}`);
  const from = line.indexOf('PLUGIN_ROOT=');
  const to = line.lastIndexOf('; then');
  assert.ok(from !== -1 && to > from, 'extraction pattern is out of sync: the guard line has no "PLUGIN_ROOT=" ... "; then" span');
  return line.slice(from, to);
}

const STEP_ZERO = stepZeroOf(readText(SKILL));

// PIPELINE_RUN_DIR and RUN_DIR are deleted so the caller's env never decides; `overrides` sets what the run needs.
function scriptEnv(overrides) {
  const env = { ...process.env };
  delete env.PIPELINE_RUN_DIR;
  delete env.RUN_DIR;
  return { ...env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...overrides };
}

// Runs the guard against a fixture dir.
function runGuard(guard, dir) {
  return spawnSync('bash', ['-c', guard], { env: scriptEnv({ RUN_DIR: dir }), encoding: 'utf8' });
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'release-run-dir-lifecycle-'));
process.on('exit', () => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ } });

function fixture(name, runState) {
  const dir = path.join(scratch, name);
  fs.mkdirSync(dir, { recursive: true });
  if (runState !== null) fs.writeFileSync(path.join(dir, 'run-state.json'), runState);
  return dir;
}

const ROWS = [
  ['clean', 'clean', '{"status":"clean"}', 0],
  ['closed', 'closed', '{"status":"closed"}', 0],
  ['active', 'active', '{"status":"active"}', 1],
  ['interrupted', 'interrupted', '{"status":"interrupted"}', 1],
  ['absent file', 'absent', null, 1],
  ['not json', 'notjson', 'not json', 1],
  ["clean in a dir named o'brien run", "o'brien run", '{"status":"clean"}', 0],
  ['no status key', 'nostatus', '{}', 1],
  ['non-string status', 'numstatus', '{"status":5}', 1],
  // A prior release run's own directory is refused whatever its status (#3898 final review C1).
  ['active, release-standalone', 'active-release', '{"status":"active","createdBy":"release-standalone"}', 0],
  ['interrupted, release-standalone', 'interrupted-release', '{"status":"interrupted","createdBy":"release-standalone"}', 0],
  ['active, created by flow', 'active-flow', '{"status":"active","createdBy":"flow"}', 1],
  ['no status, release-standalone', 'nostatus-release', '{"createdBy":"release-standalone"}', 0],
];

// One assertion for the whole table; the go-red controls below run this same function.
function assertGuardRows(guard, tag) {
  for (const [label, name, runState, expected] of ROWS) {
    const result = runGuard(guard, fixture(`${tag}-${name}`, runState));
    assert.equal(result.status, expected, `${label}: expected exit ${expected}, got ${result.status} (stderr: ${result.stderr})`);
  }
}

test('AC1.1: Step 0 guard classifies run-state status', () => {
  assertGuardRows(extractGuard(STEP_ZERO), 'live');
});

// The release-standalone half of the predicate, removed: the gap #3898's final review reproduced.
const CREATED_BY_DISJUNCT = ' || r.createdBy === "release-standalone"';
function dropCreatedByDisjunct(text) {
  const mutated = text.replace(CREATED_BY_DISJUNCT, '');
  assert.notEqual(mutated, text, `anchor text "${CREATED_BY_DISJUNCT.trim()}" not found — proof cannot discriminate`);
  return mutated;
}

test('AC1.1: Step 0 guard go-red: without the release-standalone disjunct an active release dir is adopted', () => {
  assert.throws(() => assertGuardRows(dropCreatedByDisjunct(extractGuard(STEP_ZERO)), 'nodisjunct'), /active, release-standalone: expected exit 0, got 1/);
});

test('AC2.1: Step 0 guard go-red: a flipped predicate adopts a clean dir', () => {
  const guard = extractGuard(STEP_ZERO);
  const flipped = guard.replace('!NON_TERMINAL.has(s)', 'NON_TERMINAL.has(s)');
  assert.notEqual(flipped, guard, 'anchor text "!NON_TERMINAL.has(s)" not found in the guard — proof cannot discriminate');
  assert.equal(runGuard(flipped, fixture('clean-flipped', '{"status":"clean"}')).status, 1, 'the flipped predicate must adopt (exit 1) a clean dir');
  assert.equal(runGuard(flipped, fixture('active-flipped', '{"status":"active"}')).status, 0, 'the flipped predicate must refuse (exit 0) an active dir');
});

// The mint line of the same fence: `resolve-run-dir --standalone release --create`.
function extractMintLine(stepZero) {
  const line = resolveFence(stepZero).split('\n').find((l) => l.includes('--standalone release --create'));
  assert.ok(line, 'extraction pattern is out of sync: no Step 0 fence line carries "--standalone release --create"');
  return line.trim();
}

// Every fixture repo lands under `scratch`, which the exit hook above removes.
function initRepo() {
  return gitRepo({ parent: scratch });
}

// A real repo whose only run directory is a finished release run — the shape #3898 reproduced.
const FINISHED_RUN_ID = '2026-10-01T100000-release-standalone';
function finishedRunRepo() {
  const repo = initRepo();
  const finished = path.join(repo, '.claude-tweaks', 'pipelines', FINISHED_RUN_ID);
  fs.mkdirSync(finished, { recursive: true });
  fs.writeFileSync(path.join(finished, 'run-state.json'), '{"status":"clean"}');
  return { repo, finished, pipelines: path.dirname(finished) };
}

function runInRepo(repo, script, envOverrides) {
  return spawnSync('bash', ['-c', script], { cwd: repo, env: scriptEnv(envOverrides), encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS });
}

// After the guard refuses the finished dir, the mint line must produce a different, newly created dir.
function assertMintIsFresh(mintLine, label) {
  const { repo, finished, pipelines } = finishedRunRepo();
  const result = runInRepo(repo, `${mintLine}\necho "$RUN_DIR"`);
  assert.equal(result.status, 0, `${label}: mint exited ${result.status} (stderr: ${result.stderr})`);
  const minted = fs.realpathSync(result.stdout.trim());
  assert.notEqual(minted, fs.realpathSync(finished), `${label}: the mint re-adopted the finished run dir it was supposed to replace (#3898)`);
  assert.equal(path.dirname(minted), fs.realpathSync(pipelines), `${label}: the minted dir must sit under the fixture's pipelines root`);
  assert.ok(fs.statSync(minted).isDirectory(), `${label}: the minted dir must exist`);
}

test('AC1.1: Step 0 mint after a refusal creates a new dir instead of re-adopting the finished one', () => {
  assertMintIsFresh(extractMintLine(STEP_ZERO), 'mint-fresh');
});

test('AC1.1: Step 0 mint go-red: re-inserting --spec-slug re-adopts the finished dir', () => {
  const mintLine = extractMintLine(STEP_ZERO);
  const reinserted = mintLine.replace('--standalone release', '--spec-slug release --standalone release');
  assert.notEqual(reinserted, mintLine, 'anchor text "--standalone release" not found in the mint line — proof cannot discriminate');
  assert.throws(() => assertMintIsFresh(reinserted, 'mint-reinserted'), /re-adopted the finished run dir/);
});

test('AC1.1: Step 0 fence end to end: a finished release run is refused, a fresh dir minted, status printed', () => {
  const { repo, finished, pipelines } = finishedRunRepo();
  const result = runInRepo(repo, resolveFence(STEP_ZERO));
  assert.equal(result.status, 0, `the fence must exit 0 (stderr: ${result.stderr})`);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 2, `the fence must print the run dir and one refused line, got: ${result.stdout}`);
  const minted = fs.realpathSync(lines[0]);
  assert.notEqual(minted, fs.realpathSync(finished), 'the run dir must not be the finished one');
  assert.equal(path.dirname(minted), fs.realpathSync(pipelines), 'the minted dir must sit under the fixture pipelines root');
  const refused = /^refused: (.*) \(status clean\)$/.exec(lines[1]);
  assert.ok(refused, `the second line must be "refused: {dir} (status clean)", got: ${lines[1]}`);
  assert.equal(fs.realpathSync(refused[1]), fs.realpathSync(finished), 'the second line must name the refused dir');
  assert.equal(JSON.parse(fs.readFileSync(path.join(minted, 'run-state.json'), 'utf8')).createdBy, 'release-standalone', 'the fresh dir carries the release-standalone stamp');
});

// --- PIPELINE_RUN_DIR: only the directory the resolver actually returned from it is exempt (#3898) ---
// The exemption is keyed on the resolved dir BEING the step-1 PIPELINE_RUN_DIR directory, so a stale value
// (a missing dir, an archived run-id) that falls through to step 2 is checked like any step-2 directory.
function pipelineEntries(pipelines) {
  return fs.readdirSync(pipelines).sort();
}

function assertPipelineRunDirExemption(fence) {
  const { repo, pipelines } = finishedRunRepo();
  // Case (a): an existing, anchored, terminal release-standalone dir that PIPELINE_RUN_DIR names is inherited.
  const supplied = path.join(pipelines, '2026-10-02T100000-supplied');
  fs.mkdirSync(supplied);
  fs.writeFileSync(path.join(supplied, 'run-state.json'), '{"status":"clean","createdBy":"release-standalone"}');
  const before = pipelineEntries(pipelines);
  const result = runInRepo(repo, fence, { PIPELINE_RUN_DIR: supplied });
  assert.equal(result.status, 0, `exempt: the fence must exit 0 (stderr: ${result.stderr})`);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `exempt: a PIPELINE_RUN_DIR directory must print only itself, with no refused: line, got: ${result.stdout}`);
  assert.equal(fs.realpathSync(lines[0]), fs.realpathSync(supplied), 'exempt: the fence must keep the PIPELINE_RUN_DIR directory');
  assert.deepEqual(pipelineEntries(pipelines), before, 'exempt: no directory may be minted');
}

function assertStalePipelineRunDirIsChecked(fence) {
  const { repo, finished, pipelines } = finishedRunRepo();
  // Case (b): PIPELINE_RUN_DIR names a missing path, so step 2 returns the prior clean release dir.
  const stale = path.join(pipelines, '2026-10-03T100000-never-created');
  const result = runInRepo(repo, fence, { PIPELINE_RUN_DIR: stale });
  assert.equal(result.status, 0, `stale: the fence must exit 0 (stderr: ${result.stderr})`);
  const lines = result.stdout.trim().split('\n');
  const refused = /^refused: (.*) \(status clean\)$/.exec(lines[1] || '');
  assert.ok(refused, `stale: a stale PIPELINE_RUN_DIR must still refuse the prior release dir the resolver falls through to, got: ${result.stdout}`);
  assert.equal(fs.realpathSync(refused[1]), fs.realpathSync(finished), 'stale: the refused line must name the prior dir');
  const minted = fs.realpathSync(lines[0]);
  assert.notEqual(minted, fs.realpathSync(finished), 'stale: a fresh dir must be minted');
  assert.equal(pipelineEntries(pipelines).length, 2, 'stale: exactly one new directory is minted');
}

test('AC4.1: Step 0 fence: a PIPELINE_RUN_DIR directory the resolver returns is inherited, never refused', () => {
  assertPipelineRunDirExemption(resolveFence(STEP_ZERO));
});

test('AC4.1: Step 0 fence: a stale PIPELINE_RUN_DIR falls through to step 2 and the prior release dir is refused', () => {
  assertStalePipelineRunDirIsChecked(resolveFence(STEP_ZERO));
});

// The pre-fix form: skip the guard whenever PIPELINE_RUN_DIR is non-empty.
function revertToEmptinessExemption(fence) {
  const from = '[ -n "$RUN_DIR" ] && PLUGIN_ROOT=';
  const mutated = fence.replace(from, '[ -n "$RUN_DIR" ] && [ -z "$PIPELINE_RUN_DIR" ] && PLUGIN_ROOT=');
  assert.notEqual(mutated, fence, `anchor text "${from}" not found — proof cannot discriminate`);
  return mutated;
}

// The exemption removed: the guard applies to every resolved directory.
function dropExemption(fence) {
  const from = ' if (e !== null && e === real(process.argv[1])) process.exit(1);';
  const mutated = fence.replace(from, '');
  assert.notEqual(mutated, fence, `anchor text "${from.trim()}" not found — proof cannot discriminate`);
  return mutated;
}

test('AC4.1: PIPELINE_RUN_DIR go-red: the emptiness-keyed exemption adopts a prior release dir behind a stale value', () => {
  assert.throws(() => assertStalePipelineRunDirIsChecked(revertToEmptinessExemption(resolveFence(STEP_ZERO))), /stale: a stale PIPELINE_RUN_DIR must still refuse/);
});

test('AC4.1: PIPELINE_RUN_DIR go-red: without the exemption a supplied terminal dir is refused', () => {
  assert.throws(() => assertPipelineRunDirExemption(dropExemption(resolveFence(STEP_ZERO))), /exempt: a PIPELINE_RUN_DIR directory must print only itself/);
});

// Waits until the wall clock enters a new second: the standalone mint names its dir by the second,
// so two mints inside one second would name the same directory.
function waitForNextSecond() {
  const start = Math.floor(Date.now() / 1000);
  const cell = new Int32Array(new SharedArrayBuffer(4));
  while (Math.floor(Date.now() / 1000) === start) Atomics.wait(cell, 0, 0, 50);
}

// The reviewer's scenario: the fence runs twice with no close-run between them. The second run must
// refuse the first run's still-active directory and mint a different one.
function assertSecondRunRefusesFirst(fence, label) {
  const repo = initRepo();
  const first = runInRepo(repo, fence);
  assert.equal(first.status, 0, `${label}: first run exited ${first.status} (stderr: ${first.stderr})`);
  const firstLines = first.stdout.trim().split('\n');
  assert.equal(firstLines.length, 1, `${label}: the first run must print only its minted dir, got: ${first.stdout}`);
  const firstDir = fs.realpathSync(firstLines[0]);
  waitForNextSecond();
  const second = runInRepo(repo, fence);
  assert.equal(second.status, 0, `${label}: second run exited ${second.status} (stderr: ${second.stderr})`);
  const lines = second.stdout.trim().split('\n');
  const refused = /^refused: (.*) \(status active\)$/.exec(lines[1] || '');
  assert.ok(refused, `${label}: the second run did not refuse the first run's directory, got: ${second.stdout}`);
  assert.equal(fs.realpathSync(refused[1]), firstDir, `${label}: the refused line must name the first run's directory`);
  assert.notEqual(fs.realpathSync(lines[0]), firstDir, `${label}: the second run must mint a different directory`);
}

test('AC1.1: Step 0 fence run twice without a close: the second run refuses the first run\'s active dir', () => {
  assertSecondRunRefusesFirst(resolveFence(STEP_ZERO), 'twice-live');
});

test('AC1.1: Step 0 fence run twice go-red: without the release-standalone disjunct the second run re-adopts', () => {
  assert.throws(() => assertSecondRunRefusesFirst(dropCreatedByDisjunct(resolveFence(STEP_ZERO)), 'twice-nodisjunct'), /did not refuse the first run's directory/);
});

// The load-bearing prose facts of the refusal. The patterns match exactly once in Step 0, so
// removing the one match turns exactly that fact red.
const REQUIRED = [
  [/ENV_RUN_DIR="\$PIPELINE_RUN_DIR"/, 'the guard compares the resolved dir with the directory PIPELINE_RUN_DIR names, handed to node through the environment'],
  [/the only directory never subject to the status check above/, 'only the directory the resolver returned from PIPELINE_RUN_DIR is exempt from the status check'],
  [/an archived run-id, falls through to step 2 and is checked like any step-2 directory\)/, 'a stale or archived PIPELINE_RUN_DIR falls through to step 2 and is checked like any step-2 directory'],
  [/except the `FAILED` lines `bookkeeping\.md` and `disposition\.md` hand-compose/, 'the never-hand-appended rule carves out the FAILED lines bookkeeping.md and disposition.md hand-compose'],
  [/prior release run's directory \(status \{status\}\) — not adopted; minted \{run-dir\}/, 'the refusal log line names the refused dir, its status and the minted dir'],
  // Split in two so neither span contains the other: the refusal triggers, then the created verdict.
  [/status is terminal, or that carries `createdBy: "release-standalone"` whatever its status/, 'a terminal or release-standalone step-2 directory is refused whatever its status'],
  [/is refused — the fence prints `refused:[\s\S]{0,200}the run is \*\*created\*\*/, 'a refused directory is replaced by a fresh mint and the run is created'],
  [/neither terminal nor stamped by a release run/, 'a step-2 directory is inherited only while non-terminal and not release-standalone-created'],
  [/step 2 already skips an `interrupted` one/, 'step 2 never hands over an interrupted directory to inherit'],
  [/carried `\{run-dir\}` path[\s\S]{0,200}mint a stray one/, 'later steps use the carried run dir and never re-run the fence'],
];
const missingFactsOf = (patterns) => (text) => patterns.filter(([pattern]) => !pattern.test(text)).map(([, fact]) => fact);
const missingFacts = missingFactsOf(REQUIRED);

function assertEachPatternGoesRed(text, patterns, missingOf) {
  for (const [pattern, fact] of patterns) {
    const doctored = text.replace(pattern, '');
    assert.notEqual(doctored, text, `anchor text for "${fact}" not found — proof cannot discriminate`);
    assert.deepEqual(missingOf(doctored), [fact], `removing only "${fact}" must turn exactly that assertion red`);
  }
}

// Every fact present in `text`, and each one able to go red on its own.
function assertFactsAndGoRed(text, patterns, message) {
  const missingOf = missingFactsOf(patterns);
  assert.deepEqual(missingOf(text), [], message);
  assertEachPatternGoesRed(text, patterns, missingOf);
}

test('AC1.1/AC2.1: Step 0 prose: terminal step-2 dir is refused, run is created', () => {
  assert.deepEqual(missingFacts(STEP_ZERO), [], 'Step 0 must state every fact of the finished-run refusal (#3898)');
});

test('AC1.1/AC2.1: each Step 0 refusal fact can actually go red on its own (discrimination proof)', () => {
  assertEachPatternGoesRed(STEP_ZERO, REQUIRED, missingFacts);
});

// The pre-#3898 sentence, frozen: the clause that told Step 0 to adopt any step-2 directory.
const PRE_CHANGE_STEP0 = '**Determine inherited-vs-created here, once.** At this point — and only here — record which of the two branches above ran: `$PIPELINE_RUN_DIR` was already set at invocation, or an existing directory resolved at step 2 (whatever its `createdBy` — a prior standalone release run\'s directory counts) → **inherited**; this run minted the directory and wrote the `createdBy: "release-standalone"` stamp above → **created**.';
const ADOPT_ANY = /a prior standalone release run's directory counts/;

test('AC2.1: Step 0 prose: the "prior standalone release run counts" clause is gone', () => {
  assert.match(PRE_CHANGE_STEP0, ADOPT_ANY, 'the frozen pre-change excerpt must carry the retired clause — the pattern cannot discriminate otherwise');
  assert.doesNotMatch(STEP_ZERO, ADOPT_ANY, 'Step 0 must no longer say a prior standalone release run\'s directory is adopted (#3898)');
});

// --- Step 8: dispose of staged findings, then archive the created directory (#3898) -----------------
// The prose is new in this change, so each fact's go-red proof strips the one live match in memory
// (assertEachPatternGoesRed) rather than diffing against frozen pre-change bytes.
const DISPOSITION = path.join(ROOT, 'plugin', 'skills', 'release', 'disposition.md');
function readDisposition() {
  assert.ok(fs.existsSync(DISPOSITION), 'plugin/skills/release/disposition.md is missing — Step 8 reads it before the summary (#3898)');
  return readText(DISPOSITION);
}

function stepEightOf(text) {
  const start = text.indexOf('\n## Step 8');
  assert.notEqual(start, -1, 'extraction pattern is out of sync: release/SKILL.md has no "## Step 8" heading');
  const next = text.indexOf('\n## Next Actions', start + 1);
  assert.notEqual(next, -1, 'extraction pattern is out of sync: release/SKILL.md has no "## Next Actions" heading after Step 8');
  return text.slice(start, next);
}

const DISPOSITION_SCOPE = [
  [/\*\*created\*\* run director/, 'disposition covers a created run directory only'],
  [/inherited[\s\S]{0,200}parent's Review Console/, 'an inherited directory is left to the parent\'s Review Console'],
  [/staged\/review-\{n\}\.\{md,patch\}/, 'inventory: confirmed findings, staged/review-{n}.{md,patch}'],
  [/staged\/review-unconfirmed-\{n\}\.md/, 'inventory: unconfirmed entries'],
  [/staged\/review-contested-\{n\}\.md/, 'inventory: contested findings'],
  [/staged\/review-debate-\{n\}\.md/, 'inventory: debate findings'],
  [/unrecognised[\s\S]{0,200}not archived/, 'an unrecognised staged/review-* file fails closed: the run is not archived'],
  [/every file in it except `release-held\.md`, which is not a finding/, 'inventory: every file in staged/ except release-held.md, which is not a finding'],
  [/only the lines after Step 3's carried marker `\{k\}`/, 'inventory: decisions.md is read only after Step 3\'s marker'],
  [/`STAGED` line whose stage path is absent or names no existing file/, 'inventory: a decisions.md-only STAGED line is a finding'],
  [/counted once by its stage path/, 'inventory: a STAGED line naming a listed file is de-duplicated by stage path'],
  [/An absent or empty `staged\/` means no staged files/, 'inventory: an absent or empty staged/ means no staged files'],
  [/When Step 3 logged no `## \/review` marker this run[\s\S]{0,200}read no `decisions\.md` line at all/, 'inventory: with no Step 3 marker, no decisions.md line is read'],
  [/`staged\/reflect-\*`, `staged\/simplify-\*` and `staged\/deepen-\*`/, 'inventory: reflect, simplify and deepen files'],
];

const DISPOSITION_ROUTING = [
  [/review\/step3-routing\.md[\s\S]{0,120}Defer/, 'confirmed findings route through step3-routing.md\'s Defer bullet'],
  [/pre-existing-outside-diff/, 'the Defer-reason is pre-existing-outside-diff'],
  [/_shared\/materiality-floor\.md/, 'the materiality floor is cited'],
  [/Digest — below floor/, 'a below-floor finding is Digest — below floor'],
  [/unconfirmed[\s\S]{0,80}critical\/high[\s\S]{0,80}Defer/, 'an unconfirmed critical/high finding takes the same Defer'],
  [/declined \(unconfirmed: one reproduction agent of the pair\)/, 'an unconfirmed medium/low/info finding is declined, naming the pair'],
  [/declined \(contested: \{verdicts\}\)/, 'a contested finding is declined, naming the verdicts'],
  [/covered by #\{n\}/, 'a finding an open record already covers is declined'],
  [/`decisions\.md`-only `STAGED` line at critical\/high \| The same Defer/, 'a decisions.md-only critical/high line takes the same Defer'],
  [/declined \(unconfirmed: \{the line's own reason/, 'any other decisions.md-only line is declined with its own reason'],
  [/`reflect-\*`, `simplify-\*` or `deepen-\*` file \| The same Defer path and Defer-reason/, 'reflect/simplify/deepen files take the same Defer path'],
  [/else treated as medium for the floor test/, 'a severity-less reflect/simplify/deepen file is medium for the floor'],
  [/Any other staged file \| No route/, 'any other staged file has no route'],
  [/_shared\/github-write-transport\.md/, 'filing and the covered-by lookup go through the write transport'],
];

const DISPOSITION_APPROVAL = [
  [/AskUserQuestion/, 'a present human is asked once'],
  [/Apply all \(Recommended\)/, 'the question offers Apply all (Recommended)'],
  [/unattended[\s\S]{0,200}AUTO-RESOLVED/, 'under unattended the table renders with rows stamped AUTO-RESOLVED'],
  [/consoleAutoResolve/, 'the unattended shape is consoleAutoResolve\'s'],
  // Anchored on the AUTO prefix: the FAILED line also begins "Step 8 disposition: {staged path}".
  [/AUTO \{HH:MM:SS\} — Step 8 disposition: \{staged path\}/, 'the per-finding log line'],
  [/exactly one/, 'exactly one log line per finding'],
  [/FAILED \{HH:MM:SS\} — Step 8 disposition:/, 'a failed write is a hand-composed FAILED line'],
  [/skip[\s\S]{0,60}archiv/, 'any failure skips archival'],
  [/--dry-run[\s\S]{0,160}still runs/, 'disposition still runs under --dry-run'],
  [/Below `unattended`, a human reachable in the session/, 'below unattended with a human reachable, the table renders and one question is asked'],
  [/_shared\/auto-mode-contract\.md`'s never-silenced list/, 'auto permits the question: work-record creation is never silenced'],
  [/SKIP \{HH:MM:SS\} — Step 8 disposition \(degraded\): condition: no human present below autonomy unattended → fallback: \{n\} findings left staged at \{paths\}/, 'headless below unattended: the degraded SKIP line'],
  [/counts as undisposed — a failure for archival purposes/, 'a headless undisposed finding blocks archival'],
];

for (const [name, patterns] of [
  ['AC3.1: disposition.md states the scope and inventory', DISPOSITION_SCOPE],
  ['AC3.1: disposition.md routing table', DISPOSITION_ROUTING],
  ['AC3.1: disposition.md approval and logging', DISPOSITION_APPROVAL],
]) {
  test(name, () => {
    assertFactsAndGoRed(readDisposition(), patterns, `${name} must state every fact (#3898)`);
  });
}

const STEP8_WIRING = [
  [/disposition\.md/, 'Step 8 reads disposition.md'],
  [/findings: \{f\} filed, \{d\} digest, \{x\} declined\{, k failed — \{paths\}\}/, 'the summary block carries the findings: line, failed paths included'],
  [/hooks\.js" archive-run --run "\{run-dir\}"/, 'Step 8 runs archive-run on the run dir'],
  // Grouped: an ungrouped `a|Step 0` alternation would match any "Step 0" in the section and could never go red.
  [/Step 8 archival \(skipped\): condition: archive-run printed[\s\S]{0,200}(?:Step 0 refuses it|not adopted)/, 'a non-archival is a degrade-trace SKIP, non-fatal because Step 0 refuses the closed directory'],
  [/Step 8 archival \(skipped\): condition: disposition reported \{k\} failed → fallback: archival not run; closed directory kept with its findings in staged\//, 'a disposition failure that blocks archival is a degrade-trace SKIP'],
  [/the success line `claude-tweaks: archived \{run-id\}`/, 'archival is keyed on the success line'],
  [/Any other output[\s\S]{0,200}means not archived/, 'any other archive-run output means not archived'],
  [/archive\/\{run-id\}\/staged\/release-held\.md/, 'HELD names the archived release-held.md once archived'],
  [/`HELD`'s staged path prints last, after the archival/, 'HELD\'s staged path prints after the archival'],
  [/\*\*Every exit runs the close-out\.\*\*/, 'every exit after Step 0\'s mint runs the close-out'],
  [/Step 1's terminal stops, Step 2's nothing-to-release, Step 3's stops/, 'the close-out names the early stops'],
  [/Step 2 keeps its single printed line/, 'an early stop renders nothing more; Step 2 keeps its one line'],
];

// An ordering claim: each marker must exist, and positions must increase.
function requireOrder(text, markers) {
  let last = -1;
  for (const marker of markers) {
    const idx = text.indexOf(marker);
    assert.notStrictEqual(idx, -1, `ordering marker missing: ${marker}`);
    assert.ok(idx > last, `ordering marker out of order: ${marker} must come after the previous marker`);
    last = idx;
  }
}
const STEP8_ORDER = ['disposition.md', 'close-run --run', 'archive-run --run'];

// Swaps the two blank-line-delimited paragraphs holding `a` and `b`, asserting exactly one holds each.
function swapParagraphs(text, a, b) {
  const paragraphs = text.split(/\r?\n\r?\n/);
  const ia = paragraphs.flatMap((p, i) => (p.includes(a) ? [i] : []));
  const ib = paragraphs.flatMap((p, i) => (p.includes(b) ? [i] : []));
  assert.equal(ia.length, 1, `exactly one paragraph must hold "${a}", found ${ia.length}`);
  assert.equal(ib.length, 1, `exactly one paragraph must hold "${b}", found ${ib.length}`);
  [paragraphs[ia[0]], paragraphs[ib[0]]] = [paragraphs[ib[0]], paragraphs[ia[0]]];
  return paragraphs.join('\n\n');
}

test('AC2.1/AC3.1: Step 8 wires disposition, summary line, and archival in order', () => {
  const stepEight = stepEightOf(readText(SKILL));
  assertFactsAndGoRed(stepEight, STEP8_WIRING, 'Step 8 must wire disposition.md, the findings: line and archive-run (#3898)');
  requireOrder(stepEight, STEP8_ORDER);
});

test('AC2.1/AC3.1: Step 8 ordering go-red: permuting the live paragraphs trips the same requireOrder', () => {
  const stepEight = stepEightOf(readText(SKILL));
  const archiveAboveClose = swapParagraphs(stepEight, 'close-run --run', 'archive-run --run');
  assert.notEqual(archiveAboveClose, stepEight, 'the archive/close permutation changed nothing — proof cannot discriminate');
  assert.throws(() => requireOrder(archiveAboveClose, STEP8_ORDER), /out of order: archive-run --run/);
  const closeAboveDisposition = swapParagraphs(stepEight, 'disposition.md', 'close-run --run');
  assert.notEqual(closeAboveDisposition, stepEight, 'the close/disposition permutation changed nothing — proof cannot discriminate');
  assert.throws(() => requireOrder(closeAboveDisposition, STEP8_ORDER), /out of order: close-run --run/);
});

const STEP8_INHERITED = [
  [/An \*\*inherited\*\* directory is never closed/, 'an inherited directory is never closed'],
  [/inherited[\s\S]{0,120}never archived/, 'an inherited directory is never archived'],
];
const DISPOSITION_INHERITED = [
  [/Step 8 disposition \(skipped\): condition: inherited run directory → fallback: the parent's Review Console owns staged\//, 'an inherited directory is never disposed: the (skipped) SKIP line'],
];

test('AC4.1: an inherited run directory is never closed, archived or disposed', () => {
  assertFactsAndGoRed(stepEightOf(readText(SKILL)), STEP8_INHERITED, 'Step 8 must leave an inherited directory unclosed and unarchived');
  assertFactsAndGoRed(readDisposition(), DISPOSITION_INHERITED, 'disposition.md must write the SKIP line for an inherited directory');
});

// --- Early stops point at Step 8's close-out (#3898 final review C1b) ---------------------------------
function sliceBetween(text, from, to) {
  const start = text.indexOf(`\n${from}`);
  assert.notEqual(start, -1, `extraction pattern is out of sync: release/SKILL.md has no "${from}" heading`);
  const end = text.indexOf(`\n${to}`, start + 1);
  assert.notEqual(end, -1, `extraction pattern is out of sync: release/SKILL.md has no "${to}" heading after "${from}"`);
  return text.slice(start, end);
}

const POINTER = [[/Step 8's close-out still runs for a created directory/, 'the stop points at Step 8\'s close-out']];
const EARLY_STOPS = [
  ['## Step 1', '## Step 2', [...POINTER, [/Every \*\*Stop\*\* in the table below also ends with Step 8's close-out/, 'every table Stop ends with the close-out']]],
  ['## Step 2', '## Step 3', POINTER],
  ['## Step 3', '## Step 4', POINTER],
  ['## --train semantics', '## Component-Skill Contract', POINTER],
  ['## Input', '## Step 0', [[/Step 8's disposition still files, digests or declines the review's findings/, 'a dry run still disposes the findings']]],
];

for (const [from, to, patterns] of EARLY_STOPS) {
  test(`AC2.1: ${from} carries its Step 8 close-out facts (with go-red)`, () => {
    assertFactsAndGoRed(sliceBetween(readText(SKILL), from, to), patterns, `${from} must state every close-out fact (#3898)`);
  });
}

// --- release/disposition.md is a registered consoleAutoResolve caller (#3898 final review I5) ---------
const CEILING = path.join(ROOT, 'plugin', 'skills', '_shared', 'autonomy-ceiling.md');
const CEILING_FACTS = [[/Three sanctioned callers[\s\S]{0,600}`release\/disposition\.md`'s Approval section/, 'autonomy-ceiling.md registers release/disposition.md as a consoleAutoResolve caller']];

test('AC3.1: autonomy-ceiling.md registers release/disposition.md as a consoleAutoResolve caller (with go-red)', () => {
  const row = readText(CEILING).split('\n').find((l) => l.startsWith('| `consoleAutoResolve` |'));
  assert.ok(row, 'extraction pattern is out of sync: autonomy-ceiling.md has no consoleAutoResolve row');
  assertFactsAndGoRed(row, CEILING_FACTS, 'the consoleAutoResolve row must name release/disposition.md as a sanctioned caller');
});

// --- FAILED is hand-composed by four writers; the skill graph names what disposition.md reads (#3898 review) ---
const DECISION_LOG = path.join(ROOT, 'plugin', 'skills', '_shared', 'auto-decision-log.md');
const FAILED_WRITER_FACTS = [
  [/hand-composed by its four writers \(see the `STATUS` row below\)/, 'the schema intro counts four FAILED writers'],
  [/hand-composed by `backlog\/refine-mode\.md`, `apply-refine-labels\.js`, `release\/bookkeeping\.md` and `release\/disposition\.md` rather than/, 'the STATUS row names all four FAILED writers'],
  [/Hand-composed by its four writers \(see the `STATUS` row above\)/, 'the FAILED outcome row counts four writers'],
];

test('AC3.1: auto-decision-log.md names every FAILED writer, release/bookkeeping.md and release/disposition.md included (with go-red)', () => {
  assertFactsAndGoRed(readText(DECISION_LOG), FAILED_WRITER_FACTS, 'auto-decision-log.md must name all four hand-composing FAILED writers');
  assert.doesNotMatch(readText(DECISION_LOG), /its two writers/, 'no stale "two writers" count may remain');
});

const GRAPH = path.join(ROOT, 'docs', 'skill-graph.md');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GRAPH_ROWS = [
  'review/step3-lens-dispatch.md',
  'review/step3-tiebreak.md',
  'review/step3-debate-and-refutation.md',
  'review/code-mode-steps.md',
  '_shared/multi-agent-coordination.md',
].map((target) => [new RegExp(`\\| \`${escapeRe(target)}\` \\| Step 8's disposition`), `the release table has a row for ${target}`]);

test('AC3.1: docs/skill-graph.md release table lists every review contract disposition.md reads (with go-red)', () => {
  assertFactsAndGoRed(sliceBetween(readText(GRAPH), '## release', '## research'), GRAPH_ROWS, 'the ## release table must carry a row per staged-file contract disposition.md reads');
});
