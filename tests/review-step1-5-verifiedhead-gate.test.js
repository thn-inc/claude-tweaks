// tests/review-step1-5-verifiedhead-gate.test.js — #2003: pins Step 1.5's `/flow` pipeline
// branch (code-mode-steps.md) as gating its proceed/re-trigger decision on `verifiedHead`,
// not bare `match` — the design #1923 already shipped (a scoped pass on a dirtied tree
// satisfies verification instead of forcing a full re-trigger forever). This record adds only
// the missing conformance pin; no behavior change.
//
// Per skill-prose-conformance-tests' frozen-fixture convention, the pre-#1923 control below is
// a hand-built string literal (never read from git history) reproducing the *shape* of what
// Step 1.5 read before #1923 shipped `verifiedHead`: a bare scope-blind `match` field, with no
// `verifiedHead` distinction at all. A pattern naming `verifiedHead` correctly does NOT match
// this control, proving the pin can go red.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const CODE_MODE_STEPS = readText(path.join(ROOT, 'plugin', 'skills', 'review', 'code-mode-steps.md'));

// Hand-built pre-#1923 control (not read from git history): Step 1.5's `/flow` pipeline branch
// gated on the strict, scope-blind `match` field alone -- no `verifiedHead` field existed yet.
const PRE_1923_STEP_1_5_FLOW_BRANCH = `Check for \`TEST_PASSED=true\` in pipeline context. If present, add one belt-and-braces read of the runner's own artifact (#1921) -- \`node "\${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --stamp-status\` (one plain command; prints \`{present, sha, head, dirty, scope, fullSha, match, reportPath, legacy}\`, exit 0 always). \`match: true\` -> proceed to Step 2. \`match: false\` with \`TEST_PASSED=true\` is reported, never silently accepted: "TEST_PASSED set but the runner stamp does not match HEAD ({stamp-sha} vs {head}) -- re-running \`/claude-tweaks:test\`", then re-trigger \`/claude-tweaks:test\` once and re-check.`;

function assertPinned(pattern, message) {
  assert.match(CODE_MODE_STEPS, pattern, message);
  assert.doesNotMatch(PRE_1923_STEP_1_5_FLOW_BRANCH, pattern, `${message} (must NOT match the pre-#1923 match-only control — proves the pattern can go red)`);
}

test("Step 1.5's /flow pipeline branch prints the full --stamp-status envelope, baselineAdjudicated included (#3043)", () => {
  assertPinned(/\{present, sha, head, dirty, scope, fullSha, match, verifiedHead, baselineAdjudicated, preExistingAdjudicated, reportPath, legacy, suiteComposed, generatedExempt, liveGeneratedExempt, scopeError\}/, 'the envelope names baselineAdjudicated and every field --stamp-status prints');
});

test("Step 1.5's /flow pipeline branch gates the proceed decision on verifiedHead: true, not bare match", () => {
  assertPinned(/verifiedHead: true[\s\S]{0,260}proceed to Step 2/, 'verifiedHead: true routes to proceed');
});

test("Step 1.5's /flow pipeline branch gates the re-trigger decision on verifiedHead: false (with TEST_PASSED=true), not bare match: false", () => {
  assertPinned(/`verifiedHead: false` with `TEST_PASSED=true` is reported, never silently accepted/, 'verifiedHead: false + TEST_PASSED=true is the reported/re-trigger condition');
});

test("Step 1.5's runner-stamp read prints a verifiedHead field distinct from bare match", () => {
  assertPinned(/\{present, sha, head, dirty, scope, fullSha, match, verifiedHead, baselineAdjudicated, preExistingAdjudicated, reportPath, legacy, suiteComposed, generatedExempt, liveGeneratedExempt, scopeError\}/, 'the printed stamp-status envelope is the full field list --stamp-status prints, match and verifiedHead as distinct fields');
});

