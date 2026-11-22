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

const RESOLUTION_CITE_LITERAL = "the Ledger Resolution `_shared/materiality-floor.md`'s digest-label table gives the printed `rule`";

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
  ['prints `digest` (`false` on `file`, `refused` or any other outcome', 'the control-mode paragraph does not set belowFloor from the deferral-route.js verdict'],
  ['no `deferReason`: no call, `false`', 'the control-mode paragraph does not skip the command for an item with no deferReason'],
  ['it means the route printed `digest`, whichever `rule`', 'the control-mode paragraph does not say belowFloor means the route printed digest, whichever rule'],
  [RESOLUTION_CITE_LITERAL, 'the digested state does not take its Resolution from the digest-label table'],
  ["`{severity}` the row's `severity={severity}` token", "the control-mode paragraph does not read a row's severity token"],
  ['else `high` for a `review`-phase row', 'the control-mode paragraph does not pass --severity high for a review row with no severity'],
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
  ["`belowFloor` from that paragraph's `deferral-route.js` call", 'step 10 does not set an insight item belowFloor from the deferral-route.js verdict'],
  ['`false` on `refused` or any other outcome', 'step 10 does not set belowFloor false on a refused or unreadable verdict'],
  ['no `deferReason`: no call, `false`', 'step 10 does not skip the command for an insight with no deferReason'],
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
// The Ledger Resolution column of `_shared/materiality-floor.md`'s digest-label table (a template per digest rule).
const DIGEST_LABEL_TABLE_RESOLUTIONS = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'materiality-floor.md'))
  .split('\n').filter((l) => /^\| `(floor|policy-reason|no-evidence|run-cap)` \|/.test(l))
  .map((l) => ({ rule: l.split('|')[1].trim().replace(/`/g, ''), template: l.split('|')[3].trim().replace(/^`|`$/g, '') }));
const BACKEND_LOCATIONS = ['https://github.com/o/r/issues/9#issuecomment-123', 'specs/digest.md'];

function digestedRowProblems(text) {
  const bullet = narrowingSlice(text).split('\n').find((l) => l.startsWith('- `digested`:'));
  if (!bullet) return ['no digested bullet'];
  const m = /write the row `(\w+)`(?: \(`([^`]+)`\)| with Resolution `([^`]+)`| with the Ledger Resolution `_shared\/materiality-floor\.md`'s digest-label table)/.exec(bullet);
  if (!m) return ['the digested bullet prescribes no row status and Resolution'];
  const status = m[1];
  // A literal Resolution in the bullet is checked as written; a cited one is every Ledger Resolution of the
  // digest-label table, since the printed `rule` picks the row.
  const templates = m[3] || m[2] ? [{ rule: null, template: m[3] || m[2] }] : DIGEST_LABEL_TABLE_RESOLUTIONS;
  const problems = [];
  for (const { rule, template } of templates) {
    for (const location of BACKEND_LOCATIONS) {
      const via = rule === null ? '' : ` (rule ${rule})`;
      const resolution = template.split(DIGEST_ALTERNATIVES).join(location).split('{where}').join(location);
      const check = checkLedgerStatus(status, resolution, {});
      if (check.refusal !== null || check.incompleteDeferral) problems.push(`the ledger writer does not accept the digested row for ${location}${via}`);
      const parsed = parseLedger(`| # | Phase | Item | Status | Resolution |\n|---|---|---|---|---|\n| 1 | build | a typo | ${status} | ${resolution} |\n`);
      if (parsed.open + parsed.deferredUnstaged + parsed.missingDeferReason + parsed.unrecognized !== 0) problems.push(`parseLedger counts the digested row for ${location}${via} as blocking`);
    }
  }
  return problems;
}

test('AC4.7: the digested ledger row is complete for the real writer and reader on both backends', () => {
  assert.strictEqual(DIGEST_LABEL_TABLE_RESOLUTIONS.length, 4, 'the digest-label table rows were not read');
  assert.deepStrictEqual(digestedRowProblems(LEDGER_FORMAT), []);
});

