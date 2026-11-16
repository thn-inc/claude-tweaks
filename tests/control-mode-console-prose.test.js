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
  ['`belowFloor` judged per `_shared/materiality-floor.md`', 'step 10 does not judge an insight item belowFloor per the materiality floor'],
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

// #4620 Task 9: step 8 routes control-mode memory writes through console-resolve.js --memory-write.
function stepEight(text) {
  const start = text.indexOf('\n8. `M#` memory updates');
  assert.notStrictEqual(start, -1, 'step 8 not found');
  const end = text.indexOf('\n9. ', start);
  assert.notStrictEqual(end, -1, 'no step 9 after step 8');
  return text.slice(start, end);
}
const MEMORY_COMMAND = 'console-resolve.js" --memory-write "{file}" --memory-dir "{memory dir}" --content-file "{temp file}" --run "$PIPELINE_RUN_DIR"';

function memoryWriteProblems(text) {
  const s = stepEight(text);
  const problems = [];
  if (!s.includes(MEMORY_COMMAND)) problems.push('step 8 does not route control-mode memory writes through --memory-write');
  if (s.includes('AskUserQuestion')) problems.push('step 8 names AskUserQuestion');
  if (!s.includes(INDEX_CLAUSE)) problems.push('step 8 does not say the MEMORY.md content file holds the whole index');
  if (!s.includes(FAILURE_CLAUSE)) problems.push('step 8 does not stop on any non-zero exit and carry the exit-3 path');
  return problems;
}
const INDEX_CLAUSE = 'its content file holding the whole current index with the new line appended';
const FAILURE_CLAUSE = 'Any non-zero exit stops with the generic failure card; on exit 3 carry the path stderr names.';

test('review-console.md step 8 routes control-mode memory writes through --memory-write', () => {
  assert.deepStrictEqual(memoryWriteProblems(REVIEW_CONSOLE), []);
});

test('review-console.md step 8 go-red: dropping the command or adding a prompt is caught', () => {
  assert.deepStrictEqual(memoryWriteProblems(REVIEW_CONSOLE.split(MEMORY_COMMAND).join('console-resolve.js" --run "$PIPELINE_RUN_DIR"')), ['step 8 does not route control-mode memory writes through --memory-write']);
  assert.deepStrictEqual(memoryWriteProblems(REVIEW_CONSOLE.replace('8. `M#` memory updates: ', '8. `M#` memory updates: AskUserQuestion. ')), ['step 8 names AskUserQuestion']);
  assert.deepStrictEqual(memoryWriteProblems(REVIEW_CONSOLE.replace(INDEX_CLAUSE, 'the new index line')), ['step 8 does not say the MEMORY.md content file holds the whole index']);
  assert.deepStrictEqual(memoryWriteProblems(REVIEW_CONSOLE.replace(FAILURE_CLAUSE, 'Exit 5 stops.')), ['step 8 does not stop on any non-zero exit and carry the exit-3 path']);
});

// #4620 Task 11: the console's control-mode branch and the carried route.
const APPENDIX = readText(path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up', 'review-console-appendix.md'));
const { CARRIED_RESOLUTION, CARRY_FROM } = require(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'console', 'resolve'));
const CONTROL_MARKER = '**Control mode (#4620).**';

function carryParagraph(text) {
  const s = section(text, HEADING);
  const start = s.indexOf(CONTROL_MARKER);
  if (start === -1) return null;
  const end = s.indexOf('\n\n', start);
  return end === -1 ? s.slice(start) : s.slice(start, end);
}

// The carry sentence runs from the bold lead-in to the next sentence's anchor, not to the first '. '.
const CARRY_END = ' The CLI then prints no Needs a human block';
function carrySentence(text) {
  const p = carryParagraph(text);
  const end = p.indexOf(CARRY_END);
  assert.notStrictEqual(end, -1, `carry sentence anchor not found: ${CARRY_END}`);
  return p.slice(CONTROL_MARKER.length, end);
}

function claimProblems(text, claims) {
  const p = carryParagraph(text);
  if (p === null) return ['the short-circuit has no control-mode paragraph'];
  return claims.filter(([needle]) => !p.includes(needle)).map(([, message]) => message);
}

function withoutNeedle(needle) {
  const p = carryParagraph(REVIEW_CONSOLE);
  assert.ok(p, 'control-mode paragraph missing');
  assert.ok(p.includes(needle), `${needle} is not in the paragraph`);
  return REVIEW_CONSOLE.replace(p, p.split(needle).join('[removed]'));
}

const CARRY_CLAIMS = [
  ['resolves `carried`', 'the control-mode paragraph does not say items resolve `carried`'],
  ['packet-facts/decisions.json', 'the control-mode paragraph does not name packet-facts/decisions.json'],
  ['Decisions left for you', "the control-mode paragraph does not name the packet's Decisions left for you"],
];
test('AC1.1: the short-circuit names the control-mode carry into the packet', () => {
  assert.deepStrictEqual(claimProblems(REVIEW_CONSOLE, CARRY_CLAIMS), []);
  for (const [needle, message] of CARRY_CLAIMS) assert.deepStrictEqual(claimProblems(withoutNeedle(needle), CARRY_CLAIMS), [message]);
});

