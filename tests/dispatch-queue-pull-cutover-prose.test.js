// tests/dispatch-queue-pull-cutover-prose.test.js — #5230.
//
// Pins the cutover's end-state prose: dispatch/SKILL.md Step 2 runs the queue pull as one
// plugin/bin/queue-pull.js call (the transport named from the Preflight result) and Step 3 ranks
// through `queue-pull.js --rank`, so no step tells the session to read and run
// queue-pull-script.md or next-ranking.md (both kept, unmodified, as the revert path).
// firing-exclusion.md's continuation picks through the same --rank call.
//
// Each pin is one assertion function. Its go-red control runs that same function over a copy of
// the live text with the pinned clause removed (or the forbidden text added) and expects it to
// throw. Sections are cut at their headings, the bullets at their bold labels, and the calls are
// the inline code spans that name queue-pull.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const DISPATCH = path.join(ROOT, 'plugin', 'skills', 'dispatch');
const SKILL = readText(path.join(DISPATCH, 'SKILL.md'));
const FIRING = readText(path.join(DISPATCH, 'firing-exclusion.md'));
const CLI = path.join(ROOT, 'plugin', 'bin', 'queue-pull.js');

function section(text, from, to) {
  const start = text.indexOf(from);
  assert.ok(start !== -1, `${from} not found`);
  const end = text.indexOf(to, start + from.length);
  assert.ok(end !== -1, `${to} not found after ${from}`);
  return text.slice(start, end);
}
function lineStarting(text, prefix) {
  const line = text.split('\n').find((l) => l.startsWith(prefix));
  assert.ok(line, `no line starts with ${prefix}`);
  return line;
}
function paragraph(text, prefix) {
  const start = text.indexOf(prefix);
  assert.ok(start !== -1, `${prefix} not found`);
  const end = text.indexOf('\n\n', start);
  return text.slice(start, end === -1 ? undefined : end).replace(/\s+/g, ' ');
}
const codeSpans = (text) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
const cliCalls = (text) => codeSpans(text).filter((s) => s.includes('queue-pull.js'));

const step1 = (t) => section(t, '### Step 1:', '### Step 2:');
const step2 = (t) => section(t, '### Step 2:', '### Step 3:');
const loopLine = (t) => lineStarting(t, 'Loop: run the `next` ranking below');
const nextBullet = (t) => lineStarting(t, '**`next` (deprecated alias for `--budget 1`)**');

// The live text passes; the copy without `clause` (or with `mutate` applied) throws.
function assertGoesRed(check, text, clause, mutate = (t) => t.split(clause).join('')) {
  check(text);
  if (clause !== null) assert.ok(text.includes(clause), `control clause not in the live text: ${clause}`);
  assert.throws(() => check(mutate(text)), assert.AssertionError);
}

// ---- Step 2: the pull ----

function assertGhCall(t) {
  assert.ok(cliCalls(step2(t)).some((c) => c.includes('bin/queue-pull.js" --transport gh')), 'Step 2 must run queue-pull.js --transport gh');
}
function assertFilesSelectedByPreflight(t) {
  const s = step2(t).replace(/\s+/g, ' ');
  assert.ok(s.includes('`--transport files`'), 'Step 2 must name --transport files');
  assert.match(s, /Preflight[^.]*`gh` absent or GraphQL-blocked[^.]*`mcp-transport\.md` Step 2[^.]*`--transport files`/,
    'one sentence must select files from the Preflight result, after the inputs mcp-transport.md Step 2 names');
  // A literal reader on a GraphQL-blocked Preflight meets the files condition before the gh command.
  assert.ok(s.indexOf('GraphQL-blocked') < s.indexOf('bin/queue-pull.js" --transport gh'), 'the MCP condition must come before the --transport gh call');
}
function assertExit2ToFiles(t) {
  assert.match(step2(t), /Exit 2\b[^.]*`files` path/, 'exit 2 must route to the files path');
}
function assertExit4Stops(t) {
  assert.match(step2(t).replace(/\s+/g, ' '), /Exit 4\b[^.]*stop the firing, quoting its last stderr line; Step 1's close-out runs/,
    'exit 4 must stop the firing, quote stderr and run the close-out');
}
function assertExit1Malformed(t) {
  assert.match(step2(t), /Exit 1\b[^.]*malformed call: fix it and re-run/, 'exit 1 must read as a malformed call to fix and re-run');
}
function assertCloseOutNamesPullStop(t) {
  const p = paragraph(step1(t), '**Every exit runs the close-out.**');
  assert.ok(p.includes('a queue-pull stop (exit 4)'), "Step 1's close-out list must name the queue-pull stop");
  assert.ok(!p.includes('queue-pull `exit 1`'), "Step 1's close-out list still names the script's exit 1");
}

test('AC2: Step 2 runs the pull as one queue-pull.js --transport gh call', () => {
  assertGoesRed(assertGhCall, SKILL, '`node "${CLAUDE_PLUGIN_ROOT}/bin/queue-pull.js" --transport gh`');
});