test('AC4.7 go-red: the cited digested bullet writing `open` is counted as blocking for every digest rule on both backends', () => {
  const bullet = narrowingSlice(LEDGER_FORMAT).split('\n').find((l) => l.startsWith('- `digested`:'));
  const mutated = LEDGER_FORMAT.replace(bullet, bullet.replace('write the row `accepted`', 'write the row `open`'));
  assert.notStrictEqual(mutated, LEDGER_FORMAT, 'the cited bullet carries no `accepted` row to mutate');
  const problems = digestedRowProblems(mutated);
  for (const { rule } of DIGEST_LABEL_TABLE_RESOLUTIONS) {
    // An `open` row is a blocking ledger row wherever the digest entry lives, so both backends report it.
    for (const location of BACKEND_LOCATIONS) {
      assert.ok(problems.includes(`parseLedger counts the digested row for ${location} (rule ${rule}) as blocking`), `${rule} ${location}: ${problems.join('; ')}`);
    }
  }
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

// Final-review fixes (#4620): ONE gate rule — `control-mode on` AND `consoleAutoResolve true`, whatever the source.
const GATE = '`control-mode on` and `consoleAutoResolve true`';
const OLD_SOURCE_GATE = 'with `source control-mode`';

function gateProblems(text) {
  const problems = [];
  const carry = carryParagraph(text);
  if (carry === null) problems.push('the short-circuit has no control-mode paragraph');
  else {
    if (!carry.includes(GATE)) problems.push('the carry paragraph does not gate on control-mode on and consoleAutoResolve true');
    if (carry.includes(OLD_SOURCE_GATE)) problems.push('the carry paragraph still gates on source control-mode');
  }
  return problems;
}

test('Important 1: the carry paragraph and every convergence gate share one rule, whatever the source', () => {
  assert.deepStrictEqual(gateProblems(REVIEW_CONSOLE), []);
  assert.ok(step10Line(REVIEW_CONSOLE).includes(GATE), 'step 10 does not gate on the shared rule');
  assert.ok(stepEight(REVIEW_CONSOLE).includes(GATE), 'step 8 does not gate on the shared rule');
  assert.ok(narrowingSlice(LEDGER_FORMAT).includes(GATE), 'ledger-format does not gate on the shared rule');
});

test('Important 1 go-red: the carry paragraph, step 8 and step 10 each go red when their gate is reverted', () => {
  const carry = carryParagraph(REVIEW_CONSOLE);
  assert.deepStrictEqual(gateProblems(REVIEW_CONSOLE.replace(carry, carry.replace(GATE, '`control-mode on`'))), ['the carry paragraph does not gate on control-mode on and consoleAutoResolve true']);
  assert.deepStrictEqual(gateProblems(REVIEW_CONSOLE.replace(carry, carry.replace(GATE, '`control-mode on` with `source control-mode`'))), ['the carry paragraph does not gate on control-mode on and consoleAutoResolve true', 'the carry paragraph still gates on source control-mode']);
  const eight = stepEight(REVIEW_CONSOLE);
  assert.ok(!REVIEW_CONSOLE.replace(eight, eight.replace(GATE, 'control mode')).includes(eight), 'control: step 8 mutation applies');
  assert.ok(!stepEight(REVIEW_CONSOLE.replace(eight, eight.replace(GATE, 'control mode'))).includes(GATE), 'step 8 mutation goes red');
  const ten = step10Line(REVIEW_CONSOLE);
  assert.ok(!step10Line(REVIEW_CONSOLE.replace(ten, ten.replace(GATE, 'control mode'))).includes(GATE), 'step 10 mutation goes red');
  const narrowing = narrowingSlice(LEDGER_FORMAT);
  assert.ok(!narrowingSlice(LEDGER_FORMAT.replace(narrowing, narrowing.replace(GATE, '`control-mode on`'))).includes(GATE), 'ledger-format mutation goes red');
});

// Important 2: exit 6 in every statement of the resolve shape's exit list.
const PLUGIN_STRUCTURE = readText(path.join(__dirname, '..', 'docs', 'plugin-structure.md'));
const MULTISPEC = readText(path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'multispec-review-console.md'));
const STRUCTURE_EXIT6 = '5 console already rendered on the PR, 6 a control-mode carry write failed';
const MULTISPEC_EXIT6 = "except exit 6 (carry failed): stop with `flow/failure-cards.md`'s Generic gate failure card naming each item stderr lists";

function exit6Problems(structure, multispec) {
  const problems = [];
  const line = structure.split('\n').find((l) => l.includes('--policy console-auto [--dry-run] [--json]')) || '';
  if (!line.includes(STRUCTURE_EXIT6)) problems.push('plugin-structure.md --policy console-auto line does not list exit 6');
  if (!multispec.includes(MULTISPEC_EXIT6)) problems.push('multispec-review-console.md does not route exit 6 to the Generic gate failure card');
  return problems;
}

test('Important 2: the --policy console-auto exit list names exit 6 in docs and the multispec console', () => {
  assert.deepStrictEqual(exit6Problems(PLUGIN_STRUCTURE, MULTISPEC), []);
  assert.deepStrictEqual(exit6Problems(PLUGIN_STRUCTURE.replace(STRUCTURE_EXIT6, '5 console already rendered on the PR'), MULTISPEC), ['plugin-structure.md --policy console-auto line does not list exit 6']);
  assert.deepStrictEqual(exit6Problems(PLUGIN_STRUCTURE, MULTISPEC.replace(MULTISPEC_EXIT6, 'except nothing')), ['multispec-review-console.md does not route exit 6 to the Generic gate failure card']);
});

// Minor 3: the gather docs line states the decisions.json read.
const GATHER_READ = 'with `--run` and no `--decision-items` it reads `{run}/packet-facts/decisions.json`';
test('Minor 3: the acceptance-packet gather docs line states the decisions.json read', () => {
  assert.ok(PLUGIN_STRUCTURE.includes(GATHER_READ));
  assert.ok(!PLUGIN_STRUCTURE.replace(GATHER_READ, 'reads').includes(GATHER_READ), 'control: removing it goes red');
});

// Minor 1: flow's summary row reads the ceiling through console-resolve.js --ceiling, so control mode counts.
const SUMMARY = readText(path.join(__dirname, '..', 'plugin', 'skills', 'flow', 'summary-template.md'));
const SUMMARY_NEW = 'the `ceiling {tier}` word of `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --ceiling --run "$PIPELINE_RUN_DIR"`';
const SUMMARY_OLD = 'resolve-policy.js" --run "$PIPELINE_RUN_DIR" --values autonomy';
function summaryProblems(text) {
  const problems = [];
  if (!text.includes(SUMMARY_NEW)) problems.push('the summary row does not read the ceiling through console-resolve.js --ceiling');
  if (text.includes(SUMMARY_OLD)) problems.push('the summary row still reads the ceiling through resolve-policy.js --values autonomy');
  return problems;
}
test('Minor 1: the flow summary merge row reads the ceiling through console-resolve.js --ceiling', () => {
  assert.deepStrictEqual(summaryProblems(SUMMARY), []);
  assert.deepStrictEqual(summaryProblems(SUMMARY.replace(SUMMARY_NEW, 'the ceiling')), ['the summary row does not read the ceiling through console-resolve.js --ceiling']);
  assert.deepStrictEqual(summaryProblems(`${SUMMARY}\n${SUMMARY_OLD}`), ['the summary row still reads the ceiling through resolve-policy.js --values autonomy']);
});

// #4621: under control mode a wrap-up upstream-feedback item files only into a repo the project owns. The prose points at
// the CLI, the capability key and the staged layout, so each pin follows its code twin and is proved red on a mutated copy.
const AUTONOMY_CEILING = readText(path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'autonomy-ceiling.md'));
const UPSTREAM_FEEDBACK = readText(path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up', 'upstream-feedback.md'));
const { bookkeepingPermissions } = require(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'issues', 'autonomy'));
const { parseStagedUpstream, UPSTREAM_FILING_TARGET } = require(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'issues', 'upstream-ownership'));
const FEEDBACK_SKILL = readText(path.join(__dirname, '..', 'plugin', 'skills', 'feedback', 'SKILL.md'));

