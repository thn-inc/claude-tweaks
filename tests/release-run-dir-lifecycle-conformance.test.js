// tests/release-run-dir-lifecycle-conformance.test.js — pins #3898 and #4151: /release Step 0 adopted the
// most recent matching run directory at step 2 of run-dir-resolution whatever its run-state.json said, so
// a later release inherited a finished release run's directory (status clean/closed) — and the new run's
// decisions, config and staged proposals landed in a directory already archived or closed out. #3898 put
// the refusal in an inline `node -e` probe in the SKILL.md fence; #4151 moved it into
// `resolve-run-dir`'s step 2 (run-dir-resolve.js's adoptionRefusal), so Step 0 is the resolver call alone:
// it refuses a step-2 directory whose status is terminal, that a prior release run stamped createdBy:
// "release-standalone" (an early stop leaves it active), or whose run-state.json exists but cannot be
// read, mints a fresh one, and classifies the run as created. The fence is extracted from the live
// SKILL.md and executed against fixture repos through the real CLI, and the prose facts around it are
// pinned with go-red proofs.
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
// Forward slashes: the fence hands CLAUDE_PLUGIN_ROOT to node through the environment, but a Windows
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

const STEP_ZERO = stepZeroOf(readText(SKILL));

// PIPELINE_RUN_DIR and RUN_DIR are deleted so the caller's env never decides; `overrides` sets what the run needs.
function scriptEnv(overrides) {
  const env = { ...process.env };
  delete env.PIPELINE_RUN_DIR;
  delete env.RUN_DIR;
  return { ...env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...overrides };
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'release-run-dir-lifecycle-'));
process.on('exit', () => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ } });

// Every fixture repo lands under `scratch`, which the exit hook above removes.
function initRepo() {
  return gitRepo({ parent: scratch });
}

function runInRepo(repo, script, envOverrides) {
  return spawnSync('bash', ['-c', script], { cwd: repo, env: scriptEnv(envOverrides), encoding: 'utf8', timeout: FIXTURE_TIMEOUT_MS });
}

function pipelineEntries(pipelines) {
  return fs.readdirSync(pipelines).sort();
}

// [label, run-dir name suffix, run-state.json contents (null = no file), adopted?]. The directory is named
// `2026-10-01T100000-release{suffix}`, so step 2's `-release` slug match finds it.
const ROWS = [
  ['clean', '', '{"status":"clean"}', false],
  ['closed', '', '{"status":"closed"}', false],
  ['active', '', '{"status":"active"}', true],
  ['interrupted', '', '{"status":"interrupted"}', false],
  ['absent file', '', null, true],
  ['not json', '', 'not json', false],
  ['JSON null', '', 'null', false],
  ["clean in a dir named o'brien run", "-o'brien-run", '{"status":"clean"}', false],
  ['no status key', '', '{}', true],
  ['non-string status', '', '{"status":5}', true],
  // A prior release run's own directory is refused whatever its status (#3898 final review C1).
  ['active, release-standalone', '', '{"status":"active","createdBy":"release-standalone"}', false],
  ['interrupted, release-standalone', '', '{"status":"interrupted","createdBy":"release-standalone"}', false],
  ['active, created by flow', '', '{"status":"active","createdBy":"flow"}', true],
  ['no status, release-standalone', '', '{"createdBy":"release-standalone"}', false],
];

// Runs the live fence once per row, each against its own fresh repo holding that one run directory. Every
// row runs, and the failures are reported together, so one regressed row never hides another.
function assertFenceRows(fence) {
  const failures = [];
  for (const row of ROWS) {
    try { assertFenceRow(fence, row); } catch (err) { failures.push(err.message); }
  }
  assert.deepEqual(failures, [], 'rows whose fence verdict is wrong');
}

function assertFenceRow(fence, [label, suffix, runState, adopted]) {
  const repo = initRepo();
  const pipelines = path.join(repo, '.claude-tweaks', 'pipelines');
  const dir = path.join(pipelines, `2026-10-01T100000-release${suffix}`);
  fs.mkdirSync(dir, { recursive: true });
  if (runState !== null) fs.writeFileSync(path.join(dir, 'run-state.json'), runState);
  const result = runInRepo(repo, fence);
  assert.equal(result.status, 0, `${label}: the fence must exit 0 (stderr: ${result.stderr})`);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `${label}: the fence must print exactly the run dir, got: ${result.stdout}`);
  const printed = fs.realpathSync(lines[0]);
  if (adopted) {
    assert.equal(printed, fs.realpathSync(dir), `${label}: expected the fence to adopt the fixture dir, got ${printed}`);
  } else {
    assert.notEqual(printed, fs.realpathSync(dir), `${label}: expected the fence to refuse the fixture dir and mint a fresh one`);
    assert.equal(path.dirname(printed), fs.realpathSync(pipelines), `${label}: the minted dir must sit under the fixture's pipelines root`);
  }
}

