'use strict';
// #4620: the Review Console's short-circuit pre-check resolves the ceiling through
// `console-resolve.js --ceiling`. Reads live prose: the section is the declared contract
// console-resolve.js executes, so editing it is the intended response to a contract change
// (the [IL-80] carve-out). Each assertion is proved red on a mutated copy of the live text.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const REVIEW_CONSOLE = readText(path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up', 'review-console.md'));
const HEADING = '## Auto-resolution short-circuit';

function section(text) {
  const start = text.indexOf(`\n${HEADING}`);
  assert.notStrictEqual(start, -1, `heading not found: ${HEADING}`);
  const end = text.indexOf('\n## ', start + HEADING.length + 1);
  assert.notStrictEqual(end, -1, `no section after: ${HEADING}`);
  return text.slice(start, end);
}

// `--ceiling` leads the flags so the one-`console-resolve.js" --run` pin in console-resolve-conformance.test.js still holds.
const NEW_COMMAND = 'console-resolve.js" --ceiling --run "$PIPELINE_RUN_DIR"';
const OLD_COMMAND = 'resolve-policy.js" --values --run "$PIPELINE_RUN_DIR" autonomy';

function ceilingProblems(text) {
  const s = section(text);
  const problems = [];
  if (!s.includes(NEW_COMMAND)) problems.push('the short-circuit pre-check does not resolve the ceiling through console-resolve.js --ceiling');
  if (s.includes(OLD_COMMAND)) problems.push('the short-circuit pre-check still resolves the ceiling through resolve-policy.js autonomy');
  return problems;
}

test('AC1.1: the short-circuit pre-check resolves the ceiling through console-resolve.js --ceiling', () => {
  assert.deepStrictEqual(ceilingProblems(REVIEW_CONSOLE), []);
});

test('AC1.1 go-red: dropping the new command is caught with its own message', () => {
  const mutated = REVIEW_CONSOLE.split(NEW_COMMAND).join('console-resolve.js" --policy console-auto --run "$PIPELINE_RUN_DIR"');
  assert.deepStrictEqual(ceilingProblems(mutated), ['the short-circuit pre-check does not resolve the ceiling through console-resolve.js --ceiling']);
});

test('AC1.1 go-red: restoring the old command is caught with its own message', () => {
  const mutated = REVIEW_CONSOLE.replace(HEADING, `${HEADING}\n\n\`${OLD_COMMAND}\``);
  assert.deepStrictEqual(ceilingProblems(mutated), ['the short-circuit pre-check still resolves the ceiling through resolve-policy.js autonomy']);
});

// #4620 Task 8: run-end residue converges through console-resolve.js --converge under control mode.
const LEDGER_FORMAT = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'ledger-format.md'));
const NARROWING = '#### Ledger narrowing';
const TABLE_INTRO = '\nAfter Phase 1 (and, when the capability';

function narrowingSlice(text) {
  const start = text.indexOf(NARROWING);
  assert.notStrictEqual(start, -1, `heading not found: ${NARROWING}`);
  const end = text.indexOf(TABLE_INTRO, start);
  assert.notStrictEqual(end, -1, 'the Phase 2 table introduction was not found after the narrowing heading');
  return text.slice(start, end);
}

const LEDGER_CLAIMS = [
  ['--converge "{file}"', 'the narrowing section does not route open items through console-resolve.js --converge'],
  ['`control-mode on`', 'the narrowing section does not gate the convergence on `control-mode on`'],
  ['BEFORE writing any `carried` row', 'the narrowing section does not order --converge before any carried row'],
  ['- `filed`:', 'the narrowing section does not handle the filed state'],
  ['- `digested`:', 'the narrowing section does not handle the digested state'],
  ['- `carried`:', 'the narrowing section does not handle the carried state'],
  ['Generic gate failure', 'the narrowing section does not stop a failed convergence with the Generic gate failure card'],
  ['Exit 2, 3 or 6', 'the narrowing section does not route exits 2 and 3 to the failure card'],
];

function convergeProblems(text) {
  const s = narrowingSlice(text);
  return LEDGER_CLAIMS.filter(([needle]) => !s.includes(needle)).map(([, message]) => message);
}

test('AC2.1: ledger-format.md routes every open item through --converge under control mode', () => {
  assert.deepStrictEqual(convergeProblems(LEDGER_FORMAT), []);
});

for (const [needle, message] of LEDGER_CLAIMS) {
  test(`AC2.1 go-red: ${message}`, () => {
    const s = narrowingSlice(LEDGER_FORMAT);
    const mutated = LEDGER_FORMAT.replace(s, s.split(needle).join('[removed]'));
    assert.deepStrictEqual(convergeProblems(mutated), [message]);
  });
}

const STEP_10 = '10. **Reflection insights';

function step10Line(text) {
  const line = text.split('\n').find((l) => l.startsWith(STEP_10));
  assert.ok(line, `step not found: ${STEP_10}`);
  return line;
}

