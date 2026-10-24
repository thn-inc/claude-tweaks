// tests/release-run-dir-lifecycle-conformance.test.js — pins #3898: /release Step 0 adopted the most
// recent matching run directory at step 2 of run-dir-resolution whatever its run-state.json said, so a
// later release inherited a finished release run's directory (status clean/closed) — and the new run's
// decisions, config and staged proposals landed in a directory already archived or closed out. Step 0
// now refuses a step-2 directory whose status is terminal (anything outside run-integrity.js's
// NON_TERMINAL), mints a fresh one, and classifies the run as created. The guard is extracted from the
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
const GUARD_LINE_PREFIX = 'if [ -n "$RUN_DIR" ] && [ -z "$PIPELINE_RUN_DIR" ] &&';
function extractGuard(stepZero) {
  const line = resolveFence(stepZero).split('\n').find((l) => l.startsWith(GUARD_LINE_PREFIX));
  assert.ok(line, `extraction pattern is out of sync: no Step 0 fence line starts with ${GUARD_LINE_PREFIX}`);
  const from = line.indexOf('PLUGIN_ROOT=');
  const to = line.lastIndexOf('; then');
  assert.ok(from !== -1 && to > from, 'extraction pattern is out of sync: the guard line has no "PLUGIN_ROOT=" ... "; then" span');
  return line.slice(from, to);
}

const STEP_ZERO = stepZeroOf(readText(SKILL));

// Runs the guard against a fixture dir; PIPELINE_RUN_DIR is deleted so the caller's env never decides.
function runGuard(guard, dir) {
  const env = { ...process.env, RUN_DIR: dir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  delete env.PIPELINE_RUN_DIR;
  return spawnSync('bash', ['-c', guard], { env, encoding: 'utf8' });
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
];

test('AC1.1: Step 0 guard classifies run-state status', () => {
  const guard = extractGuard(STEP_ZERO);
  for (const [label, name, runState, expected] of ROWS) {
    const result = runGuard(guard, fixture(name, runState));
    assert.equal(result.status, expected, `${label}: expected exit ${expected}, got ${result.status} (stderr: ${result.stderr})`);
  }
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

// A real repo whose only run directory is a finished release run — the shape #3898 reproduced.
const FINISHED_RUN_ID = '2026-10-01T100000-release-standalone';
function finishedRunRepo(name) {
  const repo = path.join(scratch, name);
  fs.mkdirSync(repo, { recursive: true });
  const init = spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' });
  assert.equal(init.status, 0, `repo init failed: ${init.stderr}`);
  const finished = path.join(repo, '.claude-tweaks', 'pipelines', FINISHED_RUN_ID);
  fs.mkdirSync(finished, { recursive: true });
  fs.writeFileSync(path.join(finished, 'run-state.json'), '{"status":"clean"}');
  return { repo, finished, pipelines: path.dirname(finished) };
}

function runInRepo(repo, script) {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  delete env.PIPELINE_RUN_DIR;
  delete env.RUN_DIR;
  return spawnSync('bash', ['-c', script], { cwd: repo, env, encoding: 'utf8' });
}

// After the guard refuses the finished dir, the mint line must produce a different, newly created dir.
function assertMintIsFresh(mintLine, label) {
  const { repo, finished, pipelines } = finishedRunRepo(label);
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
  const { repo, finished, pipelines } = finishedRunRepo('fence-e2e');
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

// The load-bearing prose facts of the refusal. The patterns match exactly once in Step 0, so
// removing the one match turns exactly that fact red.
const REQUIRED = [
  [/\[ -z "\$PIPELINE_RUN_DIR" \]/, 'the guard is skipped for a $PIPELINE_RUN_DIR-supplied directory'],
  [/finished release run \(status \{status\}\) — not adopted; minted \{run-dir\}/, 'the refusal log line names the refused dir, its status and the minted dir'],
  [/status is terminal[\s\S]{0,300}\*\*created\*\*/, 'a terminal step-2 directory is refused and the run is created'],
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
  [/release-held\.md[\s\S]{0,160}not a finding/, 'release-held.md is not a finding'],
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
];

for (const [name, patterns] of [
  ['AC3.1: disposition.md states the scope and inventory', DISPOSITION_SCOPE],
  ['AC3.1: disposition.md routing table', DISPOSITION_ROUTING],
  ['AC3.1: disposition.md approval and logging', DISPOSITION_APPROVAL],
]) {
  test(name, () => {
    const text = readDisposition();
    const missingOf = missingFactsOf(patterns);
    assert.deepEqual(missingOf(text), [], `${name} must state every fact (#3898)`);
    assertEachPatternGoesRed(text, patterns, missingOf);
  });
}

const STEP8_WIRING = [
  [/disposition\.md/, 'Step 8 reads disposition.md'],
  [/findings: \{f\} filed, \{d\} digest, \{x\} declined/, 'the summary block carries the findings: line'],
  [/hooks\.js" archive-run --run "\{run-dir\}"/, 'Step 8 runs archive-run on the run dir'],
  // Grouped: an ungrouped `a|Step 0` alternation would match any "Step 0" in the section and could never go red.
  [/archive-run refused[\s\S]{0,200}(?:not adopted|Step 0)/, 'a refusal is non-fatal because Step 0 never adopts a terminal directory'],
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
  const missingOf = missingFactsOf(STEP8_WIRING);
  assert.deepEqual(missingOf(stepEight), [], 'Step 8 must wire disposition.md, the findings: line and archive-run (#3898)');
  assertEachPatternGoesRed(stepEight, STEP8_WIRING, missingOf);
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
  [/condition: inherited run directory → fallback: the parent's Review Console owns staged\//, 'an inherited directory is never disposed: the SKIP line'],
];

test('AC4.1: an inherited run directory is never closed, archived or disposed', () => {
  const stepEight = stepEightOf(readText(SKILL));
  const stepEightMissing = missingFactsOf(STEP8_INHERITED);
  assert.deepEqual(stepEightMissing(stepEight), [], 'Step 8 must leave an inherited directory unclosed and unarchived');
  assertEachPatternGoesRed(stepEight, STEP8_INHERITED, stepEightMissing);
  const text = readDisposition();
  const dispositionMissing = missingFactsOf(DISPOSITION_INHERITED);
  assert.deepEqual(dispositionMissing(text), [], 'disposition.md must write the SKIP line for an inherited directory');
  assertEachPatternGoesRed(text, DISPOSITION_INHERITED, dispositionMissing);
});