test('#4151 AC1.1: the Step 0 fence adopts or refuses each step-2 run-state', () => {
  assertFenceRows(resolveFence(STEP_ZERO));
});

// The mint line of the same fence: `resolve-run-dir --standalone release --create`.
function extractMintLine(stepZero) {
  const line = resolveFence(stepZero).split('\n').find((l) => l.includes('--standalone release --create'));
  assert.ok(line, 'extraction pattern is out of sync: no Step 0 fence line carries "--standalone release --create"');
  return line.trim();
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

// The mint line must produce a different, newly created dir even when an adoptable directory exists:
// an adoptable one (no run-state.json) is what step 2 would hand back if the mint carried --spec-slug.
function assertMintIsFresh(mintLine, label) {
  const repo = initRepo();
  const pipelines = path.join(repo, '.claude-tweaks', 'pipelines');
  const existing = path.join(pipelines, '2026-10-01T100000-release');
  fs.mkdirSync(existing, { recursive: true });
  const result = runInRepo(repo, `${mintLine}\necho "$RUN_DIR"`);
  assert.equal(result.status, 0, `${label}: mint exited ${result.status} (stderr: ${result.stderr})`);
  const minted = fs.realpathSync(result.stdout.trim());
  assert.notEqual(minted, fs.realpathSync(existing), `${label}: the mint re-adopted the existing run dir it was supposed to replace (#3898)`);
  assert.equal(path.dirname(minted), fs.realpathSync(pipelines), `${label}: the minted dir must sit under the fixture's pipelines root`);
  assert.ok(fs.statSync(minted).isDirectory(), `${label}: the minted dir must exist`);
}

test('AC1.1: Step 0 mint creates a new dir instead of re-adopting an existing one', () => {
  assertMintIsFresh(extractMintLine(STEP_ZERO), 'mint-fresh');
});

test('AC1.1: Step 0 mint go-red: re-inserting --spec-slug re-adopts the existing dir', () => {
  const mintLine = extractMintLine(STEP_ZERO);
  const reinserted = mintLine.replace('--standalone release', '--spec-slug release --standalone release');
  assert.notEqual(reinserted, mintLine, 'anchor text "--standalone release" not found in the mint line — proof cannot discriminate');
  assert.throws(() => assertMintIsFresh(reinserted, 'mint-reinserted'), /re-adopted the existing run dir/);
});

test('AC1.1: Step 0 fence end to end: a finished release run is refused, a fresh dir minted, status printed', () => {
  const { repo, finished, pipelines } = finishedRunRepo();
  const result = runInRepo(repo, resolveFence(STEP_ZERO));
  assert.equal(result.status, 0, `the fence must exit 0 (stderr: ${result.stderr})`);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `the fence must print exactly the run dir, got: ${result.stdout}`);
  const minted = fs.realpathSync(lines[0]);
  assert.notEqual(minted, fs.realpathSync(finished), 'the run dir must not be the finished one');
  assert.equal(path.dirname(minted), fs.realpathSync(pipelines), 'the minted dir must sit under the fixture pipelines root');
  assert.equal(pipelineEntries(pipelines).length, 2, 'exactly one new directory is minted');
  assert.equal(JSON.parse(fs.readFileSync(path.join(minted, 'run-state.json'), 'utf8')).createdBy, 'release-standalone', 'the fresh dir carries the release-standalone stamp');
});

// --- PIPELINE_RUN_DIR: only the directory the resolver actually returned from it is exempt (#3898) ---
// Step 1 returns before step 2's adoption refusal, so a supplied dir is inherited whatever its state; a stale
// value (a missing dir, an archived run-id) falls through to step 2 and is checked like any step-2 directory.
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
  assert.equal(lines.length, 1, `exempt: a PIPELINE_RUN_DIR directory must print only itself, got: ${result.stdout}`);
  assert.equal(fs.realpathSync(lines[0]), fs.realpathSync(supplied), 'exempt: the fence must keep the PIPELINE_RUN_DIR directory');
  assert.deepEqual(pipelineEntries(pipelines), before, 'exempt: no directory may be minted');
}