const STEP_10_CLAIMS = [
  ['--converge', 'step 10 does not converge a refused insight with --converge'],
  ["source: 'insight'", "step 10 does not converge a refused insight as source: 'insight'"],
  ["id: 'insight-{row}'", "step 10 does not give an insight item the id insight-{row}"],
  ["status: 'open'", "step 10 does not give an insight item status 'open'"],
  ["Recommended-cell reason", "step 10 does not source an insight's deferReason from its Recommended cell"],
  ['writes no ledger row', 'step 10 does not say an insight writes no ledger row'],
  ['as step 7 creates a `Q#`', 'step 10 does not create a filed insight the way step 7 creates a Q#'],
  ['`carried` → nothing more', 'step 10 does not settle a carried insight with nothing more'],
  ['`digested` → the digest entry only', 'step 10 does not settle a digested insight with the digest entry only'],
  ['exit 2, 3 or 6', 'step 10 does not route exits 2, 3 and 6 to the failure card'],
];

function step10Problems(text) {
  const line = step10Line(text);
  return STEP_10_CLAIMS.filter(([needle]) => !line.includes(needle)).map(([, message]) => message);
}

test('AC2.1: review-console.md step 10 converges a refused insight under control mode', () => {
  assert.deepStrictEqual(step10Problems(REVIEW_CONSOLE), []);
});

for (const [needle, message] of STEP_10_CLAIMS) {
  test(`AC2.1 go-red: ${message}`, () => {
    const line = step10Line(REVIEW_CONSOLE);
    const mutated = REVIEW_CONSOLE.replace(line, line.split(needle).join('[removed]'));
    assert.deepStrictEqual(step10Problems(mutated), [message]);
  });
}

// The digested row the narrowing paragraph prescribes must be one the real ledger writer and reader
// treat as complete: accepted by checkLedgerStatus, and counted by parseLedger as neither open,
// an incomplete deferral, nor a build row missing its Defer-reason — on both work backends.
const { checkLedgerStatus } = require(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'stage-item', 'ledger'));
const { parseLedger } = require(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'wrap-up', 'pack'));
const DIGEST_ALTERNATIVES = '{digest comment URL | specs/digest.md}';
const BACKEND_LOCATIONS = ['https://github.com/o/r/issues/9#issuecomment-123', 'specs/digest.md'];

function digestedRowProblems(text) {
  const bullet = narrowingSlice(text).split('\n').find((l) => l.startsWith('- `digested`:'));
  if (!bullet) return ['no digested bullet'];
  const m = /write the row `(\w+)`(?: \(`([^`]+)`\)| with Resolution `([^`]+)`)/.exec(bullet);
  if (!m) return ['the digested bullet prescribes no row status and Resolution'];
  const status = m[1];
  const template = m[3] || m[2];
  const problems = [];
  for (const location of BACKEND_LOCATIONS) {
    const resolution = template.split(DIGEST_ALTERNATIVES).join(location);
    const check = checkLedgerStatus(status, resolution, {});
    if (check.refusal !== null || check.incompleteDeferral) problems.push(`the ledger writer does not accept the digested row for ${location}`);
    const parsed = parseLedger(`| # | Phase | Item | Status | Resolution |\n|---|---|---|---|---|\n| 1 | build | a typo | ${status} | ${resolution} |\n`);
    if (parsed.open + parsed.deferredUnstaged + parsed.missingDeferReason + parsed.unrecognized !== 0) problems.push(`parseLedger counts the digested row for ${location} as blocking`);
  }
  return problems;
}

test('AC4.7: the digested ledger row is complete for the real writer and reader on both backends', () => {
  assert.deepStrictEqual(digestedRowProblems(LEDGER_FORMAT), []);
});

test('AC4.7 go-red: the old `deferred` (`→ digest`) row is refused by the ledger writer', () => {
  const s = narrowingSlice(LEDGER_FORMAT);
  const bullet = s.split('\n').find((l) => l.startsWith('- `digested`:'));
  const old = '- `digested`: append the digest entry per `_shared/materiality-floor.md`, and write the row `deferred` (`→ digest`).';
  const mutated = LEDGER_FORMAT.replace(bullet, old);
  assert.deepStrictEqual(digestedRowProblems(mutated), BACKEND_LOCATIONS.flatMap((l) => [`the ledger writer does not accept the digested row for ${l}`, `parseLedger counts the digested row for ${l} as blocking`]));
});

test('AC4.7 go-red: a deferred digest row carrying only a Defer-reason is an incomplete deferral', () => {
  const bullet = narrowingSlice(LEDGER_FORMAT).split('\n').find((l) => l.startsWith('- `digested`:'));
  const mutated = LEDGER_FORMAT.replace(bullet, '- `digested`: write the row `deferred` with Resolution `→ digest at {digest comment URL | specs/digest.md}. Defer-reason: tangential`.');
  const problems = digestedRowProblems(mutated);
  assert.ok(problems.includes('the ledger writer does not accept the digested row for specs/digest.md'), problems.join('; '));
  assert.ok(problems.includes('parseLedger counts the digested row for specs/digest.md as blocking'), problems.join('; '));
});