test("Step 1.5 states why match alone is insufficient (would re-trigger a scoped run forever), citing #1923", () => {
  assertPinned(/match` alone would re-trigger a scoped run forever, #1923/, 'cites the #1923 rationale for gating on verifiedHead instead of match');
});

test("Step 1.5's own Gate table rows key on verifiedHead for both the pipeline proceed and re-trigger outcomes", () => {
  // #3013 qualified the proceed row with the PR-check gate; it still keys on verifiedHead: true.
  assert.match(CODE_MODE_STEPS, /`TEST_PASSED=true` \(pipeline\) \+ runner stamp `verifiedHead: true` \+ `pr-checks\.js` not `red` \| Proceed to Step 2/, 'Gate table proceed row keys on verifiedHead: true');
  assert.match(CODE_MODE_STEPS, /`TEST_PASSED=true` \(pipeline\) \+ runner stamp `verifiedHead: false` \| Report it/, 'Gate table re-trigger row keys on verifiedHead: false');
});

test('#4809: Step 1.5 Gate table splits red on an explicit merge-verification: off (the shared red bullet is pinned by merge-verification-gate-conformance)', () => {
  assert.match(CODE_MODE_STEPS, /\| `pr-checks\.js` reports `red` and `merge-verification` is not an explicit `off` \(`_shared\/pr-check-gate\.md`'s `red` bullet\) \| \*\*STOP\*\*/);
  assert.match(CODE_MODE_STEPS, /\| `TEST_PASSED=true` \(pipeline\) \+ runner stamp `verifiedHead: true` \+ `pr-checks\.js` reports `red` under an explicit `merge-verification: off` \(same bullet\) \| Proceed to Step 2 — with the caveat naming the failing checks, logged as that bullet's `AUTO` line \|/);
  // The pipeline paragraph above the table must carry the same carve-out, or it contradicts row 3.
  assert.ok(CODE_MODE_STEPS.includes("proceed to Step 2 unless it is `red` and `merge-verification` is not an explicit `off` (Gate table below)"), "pipeline prose names the explicit-off carve-out");
});

// Frozen pre-#4395 Gate rows (hand-built): the re-trigger row named no terminal outcome.
const PRE_4395_GATE_ROWS = `| \`TEST_PASSED=true\` (pipeline) + runner stamp \`verifiedHead: false\` | Report it (stamp sha/scope vs HEAD), re-trigger \`/claude-tweaks:test\`, re-check |
| Runner stamp \`verifiedHead: true\` (standalone) | Proceed to Step 2 |
| \`/claude-tweaks:test\` triggered and passes | Proceed to Step 2 |`;

// Frozen pre-#4395 pipeline-paragraph tail (hand-built): every verifiedHead: false re-triggered.
const PRE_4395_PIPELINE_TAIL = `(Gate table below). \`verifiedHead: false\` with \`TEST_PASSED=true\` is reported, never silently accepted: "TEST_PASSED set but the runner stamp does not verify HEAD ({stamp-sha}, {scope} vs {head}) — re-running \`/claude-tweaks:test\`", then re-trigger \`/claude-tweaks:test\` once and re-check.`;

const ZERO_TEST_PREFIX = '| `TEST_PASSED=true` (pipeline) + stamp `present: false` + no verification commands';
const RETRIGGER_PREFIX = '| `TEST_PASSED=true` (pipeline) + runner stamp `verifiedHead: false` |';
const STOP_PREFIX = '| That re-check still reads `verifiedHead: false` |';
const ZERO_TEST_LOG = 'AUTO {time} — review Step 1.5: no verification commands configured; zero-test pass accepted without a runner stamp. Reversibility: high.';
const PIPELINE_CARVE_OUT = '`present: false` with no commands configured takes the zero-test row (Gate table below); any other `verifiedHead: false` with `TEST_PASSED=true` is reported, never silently accepted';

function rowOf(text, prefix) {
  return text.split('\n').find((l) => l.startsWith(prefix));
}

// Replace `from` with `to` on the one CODE_MODE_STEPS row that starts with `prefix`.
function mutateRow(prefix, from, to) {
  return CODE_MODE_STEPS.split('\n').map((l) => (l.startsWith(prefix) ? l.replace(from, to) : l)).join('\n');
}

function assertZeroTestRow(text) {
  const row = rowOf(text, ZERO_TEST_PREFIX);
  assert.ok(row, 'zero-test row missing');
  assert.ok(row.includes(ZERO_TEST_LOG), 'zero-test row must log the record\'s AUTO line verbatim');
  assert.ok(row.includes('log to `decisions.md` `AUTO'), 'zero-test row must name decisions.md as the log destination');
  assert.ok(row.includes('No re-trigger'), 'zero-test row must not re-trigger');
  assert.ok(row.includes('`pr-checks.js` read'), 'zero-test row must run the pr-checks read');
  assert.ok(row.includes('`verify-scope.json` `checks`'), 'zero-test row must key on verify-scope checks being absent');
  assert.ok(row.includes('+ `scopeError` null |'), 'zero-test row must require a readable declaration (scopeError null), so an unread checks list never counts as none');
  assert.ok(row.includes('via `log-decision.js --section "/review"`'), 'zero-test row must write its AUTO line through the sanctioned log-decision writer');
  assert.ok(text.indexOf(row) < text.indexOf(RETRIGGER_PREFIX), 'zero-test row must precede the re-trigger row');
}

function assertStopRow(text) {
  const row = rowOf(text, STOP_PREFIX);
  assert.ok(row, 'terminal row missing');
  assert.match(row, /\*\*STOP\*\*/, 'terminal row must stop');
  assert.ok(row.includes('never a second re-trigger'), 'terminal row must forbid a second re-trigger');
  assert.ok(row.includes('`dirty: true` with the dirty paths'), 'terminal row must name a dirty tree with its paths');
  assert.ok(row.includes('a `scopeError`'), 'terminal row must name scopeError');
  assert.ok(row.includes('`{sha} ({scope}) ≠ {head}`'), 'terminal row must name a stamp/HEAD mismatch');
  assert.ok(row.includes('`present: false` with commands configured'), 'terminal row must name a missing stamp with commands configured');
  assert.ok(row.endsWith(', else the stamp as read (`sha`, `scope`, `fullSha`) |'), 'terminal row must end with the stamp-as-read catch-all');
  assert.ok(!/Exception|zero-test|bookkeeping/.test(row), 'terminal row must carry no exception clause');
}

function assertPipelineCarveOut(text) {
  const at = text.indexOf(PIPELINE_CARVE_OUT);
  assert.ok(at !== -1, 'pipeline paragraph must send present: false with no commands to the zero-test row');
  assert.ok(at < text.indexOf('then re-trigger `/claude-tweaks:test` once and re-check.'), 'the carve-out must precede the re-trigger sentence');
  assert.ok(text.includes('then re-trigger `/claude-tweaks:test` once and re-check. An unparseable read is `verifiedHead: false`.'), 'the pipeline paragraph must treat an unparseable stamp read as verifiedHead: false');
}

test('AC2.1: Step 1.5 has its own zero-test Gate row, ahead of any re-trigger (#4395)', () => {
  assertZeroTestRow(CODE_MODE_STEPS);
  assert.throws(() => assertZeroTestRow(PRE_4395_GATE_ROWS), /zero-test row missing/);
});

test('AC2.1: each zero-test-row clause goes red on its own (#4395)', () => {
  const cases = [
    [ZERO_TEST_LOG, /AUTO line verbatim/],
    ['to `decisions.md` ', /decisions.md as the log destination/],
    ['No re-trigger', /must not re-trigger/],
    ['`pr-checks.js` read', /pr-checks read/],
    ['`verify-scope.json` `checks`', /verify-scope checks/],
    ['+ `scopeError` null |', /readable declaration \(scopeError null\)/],
    ['via `log-decision.js --section "/review"`', /sanctioned log-decision writer/],
  ];
  for (const [clause, message] of cases) {
    const mutated = mutateRow(ZERO_TEST_PREFIX, clause, 'xxx');
    assert.notEqual(mutated, CODE_MODE_STEPS, clause);
    assert.throws(() => assertZeroTestRow(mutated), message);
  }
  // Order check: the zero-test row must precede the re-trigger row.
  const lines = CODE_MODE_STEPS.split('\n');
  const zeroAt = lines.findIndex((l) => l.startsWith(ZERO_TEST_PREFIX));
  const retriggerAt = lines.findIndex((l) => l.startsWith(RETRIGGER_PREFIX));
  const swapped = lines.slice();
  [swapped[zeroAt], swapped[retriggerAt]] = [swapped[retriggerAt], swapped[zeroAt]];
  const mutatedOrder = swapped.join('\n');
  assert.notEqual(mutatedOrder, CODE_MODE_STEPS, 'swapped rows');
  assert.throws(() => assertZeroTestRow(mutatedOrder), /precede the re-trigger row/);
});

test('AC2.1: the pipeline paragraph routes a zero-test project to its row before the re-trigger sentence (#4395)', () => {
  assertPipelineCarveOut(CODE_MODE_STEPS);
  assert.throws(() => assertPipelineCarveOut(PRE_4395_PIPELINE_TAIL), /zero-test row/);
  const mutated = CODE_MODE_STEPS.replace('takes the zero-test row (Gate table below); any other ', '');
  assert.notEqual(mutated, CODE_MODE_STEPS);
  assert.throws(() => assertPipelineCarveOut(mutated), /zero-test row/);
  // Order check: the carve-out string must appear before the re-trigger sentence, not only after it.
  const afterRetrigger = CODE_MODE_STEPS
    .replace(PIPELINE_CARVE_OUT, 'CARVE')
    .replace('then re-trigger `/claude-tweaks:test` once and re-check.', `then re-trigger \`/claude-tweaks:test\` once and re-check. ${PIPELINE_CARVE_OUT}`);
  assert.notEqual(afterRetrigger, CODE_MODE_STEPS);
  assert.throws(() => assertPipelineCarveOut(afterRetrigger), /precede the re-trigger sentence/);
  const withoutUnparseable = CODE_MODE_STEPS.replace(' An unparseable read is `verifiedHead: false`.', '');
  assert.notEqual(withoutUnparseable, CODE_MODE_STEPS);
  assert.throws(() => assertPipelineCarveOut(withoutUnparseable), /unparseable stamp read as verifiedHead: false/);
});

test('AC2.1: a re-check still reading verifiedHead: false is a named-cause STOP that never loops (#4395)', () => {
  assertStopRow(CODE_MODE_STEPS);
  assert.throws(() => assertStopRow(PRE_4395_GATE_ROWS), /terminal row missing/);
});

test('AC2.1: each STOP-row clause goes red on its own (#4395)', () => {
  const cases = [
    ['**STOP**', /terminal row must stop/],
    ['never a second re-trigger', /forbid a second re-trigger/],
    ['`dirty: true` with the dirty paths', /dirty tree with its paths/],
    ['a `scopeError`', /name scopeError/],
    ['`{sha} ({scope}) ≠ {head}`', /stamp\/HEAD mismatch/],
    ['`present: false` with commands configured', /missing stamp with commands configured/],
    ['the stamp as read', /stamp-as-read catch-all/],
    ['`fullSha`', /stamp-as-read catch-all/],
  ];
  for (const [clause, message] of cases) {
    const mutated = mutateRow(STOP_PREFIX, clause, 'xxx');
    assert.notEqual(mutated, CODE_MODE_STEPS, clause);
    assert.throws(() => assertStopRow(mutated), message);
  }
  const withException = mutateRow(STOP_PREFIX, 'name the cause:', 'name the cause: Exception: ');
  assert.notEqual(withException, CODE_MODE_STEPS, 'Exception injection');
  assert.throws(() => assertStopRow(withException), /no exception clause/);
  const withZeroTest = mutateRow(STOP_PREFIX, 'name the cause:', 'name the cause: zero-test row aside,');
  assert.notEqual(withZeroTest, CODE_MODE_STEPS, 'zero-test injection');
  assert.throws(() => assertStopRow(withZeroTest), /no exception clause/);
  const withBookkeeping = mutateRow(STOP_PREFIX, 'name the cause:', 'name the cause: a tree dirty only with bookkeeping paths passes,');
  assert.notEqual(withBookkeeping, CODE_MODE_STEPS, 'bookkeeping-exemption injection');
  assert.throws(() => assertStopRow(withBookkeeping), /no exception clause/);
});

test('AC2.1: the re-trigger row fires once and the trigger-and-pass row is scoped to standalone (#4395)', () => {
  assert.ok(rowOf(CODE_MODE_STEPS, RETRIGGER_PREFIX).includes('re-trigger `/claude-tweaks:test` once, re-check'));
  assert.ok(!rowOf(PRE_4395_GATE_ROWS, RETRIGGER_PREFIX).includes('once'));
  assert.ok(CODE_MODE_STEPS.includes('| `/claude-tweaks:test` triggered (standalone) and passes | Proceed to Step 2 |'));
  assert.ok(!CODE_MODE_STEPS.includes('| `/claude-tweaks:test` triggered and passes |'));
  assert.ok(PRE_4395_GATE_ROWS.includes('| `/claude-tweaks:test` triggered and passes |'));
});