function assertStalePipelineRunDirIsChecked(fence) {
  const { repo, finished, pipelines } = finishedRunRepo();
  // Case (b): PIPELINE_RUN_DIR names a missing path, so step 2 meets the prior clean release dir and refuses it.
  const stale = path.join(pipelines, '2026-10-03T100000-never-created');
  const result = runInRepo(repo, fence, { PIPELINE_RUN_DIR: stale });
  assert.equal(result.status, 0, `stale: the fence must exit 0 (stderr: ${result.stderr})`);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `stale: the fence must print exactly the run dir, got: ${result.stdout}`);
  const minted = fs.realpathSync(lines[0]);
  assert.notEqual(minted, fs.realpathSync(finished), 'stale: a stale PIPELINE_RUN_DIR must still refuse the prior release dir the resolver falls through to');
  assert.equal(pipelineEntries(pipelines).length, 2, 'stale: exactly one new directory is minted');
}

test('AC4.1: Step 0 fence: a PIPELINE_RUN_DIR directory the resolver returns is inherited, never refused', () => {
  assertPipelineRunDirExemption(resolveFence(STEP_ZERO));
});

test('AC4.1: Step 0 fence: a stale PIPELINE_RUN_DIR falls through to step 2 and the prior release dir is refused', () => {
  assertStalePipelineRunDirIsChecked(resolveFence(STEP_ZERO));
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
  const pipelines = path.join(repo, '.claude-tweaks', 'pipelines');
  const first = runInRepo(repo, fence);
  assert.equal(first.status, 0, `${label}: first run exited ${first.status} (stderr: ${first.stderr})`);
  const firstLines = first.stdout.trim().split('\n');
  assert.equal(firstLines.length, 1, `${label}: the first run must print only its minted dir, got: ${first.stdout}`);
  const firstDir = fs.realpathSync(firstLines[0]);
  waitForNextSecond();
  const second = runInRepo(repo, fence);
  assert.equal(second.status, 0, `${label}: second run exited ${second.status} (stderr: ${second.stderr})`);
  const lines = second.stdout.trim().split('\n');
  assert.equal(lines.length, 1, `${label}: the second run must print exactly its run dir, got: ${second.stdout}`);
  assert.notEqual(fs.realpathSync(lines[0]), firstDir, `${label}: the second run must mint a different directory, not re-adopt the first run's`);
  assert.equal(pipelineEntries(pipelines).length, 2, `${label}: exactly one new directory is minted by the second run`);
}

test('AC1.1: Step 0 fence run twice without a close: the second run refuses the first run\'s active dir', () => {
  assertSecondRunRefusesFirst(resolveFence(STEP_ZERO), 'twice-live');
});

// #4151 AC2.1: the refusal is the resolver's, so release/SKILL.md carries no inline `node -e` adoption probe.
function assertNoInlineProbe(text) {
  assert.doesNotMatch(text, /node -e/, 'release/SKILL.md must not carry an inline node -e adoption probe — the refusal lives in resolve-run-dir step 2 (#4151)');
}

// The pre-#4151 guard line, frozen verbatim (SKILL.md line 60 at the parent commit).
const PRE_CHANGE_GUARD = 'if [ -n "$RUN_DIR" ] && PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}" ENV_RUN_DIR="$PIPELINE_RUN_DIR" node -e \'const { NON_TERMINAL } = require(process.env.PLUGIN_ROOT + "/bin/lib/hooks/run-integrity.js"); const real = (d) => { try { return require("fs").realpathSync(d); } catch { return null; } }; const e = real(process.env.ENV_RUN_DIR || ""); if (e !== null && e === real(process.argv[1])) process.exit(1); const r = JSON.parse(require("fs").readFileSync(process.argv[1] + "/run-state.json", "utf8")); const s = r.status; process.exit((typeof s === "string" && !NON_TERMINAL.has(s)) || r.createdBy === "release-standalone" ? 0 : 1)\' -- "$RUN_DIR" 2>/dev/null; then REFUSED_DIR=$RUN_DIR; RUN_DIR=; fi';

test('#4151 AC2.1: release/SKILL.md carries no inline node -e adoption probe', () => {
  assertNoInlineProbe(readText(SKILL));
});

test('#4151 AC2.1: the no-inline-probe check goes red on the pre-#4151 guard line', () => {
  assert.throws(() => assertNoInlineProbe(PRE_CHANGE_GUARD), /inline node -e adoption probe/);
});

// Step 2 now refuses a `clean` run's own directory, and wrap-up's close-run marks the run `clean`
// mid-flight, so wrap-up must carry its Phase-1 run-dir path instead of re-resolving it (#4151).
const WRAP_UP_CARRIED_PATH = [
  ['SKILL.md', /never re-runs the resolver/],
  ['cleanup-procedures-execution.md', /never re-resolved here/],
  ['standalone-fast-path.md', /never re-resolved/],
];

test('#4151: wrap-up carries its run-dir path past close-run instead of re-resolving it', () => {
  for (const [file, pattern] of WRAP_UP_CARRIED_PATH) {
    const text = readText(path.join(ROOT, 'plugin', 'skills', 'wrap-up', file));
    assert.match(text, pattern, `wrap-up/${file} must state that the run-dir path is carried, never re-resolved, after close-run (#4151)`);
    assert.doesNotMatch(text.replace(pattern, ''), pattern, `wrap-up/${file}: the carried-path statement should appear exactly once`);
  }
});

// The load-bearing prose facts of the refusal. The patterns match exactly once in Step 0, so
// removing the one match turns exactly that fact red.
const REQUIRED = [
  [/the only directory never subject to step 2's adoption refusal/, 'only the directory the resolver returned from PIPELINE_RUN_DIR is exempt from step 2\'s adoption refusal'],
  [/an archived run-id, falls through to step 2 and is checked like any step-2 directory\)/, 'a stale or archived PIPELINE_RUN_DIR falls through to step 2 and is checked like any step-2 directory'],
  [/except the `FAILED` lines `bookkeeping\.md` and `disposition\.md` hand-compose/, 'the never-hand-appended rule carves out the FAILED lines bookkeeping.md and disposition.md hand-compose'],
  [/status is terminal, or that carries `createdBy: "release-standalone"` whatever its status/, 'a terminal or release-standalone step-2 directory is refused whatever its status'],
  [/whose `run-state\.json` exists but cannot be read/, 'a step-2 directory whose run-state.json exists but cannot be read is refused'],
  [/the fallback then mints a fresh directory, and the run is \*\*created\*\*/, 'a refused directory is replaced by a fresh mint and the run is created'],
  [/neither terminal nor stamped by a release run/, 'a step-2 directory is inherited only while non-terminal and not release-standalone-created'],
  [/it already skips an `interrupted` one/, 'step 2 never hands over an interrupted directory to inherit'],
  [/carried `\{run-dir\}` path[\s\S]{0,200}mint a stray one/, 'later steps use the carried run dir and never re-run the fence'],
  [/could hand back an existing directory, which the `printf` stamp would then overwrite/, 'the mint call omits --spec-slug so step 2 cannot hand back a directory the printf stamp would overwrite'],
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
  assert.deepEqual(missingFacts(STEP_ZERO), [], 'Step 0 must state every fact of the finished-run refusal (#3898, #4151)');
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
  [/Any other read error on `staged\/`, or on the `decisions\.md` read below[\s\S]{0,120}is a failure, not an empty inventory[\s\S]{0,80}blocks archival/, 'inventory: a read error other than "does not exist" on staged/ or decisions.md is a failure that blocks archival'],
  [/With nothing to dispose and no read failure above, write one `SCANNED` line[\s\S]{0,200}A read failure is never "nothing"/, 'inventory: the SCANNED line is for a clean empty inventory only, never a read failure'],
  [/When Step 3 logged no `## \/review` marker this run[\s\S]{0,200}read no `decisions\.md` line at all/, 'inventory: with no Step 3 marker, no decisions.md line is read'],
  [/\| `reflect-` \|[^\n]*\| `proposal` \|/, 'roster: reflect- files are routed proposal'],
  [/\| `simplify-` \|[^\n]*\| `proposal` \|/, 'roster: simplify- files are routed proposal'],
  [/\| `deepen-` \|[^\n]*\| `proposal` \|/, 'roster: deepen- files are routed proposal'],
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
  [/A file on a `proposal` roster row \| The same Defer path and Defer-reason/, 'a file on a proposal roster row takes the same Defer path and Defer-reason'],
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
  [/An unreadable `staged\/` or `decisions\.md`[\s\S]{0,40}takes the same line with `read failed: \{message\}`[\s\S]{0,200}counts toward `\{k\} failed`/, 'an unreadable staged/ or decisions.md takes the FAILED line with read failed and counts toward k failed'],
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
  [/findings: \{f\} filed, \{d\} digest, \{x\} declined\{, k failed — \{paths\}\}, when disposition inventoried any finding or reported a failure\}/, 'the summary block carries the findings: line, failed paths included, rendered for a failure with no inventoried finding too'],
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