function stepNine(text) {
  const start = text.indexOf('\n9. For `U#` upstream feedback rows');
  assert.notStrictEqual(start, -1, 'step 9 not found');
  const end = text.indexOf('\n10. ', start);
  assert.notStrictEqual(end, -1, 'no step 10 after step 9');
  return text.slice(start, end);
}

// Flag-first, like `--ceiling`: console-resolve-conformance.test.js pins exactly one `console-resolve.js" --run`.
// `'{id}'` and `'{url}'` are single-quoted, as step 7 quotes every staged-derived name.
const ROUTE_CALL = 'console-resolve.js" --upstream-route \'{id}\' --run "$PIPELINE_RUN_DIR"';
const STEP_9_CLAIMS = [
  [ROUTE_CALL, 'step 9 does not route each U# through --upstream-route'],
  ['with no per-item prompt, causal tag or not', 'step 9 does not file an owned item with no per-item prompt, causal tag or not'],
  ['console-resolve.js" --upstream-route \'{id}\' --filed \'{url}\' --run "$PIPELINE_RUN_DIR"', 'step 9 does not log an owned filing with --filed'],
  ['at every tier, `unattended` included', 'step 9 does not route each U# at every tier'],
  ["--hold filing-failed|scrub-hit --reason '{why}'", 'step 9 does not hold a failed filing or a scrub stop with --hold'],
  ['this repeat is idempotent', 'step 9 does not say the unattended repeat is idempotent'],
  ["is declined per step 7's decline rule, owned or not", 'step 9 does not let an explicit uncheck or untick decline an owned item'],
  ['an explicit check never files a held item', 'step 9 does not keep a checked held item unfiled'],
  ['With nothing on stdout, the id was refused and nothing was logged', 'step 9 does not tell a refused id from a hold verdict by stdout'],
  ['not owned or does not parse', 'step 9 does not gloss a --filed URL that does not parse'],
];
// The retired readings: the unattended skip that left a reconciler-resolved console unrouted, and ownership overriding a human's choice.
const STEP_9_RETIRED = [
  ['Below `unattended`, run', 'step 9 still skips the route call at unattended'],
  ['Approve all and Override alike', 'step 9 still lets ownership override an explicit choice'],
];