test('Review Focus 1: a gh-absent or GraphQL-blocked Preflight selects --transport files after the MCP inputs are written', () => {
  assertGoesRed(assertFilesSelectedByPreflight, SKILL, '(`gh` absent or GraphQL-blocked)');
  assertGoesRed(assertFilesSelectedByPreflight, SKILL, '`mcp-transport.md` Step 2');
  assertGoesRed(assertFilesSelectedByPreflight, SKILL, null, (t) => t.split('`--transport files`').join('`--transport gh`'));
  // The gh command moved ahead of the MCP condition.
  const GH_SENTENCE = ' Otherwise run `node "${CLAUDE_PLUGIN_ROOT}/bin/queue-pull.js" --transport gh`.';
  assertGoesRed(assertFilesSelectedByPreflight, SKILL, GH_SENTENCE, (t) => t.replace(GH_SENTENCE, '').replace('When Preflight took the MCP path', `${GH_SENTENCE.trim()} When Preflight took the MCP path`));
});

test('Review Focus 1: exit 2 routes to the files path', () => {
  assertGoesRed(assertExit2ToFiles, SKILL, 'Exit 2 (no `gh`): take the `files` path.');
});

test('Review Focus 2: exit 4 stops the firing, quoting stderr, with Step 1\'s close-out; exit 1 is a malformed call', () => {
  assertGoesRed(assertExit4Stops, SKILL, "stop the firing, quoting its last stderr line; Step 1's close-out runs");
  assertGoesRed(assertExit1Malformed, SKILL, 'Exit 1 is a malformed call: fix it and re-run.');
});

test("Review Focus 2: Step 1's close-out list names the queue-pull stop", () => {
  assertGoesRed(assertCloseOutNamesPullStop, SKILL, 'a queue-pull stop (exit 4), ');
  assertGoesRed(assertCloseOutNamesPullStop, SKILL, null, (t) => t.replace('a queue-pull stop (exit 4)', 'a queue-pull stop (exit 4), a queue-pull `exit 1`'));
});

// ---- Step 3: the ranking ----

function assertLoopRanks(t) {
  const loop = loopLine(t);
  assert.ok(cliCalls(loop).some((c) => c.includes('queue-pull.js" --rank')), 'the Loop must rank through queue-pull.js --rank');
  assert.ok(loop.includes('neighbour-in-flight'), 'the Loop must still name neighbour-in-flight groups as excluded');
}
function assertNextRanks(t) {
  assert.ok(cliCalls(nextBullet(t)).some((c) => c.includes('queue-pull.js" --rank')), 'the next bullet must rank through queue-pull.js --rank');
}
function assertRankExitRouted(t) {
  const loop = loopLine(t);
  const next = nextBullet(t);
  assert.match(loop, /a non-zero exit stops the firing, quoting its stderr line/, 'the Loop must stop the firing on a non-zero --rank exit, quoting stderr');
  assert.match(loop, /a non-zero exit[^)]*never a `null` pick/, 'the Loop must rule out reading a non-zero exit as a null pick');
  assert.match(next, /A non-zero exit (?:\([^)]*\) )?is never a `null` pick: stop the firing, quoting its stderr line; Step 1's close-out runs/,
    'the next bullet must route a non-zero --rank exit to a stop, never a null pick');
}
function assertPriorityOmitted(t) {
  assert.match(nextBullet(t), /omitting `--priority` when no band is set/, 'the next bullet must say to omit --priority with no band');
}
// No call passes --priority without a band: an empty value exits 1.
function assertNoEmptyPriority(t) {
  for (const call of cliCalls(t)) {
    for (const m of call.matchAll(/--priority(\S*)(?:\s+(\S+))?/g)) {
      assert.equal(m[1], '', `--priority glued to a value in ${call}`);
      assert.match(m[2] || '', /^(<band>\]?|high|medium|low)$/, `--priority without a band in ${call}`);
    }
  }
}

test('AC2: the Loop and the next bullet each rank with one queue-pull.js --rank call', () => {
  assertGoesRed(assertLoopRanks, SKILL, '`node "${CLAUDE_PLUGIN_ROOT}/bin/queue-pull.js" --rank [--priority <band>]` as `next` gives it');
  assertGoesRed(assertLoopRanks, SKILL, null, (t) => t.replace(loopLine(t), loopLine(t).split('neighbour-in-flight').join('neighbour')));
  assertGoesRed(assertNextRanks, SKILL, 'Run `node "${CLAUDE_PLUGIN_ROOT}/bin/queue-pull.js" --rank [--priority <band>]`, ');
});

test('a non-zero --rank exit stops the firing with the close-out, never a null pick', () => {
  assertGoesRed(assertRankExitRouted, SKILL, '; a non-zero exit stops the firing, quoting its stderr line, never a `null` pick');
  assertGoesRed(assertRankExitRouted, SKILL, ', quoting its stderr line, never a `null` pick)', (t) => t.replace(', quoting its stderr line, never a `null` pick)', ', never a `null` pick)'));
  assertGoesRed(assertRankExitRouted, SKILL, ', quoting its stderr line, never a `null` pick)', (t) => t.replace(', quoting its stderr line, never a `null` pick)', ', quoting its stderr line)'));
  assertGoesRed(assertRankExitRouted, SKILL, "is never a `null` pick: stop the firing, quoting its stderr line; Step 1's close-out runs");
});