const RESIDUE_CLAIMS = [['prints no Needs a human block', 'the control-mode paragraph does not say the CLI prints no Needs a human block']];
test('AC2.1: under control mode no console item reaches the final stop as residue', () => {
  assert.deepStrictEqual(claimProblems(REVIEW_CONSOLE, RESIDUE_CLAIMS), []);
  assert.deepStrictEqual(claimProblems(withoutNeedle(RESIDUE_CLAIMS[0][0]), RESIDUE_CLAIMS), [RESIDUE_CLAIMS[0][1]]);
});

test('AC7.1: a needs-human-decision ruling is carried, not applied', () => {
  // sdd-ruling-needs-human-decision resolves `pending`; the carry sentence must name that resolution.
  const sentence = carrySentence(REVIEW_CONSOLE);
  assert.ok(sentence.includes('`pending`'), 'the carry sentence does not name `pending`');
  const mutated = REVIEW_CONSOLE.replace('`pending`, `keep-staged` or `refused` resolves `carried`', '`keep-staged` or `refused` resolves `carried`');
  assert.notStrictEqual(mutated, REVIEW_CONSOLE);
  assert.ok(!carrySentence(mutated).includes('`pending`'), 'control: without `pending` the check goes red');
});

const EXIT6 = "exit code 6 (a carry write failed) → stop with `flow/failure-cards.md`'s Generic gate failure card";
const EXIT6_APPENDIX = "Exit code 6 (a control-mode carry write failed) → stop with `flow/failure-cards.md`'s Generic gate failure card";
test('AC6.1: exit 6 stops with the generic failure card', () => {
  assert.ok(REVIEW_CONSOLE.includes(EXIT6), 'review-console.md');
  assert.ok(APPENDIX.includes(EXIT6_APPENDIX), 'appendix');
  assert.ok(!REVIEW_CONSOLE.replace(EXIT6, 'exit code 6').includes(EXIT6), 'control: review-console.md');
  assert.ok(!APPENDIX.replace(EXIT6_APPENDIX, 'Exit code 6').includes(EXIT6_APPENDIX), 'control: appendix');
});

const ROUTE_CLAIMS = [
  ['--resolution carried', 'the carried route does not use --resolution carried'],
  ['--ledger "{ledger path}"', 'the carried route does not pass --ledger "{ledger path}" for a ledger-record item'],
  ['carried to the acceptance packet as {factId}', 'the carried route does not settle the ledger row with the fact id'],
  ['Exit 2, 3, 5 or 6 from that call stops with', 'the carried route does not send exits 2, 3, 5 and 6 from its call to the failure card'],
];
test('AC2.1: the one route for a failed or refused item settles a ledger-record row through --set-item --ledger', () => {
  assert.deepStrictEqual(claimProblems(REVIEW_CONSOLE, ROUTE_CLAIMS), []);
  assert.ok(!carryParagraph(REVIEW_CONSOLE).includes('--resolution keep-staged'), 'the route is paired with keep-staged');
  for (const [needle, message] of ROUTE_CLAIMS) assert.deepStrictEqual(claimProblems(withoutNeedle(needle), ROUTE_CLAIMS), [message]);
  const paired = REVIEW_CONSOLE.replace('--resolution carried', '--resolution keep-staged');
  assert.ok(carryParagraph(paired).includes('--resolution keep-staged'), 'control: a keep-staged pairing is detectable');
});

function carriedRoute(text) {
  const heading = '### Resolution-to-step mapping';
  const start = text.indexOf(`\n${heading}\n`);
  assert.notStrictEqual(start, -1, `heading not found: ${heading}`);
  const end = text.indexOf('\n#', start + heading.length + 1);
  assert.notStrictEqual(end, -1, `no heading after: ${heading}`);
  return text.slice(start, end).split('\n').find((l) => l.startsWith('- `carried`')) || null;
}
test('the appendix mapping routes carried to execute nothing', () => {
  const route = carriedRoute(APPENDIX);
  assert.ok(route, 'no `carried` bullet in the Resolution-to-step mapping');
  assert.match(route, /execute \*\*nothing\*\*/);
  const mutated = APPENDIX.replace(/\n- `carried`/, '\n- `gone`');
  assert.notStrictEqual(mutated, APPENDIX);
  assert.strictEqual(carriedRoute(mutated), null, 'control: removing the bullet goes red');
});

test('carried is pinned code-to-prose', () => {
  assert.ok(carriedRoute(APPENDIX).includes(`\`${CARRIED_RESOLUTION}\``), 'the mapping bullet does not name CARRIED_RESOLUTION');
  assert.ok(CARRY_FROM.length > 0, 'CARRY_FROM is empty');
  const sentence = carrySentence(REVIEW_CONSOLE);
  for (const from of CARRY_FROM) assert.ok(sentence.includes(`\`${from}\``), `the carry sentence does not name \`${from}\``);
});