function stepNineProblems(text) {
  const s = stepNine(text);
  return [
    ...STEP_9_CLAIMS.filter(([needle]) => !s.includes(needle)).map(([, message]) => message),
    ...STEP_9_RETIRED.filter(([needle]) => s.includes(needle)).map(([, message]) => message),
  ];
}

test('#4621: review-console.md step 9 routes each U# by ownership under control mode', () => {
  assert.deepStrictEqual(stepNineProblems(REVIEW_CONSOLE), []);
});

for (const [needle, message] of STEP_9_CLAIMS) {
  test(`#4621 go-red: ${message}`, () => {
    const s = stepNine(REVIEW_CONSOLE);
    assert.deepStrictEqual(stepNineProblems(REVIEW_CONSOLE.replace(s, s.split(needle).join('[removed]'))), [message]);
  });
}

for (const [needle, message] of STEP_9_RETIRED) {
  test(`#4621 go-red: ${message}`, () => {
    const s = stepNine(REVIEW_CONSOLE);
    assert.deepStrictEqual(stepNineProblems(REVIEW_CONSOLE.replace(s, `${s} ${needle}`)), [message]);
  });
}

// Code twin: every `--upstream-route` command step 9 documents parses through console-resolve.js's real parseArgs
// once its placeholders are filled, so a misspelled or misplaced flag in the prose is a usage error here, not at a run.
const { parseArgs } = require(path.join(__dirname, '..', 'plugin', 'bin', 'console-resolve'));
const UPSTREAM_SPAN_RE = /`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/console-resolve\.js" (--upstream-route [^`]*)`/g;
const PLACEHOLDERS = [['{id}', 'wrap-up-upstream-1.md'], ['{url}', 'https://github.com/o/r/issues/1'], ['{why}', 'a reason'], ['$PIPELINE_RUN_DIR', '/run']];
const shellWords = (s) => (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((w) => w.replace(/^(["'])(.*)\1$/, '$2'));

function documentedCommandProblems(text) {
  const spans = [...stepNine(text).matchAll(UPSTREAM_SPAN_RE)].map((m) => m[1]);
  const problems = [];
  const shapes = new Set();
  for (const span of spans) {
    for (const hold of span.includes('filing-failed|scrub-hit') ? ['filing-failed', 'scrub-hit'] : [null]) {
      let args = hold === null ? span : span.replace('filing-failed|scrub-hit', hold);
      for (const [placeholder, value] of PLACEHOLDERS) args = args.split(placeholder).join(value);
      try {
        const o = parseArgs(shellWords(args));
        if (o.upstreamRoute !== 'wrap-up-upstream-1.md') problems.push(`${span}: the id did not parse as the id`);
        shapes.add(o.hold !== null ? 'hold' : o.filed !== null ? 'filed' : 'route');
      } catch (err) {
        problems.push(`${span}: ${err.message}`);
      }
    }
  }
  for (const shape of ['route', 'filed', 'hold']) if (!shapes.has(shape)) problems.push(`step 9 documents no ${shape} command`);
  return problems;
}

test('#4621: every --upstream-route command in step 9 parses through console-resolve.js parseArgs', () => {
  assert.deepStrictEqual(documentedCommandProblems(REVIEW_CONSOLE), []);
});

test('#4621 go-red: a misspelled flag, a dropped --reason or a dropped command in step 9 is caught', () => {
  const s = stepNine(REVIEW_CONSOLE);
  const misspelled = documentedCommandProblems(REVIEW_CONSOLE.replace(s, s.replace("--filed '{url}'", "--file '{url}'")));
  assert.ok(misspelled.some((p) => p.includes('unknown flag: --file')), misspelled.join('; '));
  const noReason = documentedCommandProblems(REVIEW_CONSOLE.replace(s, s.replace(" --reason '{why}'", '')));
  assert.ok(noReason.some((p) => p.includes('--hold requires --reason')), noReason.join('; '));
  const noFiled = documentedCommandProblems(REVIEW_CONSOLE.replace(s, s.split("--upstream-route '{id}' --filed").join("--removed '{id}' --filed")));
  assert.ok(noFiled.includes('step 9 documents no filed command'), noFiled.join('; '));
});

// The multi-spec console's On approval step 4 routes each U# through step 9's control-mode calls, per spec dir.
function multispecStepFour(text) {
  const start = text.indexOf('\n4. For `U#` upstream feedback rows');
  assert.notStrictEqual(start, -1, 'multispec On approval step 4 not found');
  const end = text.indexOf('\n4.5. ', start);
  assert.notStrictEqual(end, -1, 'no step 4.5 after step 4');
  return text.slice(start, end);
}