// --- Review staging roster: every staged/ prefix a review producer writes has one routed row (#4156) ---
// disposition.md's roster is the only place a staged prefix is named. The producer corpus is derived from its
// Staged by column, so a producer that starts staging a prefix with no row turns the corpus check red.
// The scan's limit: the corpus is plugin/skills/review/** plus the producers the roster names, so a producer in a
// skill directory no row names is not scanned.
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const ROSTER_HEADING = '### Review staging roster';
const ROUTES = ['confirmed', 'unconfirmed', 'contested', 'proposal', 'note', 'not staged by review'];
const tick = (s) => '`' + s + '`';
const unticked = (cell) => cell.replace(/`/g, '');
const readSkillFile = (rel) => readText(path.join(SKILLS, rel));

function cellsOf(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

// The roster table under its heading. Throws on a missing heading, no table, no rows, or a Route outside the
// closed set: a parse failure must never read as a table of zero rows.
function parseRoster(text) {
  const lines = text.split('\n');
  const at = lines.indexOf(ROSTER_HEADING);
  assert.notEqual(at, -1, `roster: disposition.md has no "${ROSTER_HEADING}" heading`);
  const table = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith('#')) break;
    if (!line.startsWith('|')) {
      if (table.length > 0) break;
      continue;
    }
    table.push(line);
  }
  assert.ok(table.length >= 2 && /^\|\s*-+/.test(table[1]), 'roster: no table with a header and a separator under the heading');
  assert.equal(unticked(cellsOf(table[0])[0]), 'Prefix', 'roster: the table header must start with Prefix');
  assert.ok(table.length > 2, `roster: the table under "${ROSTER_HEADING}" has no rows`);
  return table.slice(2).map((line) => {
    const cells = cellsOf(line);
    assert.equal(cells.length, 5, `roster: a row does not have the five columns: ${line}`);
    const prefix = unticked(cells[0]);
    const stagedBy = /`([^`]+)`/.exec(cells[2]);
    assert.ok(stagedBy, `roster row ${tick(prefix)} names no Staged by path`);
    const route = unticked(cells[4]);
    assert.ok(ROUTES.includes(route), `roster row ${tick(prefix)} has route "${route}", outside the closed set`);
    return { prefix, stagedBy: stagedBy[1], route };
  });
}

