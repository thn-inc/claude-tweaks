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

// The load-bearing prose facts of the refusal. The patterns match exactly once in Step 0, so
// removing the one match turns exactly that fact red.
const REQUIRED = [
  [/\[ -z "\$PIPELINE_RUN_DIR" \]/, 'the guard is skipped for a $PIPELINE_RUN_DIR-supplied directory'],
  [/finished release run \(status \{status\}\) — not adopted; minted \{run-dir\}/, 'the refusal log line names the refused dir, its status and the minted dir'],
  [/status is terminal[\s\S]{0,200}\*\*created\*\*/, 'a terminal step-2 directory is refused and the run is created'],
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