const MULTISPEC_STEP_4_CLAIMS = [
  ['--upstream-route', 'multispec step 4 does not name --upstream-route'],
  ['--filed', 'multispec step 4 does not name --filed'],
  ['`--run "{item-run-dir}"`', 'multispec step 4 does not run the calls on each item\'s own run dir'],
  ["`wrap-up/review-console.md` step 9's Control mode clause", 'multispec step 4 does not cite review-console.md step 9'],
];

function multispecStepFourProblems(text) {
  const s = multispecStepFour(text);
  return MULTISPEC_STEP_4_CLAIMS.filter(([needle]) => !s.includes(needle)).map(([, message]) => message);
}

test('#4621: multispec-review-console.md step 4 routes each U# through --upstream-route and --filed', () => {
  assert.deepStrictEqual(multispecStepFourProblems(MULTISPEC), []);
});

for (const [needle, message] of MULTISPEC_STEP_4_CLAIMS) {
  test(`#4621 go-red: ${message}`, () => {
    const s = multispecStepFour(MULTISPEC);
    assert.deepStrictEqual(multispecStepFourProblems(MULTISPEC.replace(s, s.split(needle).join('[removed]'))), [message]);
  });
}

function sectionOf(text, heading) {
  const start = text.indexOf(`\n${heading}`);
  assert.notStrictEqual(start, -1, `heading not found: ${heading}`);
  const end = text.indexOf('\n## ', start + heading.length + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

// Code twin: every key bookkeepingPermissions returns has a row in the capabilities table, `ownedUpstreamFiling` included.
function capabilityRowProblems(text) {
  const table = sectionOf(text, '## Bookkeeping capabilities');
  return Object.keys(bookkeepingPermissions('supervised', { controlMode: true })).filter((key) => !table.includes(`| \`${key}\` |`)).map((key) => `no capability row for ${key}`);
}

test('#4621: autonomy-ceiling.md has a capabilities row for every bookkeepingPermissions key, ownedUpstreamFiling included', () => {
  assert.ok(Object.keys(bookkeepingPermissions('supervised', { controlMode: true })).includes('ownedUpstreamFiling'), 'the code twin lost the key');
  assert.deepStrictEqual(capabilityRowProblems(AUTONOMY_CEILING), []);
});

test('#4621 go-red: dropping the ownedUpstreamFiling row is caught', () => {
  const mutated = AUTONOMY_CEILING.replace('| `ownedUpstreamFiling` |', '| `renamed` |');
  assert.notStrictEqual(mutated, AUTONOMY_CEILING);
  assert.deepStrictEqual(capabilityRowProblems(mutated), ['no capability row for ownedUpstreamFiling']);
});

const NO_CAPABILITY_CLAIM = 'adds no capability of its own';
function controlModeSectionProblems(text) {
  const s = sectionOf(text, '## Control mode (#4620)');
  const problems = [];
  if (!s.includes('ownedUpstreamFiling')) problems.push('the Control mode section does not name ownedUpstreamFiling');
  if (s.includes(NO_CAPABILITY_CLAIM)) problems.push('the Control mode section still says control mode adds no capability of its own');
  return problems;
}

test('#4621: the Control mode section names the one capability control mode adds', () => {
  assert.deepStrictEqual(controlModeSectionProblems(AUTONOMY_CEILING), []);
});

test('#4621 go-red: the Control mode section naming no capability, or the retired claim, is caught', () => {
  const section = sectionOf(AUTONOMY_CEILING, '## Control mode (#4620)');
  assert.deepStrictEqual(controlModeSectionProblems(AUTONOMY_CEILING.replace(section, section.split('ownedUpstreamFiling').join('[removed]'))), ['the Control mode section does not name ownedUpstreamFiling']);
  assert.deepStrictEqual(controlModeSectionProblems(AUTONOMY_CEILING.replace(section, `${section}\n${NO_CAPABILITY_CLAIM}`)), ['the Control mode section still says control mode adds no capability of its own']);
});

// The staging check runs inside curation-engine.md's dispatched judge, whose shell has no $PIPELINE_RUN_DIR: it must name
// {ABS_RUN_DIR}, and curation-engine.md must substitute that placeholder alongside {ABS_STAGE_DIR}.
const CURATION_ENGINE = readText(path.join(__dirname, '..', 'plugin', 'skills', 'wrap-up', 'curation-engine.md'));
const flat = (text) => text.replace(/\s+/g, ' ');
const STAGING_CHECK = '--ceiling --run "{ABS_RUN_DIR}"';
const STAGING_CHECK_UNSET = '--ceiling --run "$PIPELINE_RUN_DIR"';

function absRunDirProblems(engine, upstream) {
  const problems = [];
  const e = flat(engine);
  if (!e.includes('with `{ABS_STAGE_DIR}` and `{ABS_RUN_DIR}` substituted')) problems.push('the fan-out dispatch does not substitute {ABS_RUN_DIR}');
  if (!e.includes('The controller replaces `{ABS_STAGE_DIR}`, and `{ABS_RUN_DIR}` (the anchored absolute run dir')) problems.push('the substitution sentence does not define {ABS_RUN_DIR}');
  const u = flat(upstream);
  if (!e.includes('A judge run in the main thread reads `{ABS_RUN_DIR}` as the same anchored run dir')) problems.push('the main-thread judge does not read {ABS_RUN_DIR} as the anchored run dir');
  if (!u.includes(STAGING_CHECK)) problems.push('the staging check does not run against {ABS_RUN_DIR}');
  if (u.includes(STAGING_CHECK_UNSET)) problems.push('the staging check still runs against $PIPELINE_RUN_DIR');
  if (!u.includes('A failed call, or any output other than `control-mode on`, writes no header')) problems.push('the staging check does not fail closed to no header');
  return problems;
}

test('#4621: the staging check names {ABS_RUN_DIR}, which curation-engine.md substitutes', () => {
  assert.deepStrictEqual(absRunDirProblems(CURATION_ENGINE, UPSTREAM_FEEDBACK), []);
});

test('#4621 go-red: each {ABS_RUN_DIR} claim is caught on its own', () => {
  assert.deepStrictEqual(absRunDirProblems(CURATION_ENGINE.replace(' and `{ABS_RUN_DIR}` substituted', ' substituted'), UPSTREAM_FEEDBACK), ['the fan-out dispatch does not substitute {ABS_RUN_DIR}']);
  assert.deepStrictEqual(absRunDirProblems(CURATION_ENGINE.replace('`{ABS_STAGE_DIR}`, and `{ABS_RUN_DIR}` (the anchored absolute run dir', '`{ABS_STAGE_DIR}`'), UPSTREAM_FEEDBACK), ['the substitution sentence does not define {ABS_RUN_DIR}']);
  assert.deepStrictEqual(absRunDirProblems(CURATION_ENGINE.replace('A judge run in the main thread reads `{ABS_RUN_DIR}` as the same anchored run dir', 'A judge run in the main thread reads the run dir'), UPSTREAM_FEEDBACK), ['the main-thread judge does not read {ABS_RUN_DIR} as the anchored run dir']);
  assert.deepStrictEqual(absRunDirProblems(CURATION_ENGINE, UPSTREAM_FEEDBACK.replace(STAGING_CHECK, STAGING_CHECK_UNSET)), ['the staging check does not run against {ABS_RUN_DIR}', 'the staging check still runs against $PIPELINE_RUN_DIR']);
  assert.deepStrictEqual(absRunDirProblems(CURATION_ENGINE, UPSTREAM_FEEDBACK.replace('A failed call', 'A call')), ['the staging check does not fail closed to no header']);
});

// Code twin: the staged layout the prose documents parses to a target, a title and a body through parseStagedUpstream.
function stagedLayoutProblems(text) {
  const m = /```\n(<!-- upstream-target:[\s\S]*?)\n```/.exec(text);
  if (!m) return ['wrap-up/upstream-feedback.md documents no staged layout block'];
  const parsed = parseStagedUpstream(m[1].replace('{title}', 'A title').replace('{scrubbed body}', 'A body'));
  const problems = [];
  if (parsed.targetRepo !== UPSTREAM_FILING_TARGET) problems.push(`the layout's target parses as ${parsed.targetRepo}`);
  if (parsed.title !== 'A title') problems.push(`the layout's title parses as ${parsed.title}`);
  if (parsed.body !== 'A body') problems.push(`the layout's body parses as ${JSON.stringify(parsed.body)}`);
  return problems;
}

// Code twin: the route holds a staged header naming any repo but UPSTREAM_FILING_TARGET, so that literal must be the one
// repo /claude-tweaks:feedback files into — the skill states it once as its only target and passes it as --repo.
const FEEDBACK_REPO_RE = /file-feedback\.js" --drafts <path> --repo (\S+)/g;
function filingTargetProblems(feedback) {
  const problems = [];
  const repos = [...feedback.matchAll(FEEDBACK_REPO_RE)].map((m) => m[1]);
  if (repos.length !== 1) problems.push(`feedback/SKILL.md files with ${repos.length} \`--repo\` calls, not one`);
  else if (repos[0] !== UPSTREAM_FILING_TARGET) problems.push(`feedback/SKILL.md files with --repo ${repos[0]}, not ${UPSTREAM_FILING_TARGET}`);
  if (!feedback.includes(`This skill **files** against \`${UPSTREAM_FILING_TARGET}\` and nowhere else.`)) problems.push('feedback/SKILL.md no longer names the one filing target');
  return problems;
}

test('#4621: UPSTREAM_FILING_TARGET is the repo /claude-tweaks:feedback files into', () => {
  assert.deepStrictEqual(filingTargetProblems(FEEDBACK_SKILL), []);
});

test('#4621 go-red: a feedback skill that files elsewhere, twice or into an unstated target is caught', () => {
  assert.deepStrictEqual(filingTargetProblems(FEEDBACK_SKILL.replace(`--drafts <path> --repo ${UPSTREAM_FILING_TARGET}`, '--drafts <path> --repo acme/widgets')), ['feedback/SKILL.md files with --repo acme/widgets, not thn-inc/claude-tweaks']);
  assert.deepStrictEqual(filingTargetProblems(`${FEEDBACK_SKILL}\nfile-feedback.js" --drafts <path> --repo ${UPSTREAM_FILING_TARGET}`), ['feedback/SKILL.md files with 2 `--repo` calls, not one']);
  assert.deepStrictEqual(filingTargetProblems(FEEDBACK_SKILL.replace('and nowhere else.', 'and elsewhere.')), ['feedback/SKILL.md no longer names the one filing target']);
});

test('#4621: the staged layout in wrap-up/upstream-feedback.md parses through parseStagedUpstream', () => {
  assert.deepStrictEqual(stagedLayoutProblems(UPSTREAM_FEEDBACK), []);
});

test('#4621 go-red: a layout whose marker or Title prefix drifts from the parser is caught', () => {
  const noPrefix = stagedLayoutProblems(UPSTREAM_FEEDBACK.replace('Title: {title}', '{title}'));
  assert.ok(noPrefix.includes("the layout's title parses as null"), noPrefix.join('; '));
  assert.deepStrictEqual(stagedLayoutProblems(UPSTREAM_FEEDBACK.replace('<!-- upstream-target:', '<!-- target:')), ['wrap-up/upstream-feedback.md documents no staged layout block']);
});

// Under control mode /claude-tweaks:feedback --pre-confirmed holds an item rather than asking: a scrub stop, and a drift
// mismatch that would otherwise fall back to AskUserQuestion, each run step 9's --hold scrub-hit call (#4621).
const PRE_CONFIRMED = readText(path.join(__dirname, '..', 'plugin', 'skills', 'feedback', 'pre-confirmed.md'));
const PRE_CONFIRMED_CLAIMS = [
  ["Under control mode this stop also runs the `--hold scrub-hit` call of `wrap-up/review-console.md`'s step 9 for the item against that owning run dir", 'pre-confirmed.md does not hold a scrub stop with --hold scrub-hit'],
  ['Under control mode a mismatch never falls back to `AskUserQuestion`: file nothing for the item and run the `--hold scrub-hit` call of `wrap-up/review-console.md`\'s step 9 against that owning run dir, with `{why}` `scrub changed the approved draft`', 'pre-confirmed.md does not hold a drift mismatch with --hold scrub-hit instead of asking'],
];

function preConfirmedProblems(text) {
  const t = flat(text);
  return PRE_CONFIRMED_CLAIMS.filter(([needle]) => !t.includes(flat(needle))).map(([, message]) => message);
}

test('#4621: feedback/pre-confirmed.md holds a scrub stop and a drift mismatch under control mode', () => {
  assert.deepStrictEqual(preConfirmedProblems(PRE_CONFIRMED), []);
});

for (const [needle, message] of PRE_CONFIRMED_CLAIMS) {
  test(`#4621 go-red: ${message}`, () => {
    const t = flat(PRE_CONFIRMED);
    assert.ok(t.includes(flat(needle)), 'the claim must exist to be removed');
    assert.deepStrictEqual(preConfirmedProblems(t.split(flat(needle)).join('[removed]')), [message]);
  });
}