// The prefix a row covers at the start of a file name, or -1. `review-{n}` is the one placeholder form: `review-`
// then a number.
function prefixLength(prefix, fileName) {
  if (prefix === 'review-{n}') return /^review-\d/.test(fileName) ? 'review-'.length : -1;
  return fileName.startsWith(prefix) ? prefix.length : -1;
}

// The row whose prefix matches the file name the longest, or null when none does.
function classify(fileName, roster) {
  let best = null;
  let bestLength = -1;
  for (const row of roster) {
    const length = prefixLength(row.prefix, fileName);
    if (length > bestLength) {
      best = row;
      bestLength = length;
    }
  }
  return best;
}

// Every staged/{name} literal in a text as one concrete name: {md,patch} keeps its first form, {n}/{N}/{slug}
// become 1, * becomes x, and a sentence-ending period is dropped.
function stagedNamesIn(text) {
  return [...text.matchAll(/staged\/([a-zA-Z][\w{},.*-]*)/g)].map((m) => m[1]
    .replace(/\{([^{},]+),[^{}]*\}/g, '$1')
    .replace(/\{(?:n|N|slug)\}/g, '1')
    .replace(/\*/g, 'x')
    .replace(/\.$/, ''));
}

// Every .md under a directory, relative to plugin/skills/.
function mdUnder(relDir) {
  const found = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(SKILLS, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.md')) found.push(child);
    }
  };
  walk(relDir);
  return found;
}