test('Review Focus 4: with no band set the prose omits --priority, and no call passes it empty', () => {
  assertGoesRed(assertPriorityOmitted, SKILL, ', omitting `--priority` when no band is set');
  assertGoesRed(assertNoEmptyPriority, SKILL, null, (t) => t.replace('--rank [--priority <band>]`', '--rank --priority ""`'));
  assertGoesRed(assertNoEmptyPriority, SKILL, null, (t) => t.replace('--rank [--priority <band>]`', '--rank --priority`'));
  assertNoEmptyPriority(FIRING);
});

// ---- firing-exclusion.md ----

const CONTINUATION = '**A continuation reads this file before its first pick';
function assertContinuationRanks(t) {
  const p = paragraph(t, CONTINUATION);
  assert.ok(cliCalls(p).some((c) => c.includes('bin/queue-pull.js" --rank')), 'a continuation must pick through queue-pull.js --rank');
  assert.ok(p.includes('never re-derive candidates from the raw `dispatch-groups.json`'), 'a continuation must never pick from the raw groups file');
}
function assertRankingNamed(t) {
  const p = paragraph(t, '`queue-pull.js --rank`');
  assert.match(p, /`rankNext`/, 'the ranking paragraph must name the module function');
  assert.match(p, /groupIsExcluded\(g, entries, \['oversized', 'firing', 'neighbour-in-flight'\]\)/);
}
function assertNoNextRankingScript(t) {
  assert.ok(!t.includes('next-ranking.md'), 'firing-exclusion.md still points at next-ranking.md');
}

test('Review Focus 3: a continuation picks through queue-pull.js --rank, never from the raw groups file', () => {
  assertGoesRed(assertContinuationRanks, FIRING, '`node "${CLAUDE_PLUGIN_ROOT}/bin/queue-pull.js" --rank [--priority <band>]`');
  assertGoesRed(assertContinuationRanks, FIRING, 'never\nre-derive candidates from the raw `dispatch-groups.json`');
  assertGoesRed(assertRankingNamed, FIRING, '`rankNext`');
  assertGoesRed(assertNoNextRankingScript, FIRING, null, (t) => `${t}\nRun \`next-ranking.md\`'s script verbatim.\n`);
});

// ---- every call shape is the CLI's ----

function usageFlags() {
  const r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return new Set(r.stdout.match(/--[a-z][a-z-]*/g));
}
function assertFlagsInUsage(t, usage) {
  const calls = cliCalls(t);
  assert.ok(calls.length >= 1, 'no queue-pull.js call found');
  for (const call of calls) {
    for (const flag of call.match(/--[a-z][a-z-]*/g) || []) assert.ok(usage.has(flag), `${flag} (in ${call}) is not in queue-pull.js --help`);
  }
}

test('every --flag in a queue-pull.js call is in the CLI usage text', () => {
  const usage = usageFlags();
  for (const flag of ['--transport', '--rank', '--priority']) assert.ok(usage.has(flag), `usage parse lost ${flag}`);
  assert.ok(cliCalls(SKILL).length >= 3, 'SKILL.md carries the pull call, the Loop call and the next call');
  assertGoesRed((t) => assertFlagsInUsage(t, usage), SKILL, null, (t) => t.replace('queue-pull.js" --rank', 'queue-pull.js" --rnak'));
  assertGoesRed((t) => assertFlagsInUsage(t, usage), FIRING, null, (t) => t.replace('queue-pull.js" --rank', 'queue-pull.js" --rnak'));
});

// ---- AC2 negative ----

// The three AC2 phrases, plus the script's name: no SKILL.md step may send the session to it.
const RETIRED = ['run its script verbatim', 'run it verbatim', 'next-ranking.md', 'queue-pull-script.md'];
function assertNoScriptRun(t) {
  for (const phrase of RETIRED) assert.ok(!t.includes(phrase), `SKILL.md still says ${phrase}`);
}

test('AC2: SKILL.md no longer tells the session to read and run either script', () => {
  for (const phrase of RETIRED) assertGoesRed(assertNoScriptRun, SKILL, null, (t) => `${t}\n${phrase}\n`);
});

// The sub-files the Step 3 walk reads (the Loop's firing guard, the explicit list's predicted-conflict
// step, the #N form's unreadable-exclusions probe) no longer send the session to the script either.
const STEP3_FILES = ['firing-exclusion.md', 'near-duplicate-pairs.md', 'exclusions-unreadable-report.md'];
function assertNoScriptCitation(t) {
  assert.ok(!t.includes('queue-pull-script.md'), 'a Step 3 sub-file still cites queue-pull-script.md');
}

test('AC2: the Step 3 sub-files no longer cite queue-pull-script.md', () => {
  for (const name of STEP3_FILES) {
    assertGoesRed(assertNoScriptCitation, readText(path.join(DISPATCH, name)), null, (t) => `${t}\nRe-run \`queue-pull-script.md\`'s line.\n`);
  }
});