// The producer corpus the roster names: every .md under review/, every .md under each other skill directory a row's
// Staged by names, and each named _shared/ file (not the whole _shared/ directory).
function corpusFor(roster) {
  const dirs = new Set(['review']);
  const files = new Set();
  for (const { stagedBy } of roster) {
    if (stagedBy.startsWith('_shared/')) files.add(stagedBy);
    else dirs.add(stagedBy.split('/')[0]);
  }
  const rels = new Set([...files, ...[...dirs].flatMap((d) => mdUnder(d))]);
  return [...rels].sort().map((file) => ({ file, text: readSkillFile(file) }));
}

// Each staged/ literal in the corpus that classifies to no roster row, as {file, name}.
function unroutedIn(corpus, roster) {
  return corpus.flatMap(({ file, text }) => stagedNamesIn(text)
    .filter((name) => classify(name, roster) === null)
    .map((name) => ({ file, name })));
}

function assertNoUnrouted(corpus, roster) {
  const unrouted = unroutedIn(corpus, roster);
  assert.deepEqual(unrouted, [], 'staged/ names with no roster row: ' + unrouted.map((u) => u.name + ' (in ' + u.file + ')').join(', '));
}

const routingTableLines = (text) => sliceBetween(text, '## Routing table', '## Approval').split('\n').filter((line) => line.startsWith('|'));

// The Routing table row whose Finding cell keys on the route word, or undefined.
function routingRowOf(text, route) {
  return routingTableLines(text).find((line) => cellsOf(line)[0].includes(tick(route)));
}

// Roster rows whose route no Routing table row keys on. A `note` row is keyed in the Inventory's exclusion sentence.
function unkeyedRows(roster, text) {
  const routingFindings = routingTableLines(text).map((line) => cellsOf(line)[0]);
  const exclusion = sliceBetween(text, '## Inventory', '## Routing table').split(/\n\s*\n/)
    .filter((p) => p.includes('which is not a finding')).join('\n');
  return roster
    .filter((row) => row.route !== 'not staged by review')
    .filter((row) => (row.route === 'note'
      ? !exclusion.includes(tick('note'))
      : !routingFindings.some((finding) => finding.includes(tick(row.route)))));
}

function assertKeyed(roster, text) {
  const gaps = unkeyedRows(roster, text).map((row) => row.prefix);
  assert.deepEqual(gaps, [], 'roster rows whose route no Routing table row keys on: ' + gaps.join(', '));
}

// Roster rows whose own Staged by file names no staged/ literal that classifies back to that row.
function unprovenRows(roster, readFile) {
  return roster.filter((row) => !stagedNamesIn(readFile(row.stagedBy)).some((name) => classify(name, roster) === row));
}

function assertProven(roster, readFile) {
  const gaps = unprovenRows(roster, readFile).map((row) => row.prefix);
  assert.deepEqual(gaps, [], 'roster rows whose Staged by file names no staged/ literal of that row: ' + gaps.join(', '));
}

// The roster row for a prefix, as its own line.
function rosterLine(text, prefix) {
  const line = text.split('\n').find((l) => l.startsWith('| ' + tick(prefix) + ' |'));
  assert.ok(line, `anchor: no roster row for ${prefix} — proof cannot discriminate`);
  return line;
}
const withoutRosterRow = (text, prefix) => text.replace(rosterLine(text, prefix) + '\n', '');
const withRosterRoute = (text, prefix, word) => {
  const line = rosterLine(text, prefix);
  return text.replace(line, line.replace(/`[^`]*` \|$/, tick(word) + ' |'));
};

function assertDesignDecisionRouted(text) {
  const row = classify('design-decision-1.md', parseRoster(text));
  assert.ok(row && row.route === 'proposal', 'design-decision-1.md must classify to a proposal roster row (#4156)');
  const routed = routingRowOf(text, 'proposal');
  assert.ok(routed && routed.includes('The same Defer path and Defer-reason'), 'the proposal routing row must carry "The same Defer path and Defer-reason"');
}

test('AC1: design-decision-1.md routes to a proposal row, which the Routing table defers', () => {
  assertDesignDecisionRouted(readDisposition());
});

test('AC1: classify pins the review prefixes and leaves an unknown prefix unrouted', () => {
  const roster = parseRoster(readDisposition());
  const expected = { 'review-3.patch': 'confirmed', 'review-unconfirmed-2.md': 'unconfirmed', 'review-debate-1.md': 'contested', 'visual-review-skipped.md': 'note' };
  for (const [name, route] of Object.entries(expected)) assert.equal((classify(name, roster) || {}).route, route, name);
  assert.equal(classify('brand-new-1.md', roster), null);
  assert.equal(classify('review-foo.md', roster), null);
});

test('AC1: parseRoster throws on a missing heading, an empty table and an unknown route', () => {
  assert.throws(() => parseRoster('no roster here'), /has no "### Review staging roster" heading/);
  assert.throws(() => parseRoster(`${ROSTER_HEADING}\n\n| Prefix | Example | Staged by | Counted as | Route |\n|---|---|---|---|---|\n\nnext`), /has no rows/);
});

// The roster prose the checks rely on, each clause pinned with its own go-red.
const ROSTER_PROSE = [
  [/`review-\{n\}` means `review-` followed by a number, so a `review-foo\.md` matches no row/, 'the roster says review-{n} is review- then a number, so review-foo.md matches no row'],
  [/matched against the review staging roster below by its longest matching prefix/, 'the Inventory matches every other staged file against the roster by its longest matching prefix'],
  [/A producer that starts staging a new prefix adds its roster row in the same change/, 'a producer that starts staging a new prefix adds its roster row in the same change'],
];

test('roster-vs-routing: the roster prose clauses the checks rely on are stated (with go-red)', () => {
  assertFactsAndGoRed(readDisposition(), ROSTER_PROSE, 'disposition.md must state the roster clauses (#4156)');
});

test('roster-vs-routing: every staged/ literal a review producer names classifies to a roster row', () => {
  const roster = parseRoster(readDisposition());
  assertNoUnrouted(corpusFor(roster), roster);
});

test('roster-vs-routing: every routed roster row is keyed in the Routing table (note in the Inventory exclusion)', () => {
  const text = readDisposition();
  assertKeyed(parseRoster(text), text);
});

test('roster-vs-routing: every roster row\'s Staged by file names a staged/ literal that classifies to that row', () => {
  assertProven(parseRoster(readDisposition()), readSkillFile);
});

test('roster-vs-routing go-red: a fake staged/ prefix appended to a corpus file is reported', () => {
  const roster = parseRoster(readDisposition());
  const doctored = corpusFor(roster).map((f, i) => (i === 0 ? { ...f, text: `${f.text}\nWrites \`staged/brand-new-{n}.md\`.\n` } : f));
  assert.throws(() => assertNoUnrouted(doctored, roster), /brand-new-1\.md \(in /);
});

test('roster-vs-routing go-red: deleting the design-decision- row reports its producer unrouted', () => {
  const text = readDisposition();
  const corpus = corpusFor(parseRoster(text));
  const withoutDesignDecision = parseRoster(withoutRosterRow(text, 'design-decision-'));
  assert.throws(() => assertNoUnrouted(corpus, withoutDesignDecision), /design-decision-x\.md \(in design-wrapper\/modes\/review\.md\)/);
  assert.throws(() => assertDesignDecisionRouted(withoutRosterRow(text, 'design-decision-')), /design-decision-1\.md must classify/);
});

test('roster-vs-routing go-red: an unknown route word makes parseRoster throw', () => {
  assert.throws(() => parseRoster(withRosterRoute(readDisposition(), 'design-decision-', 'not-a-route')), /outside the closed set/);
});

test('roster-vs-routing go-red: removing the proposal routing row trips the keyed check', () => {
  const text = readDisposition();
  const doctored = text.replace(routingRowOf(text, 'proposal') + '\n', '');
  assert.notEqual(doctored, text, 'anchor: the proposal routing row not found — proof cannot discriminate');
  assert.throws(() => assertKeyed(parseRoster(doctored), doctored), /design-decision-/);
});

test('roster-vs-routing go-red: a stale producer name trips the Staged by check', () => {
  const stale = (rel) => (rel === 'visual-review/SKILL.md' ? readSkillFile(rel).replace(/staged\/visual-review-/g, 'staged/vr-') : readSkillFile(rel));
  assert.throws(() => assertProven(parseRoster(readDisposition()), stale), /visual-review-/);
});
