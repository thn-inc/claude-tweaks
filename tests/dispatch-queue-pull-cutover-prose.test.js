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
const fs = require('node:fs');
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
// The MCP path runs mcp-transport.md Step 2's own files call, every input flag included: the call
// written in Step 2 is the gh one, and --foreign-states has no session default (#5230 final review I2).
function assertFilesRunsMcpCall(t) {
  const s = step2(t).replace(/\s+/g, ' ');
  assert.match(s, /`mcp-transport\.md` Step 2 names and run its `--transport files` call \(every input flag\)/,
    "the MCP path must run mcp-transport.md Step 2's own files call, every input flag included");
  assert.ok(!s.includes('run the call below with `--transport files`'), 'Step 2 must not send the MCP path to the gh call with the transport swapped');
}
function assertExit2ToFiles(t) {
  assert.match(step2(t), /Exit 2\b[^.]*`files` path/, 'exit 2 must route to the files path');
}
function assertExit4Stops(t) {
  // A `see error above` stop prints its cause on the line before it (#5230 final review M1).
  assert.match(step2(t).replace(/\s+/g, ' '), /Exit 4\b[^;]*stop the firing, quoting the stop line and, when it says `see error above`, the cause line\(s\) above it; Step 1's close-out runs/,
    'exit 4 must stop the firing, quote the stop line and its cause line, and run the close-out');
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

test("#5230 final review I2: the MCP path runs mcp-transport.md Step 2's own --transport files call, every input flag included", () => {
  const RUN_ITS_CALL = ' and run its `--transport files` call (every input flag).';
  assertGoesRed(assertFilesRunsMcpCall, SKILL, ' (every input flag)');
  // The pre-fix sentence: the gh call below, with only the transport swapped.
  assertGoesRed(assertFilesRunsMcpCall, SKILL, RUN_ITS_CALL, (t) => t.replace(RUN_ITS_CALL, ', then run the call below with `--transport files`.'));
});

test('Review Focus 1: exit 2 routes to the files path', () => {
  assertGoesRed(assertExit2ToFiles, SKILL, 'Exit 2 (no `gh`): take the `files` path.');
});

test('Review Focus 2: exit 4 stops the firing, quoting stderr, with Step 1\'s close-out; exit 1 is a malformed call', () => {
  const QUOTES_CAUSE = 'quoting the stop line and, when it says `see error above`, the cause line(s) above it';
  assertGoesRed(assertExit4Stops, SKILL, ", the cause line(s) above it; Step 1's close-out runs", (t) => t.replace(', the cause line(s) above it;', ';'));
  // The pre-fix wording quoted only the last stderr line, which for a `see error above` stop is the stop line.
  assertGoesRed(assertExit4Stops, SKILL, QUOTES_CAUSE, (t) => t.replace(QUOTES_CAUSE, 'quoting its last stderr line'));
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

// ---- mcp-transport.md Step 2: the files transport (AC5) ----

const MCP = readText(path.join(DISPATCH, 'mcp-transport.md'));
const MCP_STEP2_FIRST = '## Step 2 — queue pull and per-dependency open-state check';
// Step 2 runs from its first section to the end of the file (the #2523 section is the last one).
const mcpStep2 = (t) => {
  const start = t.indexOf(MCP_STEP2_FIRST);
  assert.ok(start !== -1, `${MCP_STEP2_FIRST} not found`);
  return t.slice(start);
};

// The structural anchor: a ```bash fence whose first line starts the files-transport call.
const FILES_CALL_PREFIX = 'node "${CLAUDE_PLUGIN_ROOT}/bin/queue-pull.js" --transport files';
function filesCallFences(text) {
  const lines = text.split(/\r?\n/);
  const fences = [];
  for (let i = 0; i + 1 < lines.length; i += 1) {
    if (lines[i] !== '```bash' || !lines[i + 1].startsWith(FILES_CALL_PREFIX)) continue;
    const end = lines.indexOf('```', i + 1);
    assert.ok(end !== -1, 'the files-call fence is never closed');
    fences.push(lines.slice(i + 1, end).join('\n'));
  }
  return fences;
}

// One command -> argv. Backslash-newline continuations are joined; a token is a double-quoted
// string (unquoted) or a bare word. Anything a plain argv cannot hold (a second line, a pipe, a
// redirect, a command separator, an expansion other than the plugin root) fails.
function tokenize(command) {
  const joined = command.replace(/\\\n/g, ' ');
  assert.ok(!joined.includes('\n'), `the fence holds more than one command: ${command}`);
  const tokens = [];
  for (const m of joined.matchAll(/"([^"]*)"|(\S+)/g)) {
    const token = m[1] !== undefined ? m[1] : m[2];
    assert.ok(m[1] !== undefined || !/[;&|<>`$'"\\]/.test(token), `not a plain argv word: ${token}`);
    assert.ok(!token.replace('${CLAUDE_PLUGIN_ROOT}', '').includes('$'), `an expansion in ${token}`);
    tokens.push(token);
  }
  return tokens;
}

// The flag, the session file name its `{name}` placeholder resolves to, and the shape the prose
// names beside it (bin/queue-pull.js's INPUT_FLAGS; the shapes the module reads, lib/dispatch/
// queue-pull.js: runFetch / agentQueueRaw / agentDepFreshness, the blocked pass, the neighbour pass's
// claimReaderFromMap, and the foreignStates input).
const FILES_INPUTS = [
  ['--queue-raw', 'dispatch-queue-raw.json', '`[{number, title, body, labels, created_at, updated_at, state}]`'],
  ['--dep-freshness', 'dispatch-dep-freshness.json', '`[{number, updated_at, state}]`'],
  ['--open-numbers', 'dispatch-open-numbers.json', '`[{number}]`'],
  ['--verified-open-deps', 'dispatch-verified-open-deps.txt', 'one number per line'],
  ['--in-flight-raw', 'dispatch-in-flight-raw.json', '`[{number, title, body, labels}]`'],
  ['--in-flight-claims', 'dispatch-in-flight-claims.json', '`{"<n>": <claim>}`'],
  ['--foreign-states', 'dispatch-foreign-states.json', '`{"owner/name#N": "<state>"}`'],
];

// The call's argv after `node <script>`, and its `--flag {name}` pairs.
function filesCallArgv(t) {
  const fences = filesCallFences(t);
  assert.equal(fences.length, 1, 'mcp-transport.md carries exactly one queue-pull.js --transport files call');
  const tokens = tokenize(fences[0]);
  assert.deepEqual(tokens.slice(0, 2), ['node', '${CLAUDE_PLUGIN_ROOT}/bin/queue-pull.js']);
  return tokens.slice(2);
}
function assertFilesCall(t) {
  const argv = filesCallArgv(t);
  assert.deepEqual(argv.slice(0, 2), ['--transport', 'files']);
  const pairs = [];
  for (let i = 2; i < argv.length; i += 2) pairs.push([argv[i], argv[i + 1]]);
  assert.deepEqual(pairs, FILES_INPUTS.map(([flag, name]) => [flag, `{${name}}`]), 'each input flag names its own {name} placeholder, once');
}
// Each flag is named in Step 2 with its placeholder and its file shape, on one bullet.
function assertInputsNamed(t) {
  const lines = mcpStep2(t).split('\n');
  for (const [flag, name, shape] of FILES_INPUTS) {
    const bullet = lines.find((l) => l.startsWith(`- \`${flag} "{${name}}"\``));
    assert.ok(bullet, `no Step 2 bullet names ${flag} "{${name}}"`);
    assert.ok(bullet.includes(shape), `the ${flag} bullet does not name its shape ${shape}`);
  }
}
// The claim reads cover the whole pool (the CLI header's rule), never a claim-targets subset.
const CLAIM_READS = '**2. Claim reads.**';
function assertClaimsCoverThePool(t) {
  const p = paragraph(t, CLAIM_READS);
  assert.ok(p.includes('the claim of every record in the pool file'), 'the claim reads must cover every record in the pool file');
  assert.ok(p.includes('a number left out of the map counts as a failed claim read'), 'the claims paragraph must say what a left-out number does');
}
// Step 2 sends the agent to no script, and never calls the MCP path one call (the fetch-and-Write calls remain).
const MCP_RETIRED = ['run the script as written', 'alias_mcp_timestamps', 'NEIGHBOUR_RC', 'export DISPATCH_FOREIGN_STATES'];
function assertNoScriptRunInMcpStep2(t) {
  const s = mcpStep2(t);
  for (const phrase of MCP_RETIRED) assert.ok(!s.includes(phrase), `mcp-transport.md Step 2 still says ${phrase}`);
  // The queue-pull section only: the #1224 section's "one call for one already-known issue" is an issue_read cost.
  const pull = section(s, MCP_STEP2_FIRST, '\n## ');
  assert.doesNotMatch(pull.replace(/\s+/g, ' '), /\bone (?:`[^`]*` )?call\b/i, 'the MCP path is never described as one call');
  assert.ok(pull.includes('with the Write tool'), 'the agent still writes each fetched file with the Write tool');
}

// The --foreign-states refs are the set the module's `blocked` pass reads (bodyForeignBlockers over
// the queue records with no bot:* label), stated in terms the agent can compute before the pull --
// never "eligible", which only the pull decides (#5230 final review M2).
const FOREIGN_BULLET = '- `--foreign-states "{dispatch-foreign-states.json}"`';
const NO_BOT_LABELS = 'carries none of `bot:in-progress`, `bot:blocked` or `bot:parked`';
function assertForeignSetDefined(t) {
  const bullet = mcpStep2(t).split('\n').find((l) => l.startsWith(FOREIGN_BULLET));
  assert.ok(bullet, 'no --foreign-states bullet');
  assert.ok(bullet.includes('`Blocked by owner/name#N` ref in the body of a queue record that'), 'the --foreign-states bullet must name the refs in queue records\' bodies');
  assert.ok(bullet.includes(NO_BOT_LABELS), 'the --foreign-states bullet must define the set by the three bot:* labels');
  const s = mcpStep2(t).replace(/\s+/g, ' ');
  for (const vague of ["eligible candidate's body-declared foreign refs", "the candidates' body-declared foreign refs"]) {
    assert.ok(!s.includes(vague), `mcp-transport.md Step 2 still says ${vague}`);
  }
}

test('#5230 final review M2: the --foreign-states set is the queue records with no bot:* label, known before the pull', () => {
  assertGoesRed(assertForeignSetDefined, MCP, null, (t) => t.split('\n').map((l) => (l.startsWith(FOREIGN_BULLET) ? l.split(NO_BOT_LABELS).join('carries no label') : l)).join('\n'));
  assertGoesRed(assertForeignSetDefined, MCP, null, (t) => t.replace('the state of each `Blocked by owner/name#N` ref in the body of a queue record that', "the states of the candidates' body-declared foreign refs, each in a record that"));
  assertGoesRed(assertForeignSetDefined, MCP, null, (t) => `${t}\ncollect each eligible candidate's body-declared foreign refs\n`);
});

test('#5230 AC5: mcp-transport.md Step 2 names every files input with its flag, placeholder and shape, and ends in the one files-transport call', () => {
  assertGoesRed(assertFilesCall, MCP, null, (t) => t.split('--in-flight-claims "{dispatch-in-flight-claims.json}" \\').join('--in-flight-claims "{dispatch-in-flight-raw.json}" \\'));
  assertGoesRed(assertFilesCall, MCP, null, (t) => t.replace(' --foreign-states "{dispatch-foreign-states.json}"', ''));
  // A second files call (the old split-script shape) is refused too.
  assertGoesRed(assertFilesCall, MCP, null, (t) => `${t}\n\`\`\`bash\n${FILES_CALL_PREFIX}\n\`\`\`\n`);
  for (const [flag, , shape] of FILES_INPUTS) {
    assertGoesRed(assertInputsNamed, MCP, null, (t) => t.split('\n').map((l) => (l.startsWith(`- \`${flag} `) ? l.split(shape).join('') : l)).join('\n'));
  }
  assertGoesRed(assertClaimsCoverThePool, MCP, 'the claim of every record in the pool file');
  assertGoesRed(assertClaimsCoverThePool, MCP, 'a number left out of the map counts as a failed claim read');
  for (const phrase of MCP_RETIRED) assertGoesRed(assertNoScriptRunInMcpStep2, MCP, null, (t) => `${t}\n${phrase}\n`);
  assertGoesRed(assertNoScriptRunInMcpStep2, MCP, null, (t) => t.replace(`${MCP_STEP2_FIRST}\n`, `${MCP_STEP2_FIRST}\n\nThe MCP path is one call.\n`));
  assertGoesRed(assertNoScriptRunInMcpStep2, MCP, null, (t) => t.replace(`${MCP_STEP2_FIRST}\n`, `${MCP_STEP2_FIRST}\n\nRun it as one \`queue-pull.js\` call.\n`));
  assertGoesRed(assertNoScriptRunInMcpStep2, MCP, null, (t) => t.split('with the Write tool').join('with a tool'));
});

// The AC5 run: the extracted call's argv through the real CLI in the S1-files-miss sandbox (the
// parity matrix's `createSandbox(PARITY_S1(), { transport: 'files' })`: no gh anywhere on PATH, the
// frozen clock, its own TMPDIR), never the real repo or wall clock. Each `{name}` resolves under
// <root>/agent-in rather than the session dir, so no input sits at a CLI default path and a flag the
// call drops reads nothing instead of the default. On S1 that turns this run red for a dropped
// --queue-raw, --dep-freshness, --open-numbers, --in-flight-raw or --in-flight-claims, but not for
// --verified-open-deps or --foreign-states: S1's inputs for those two are empty (no OPEN unresolved
// dependency, no foreign ref), so reading nothing changes no output. Those two rest on
// assertFilesCall's pair pin alone (each flag dropped by a scratch mutation, #5230 fix round 1).
// The reference is the S1-files-miss parity row's
// module run (`--transport files`, the same agentInputs staged at the default session paths), which
// that row holds equal to the oracle.
const { createSandbox, runModuleCli, normalize, oracleSkip } = require('./bin-lib/dispatch/queue-pull-oracle');
const { S1, agentInputs } = require('./bin-lib/dispatch/queue-pull-fixtures');

const AC5_FILES = ['dispatch-groups.json', 'dispatch-exclusions.json', 'dispatch-fastlane-bundles.json', 'dispatch-near-dup-pairs.json',
  'dispatch-crosspr-overlap.json', 'dispatch-next-pick.json'];
const parsedOrRaw = (text) => {
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return text; }
};
const viewOf = (r, sb) => normalize({
  status: r.status,
  files: Object.fromEntries(AC5_FILES.map((name) => [name, parsedOrRaw(r.files[name])])),
  orderBlob: r.orderBlob,
}, sb);

// The pull, then `--rank` in the same session; argv's `{name}` placeholders resolve under agent-in.
async function pullAndRank(sb, argv, content) {
  const dir = path.join(sb.root, 'agent-in');
  fs.mkdirSync(dir, { recursive: true });
  const resolved = argv.map((a) => {
    const m = /^\{([^{}]+)\}$/.exec(a);
    if (!m) return a;
    const file = path.join(dir, m[1]);
    if (content[m[1]] !== undefined) fs.writeFileSync(file, content[m[1]]);
    return file;
  });
  const pulled = await runModuleCli(sb, resolved, { tmp: 'pull' });
  assert.equal(pulled.status, 0, pulled.stderr.slice(-3000));
  const ranked = await runModuleCli(sb, ['--rank'], { tmp: 'pull' });
  assert.equal(ranked.status, 0, ranked.stderr.slice(-3000));
  return { pulled, ranked };
}

test('#5230 AC5: the mcp-transport.md files call, gh absent, reproduces the #5227 files fixture outputs', { skip: oracleSkip(), timeout: 300_000 }, async () => {
  const argv = filesCallArgv(MCP);
  // What the agent writes: S1's MCP-shaped inputs (the parity row's), and `{}` foreign states (S1
  // declares no foreign ref). Keyed by the session file name each placeholder names.
  const inputs = agentInputs(S1({ parity: true }));
  const content = { ...inputs, 'dispatch-foreign-states.json': '{}' };
  const sandboxes = [];
  const make = () => {
    const sb = createSandbox(S1({ parity: true }), { transport: 'files', name: 'S1-files-miss' });
    sandboxes.push(sb);
    return sb;
  };
  try {
    const refSb = make();
    const refPull = await runModuleCli(refSb, ['--transport', 'files'], { stage: inputs, tmp: 'pull' });
    assert.equal(refPull.status, 0, refPull.stderr.slice(-3000));
    const refRank = await runModuleCli(refSb, ['--rank'], { tmp: 'pull' });
    const reference = viewOf(refRank, refSb);
    // Control: the reference is the full S1 files run, not an empty pull.
    assert.ok(reference.files['dispatch-groups.json'].length > 0, 'the reference groups something');
    assert.ok(reference.files['dispatch-exclusions.json'].some((e) => e.reason === 'neighbour-in-flight' && e.records[0] === 9013), 'the reference excludes #9013 as a neighbour');
    assert.deepEqual(reference.files['dispatch-crosspr-overlap.json'], []);
    assert.ok(reference.files['dispatch-next-pick.json'], 'the reference picks a group');
    assert.ok(reference.orderBlob, 'the reference persists its blob');

    const docSb = make();
    const { pulled, ranked } = await pullAndRank(docSb, argv, content);
    assert.deepEqual(pulled.ghArgv, [], 'no gh call is made (there is no gh on PATH)');
    assert.deepEqual(viewOf(ranked, docSb), reference);

    // Review Focus 5: a claims map that leaves a pool record out reads it as a failed claim read,
    // so its neighbour is missed -- why the claims file must cover every record in the pool file.
    const shortSb = make();
    const short = await pullAndRank(shortSb, argv, { ...content, 'dispatch-in-flight-claims.json': '{}' });
    const shortExclusions = JSON.parse(short.ranked.files['dispatch-exclusions.json']);
    assert.ok(!shortExclusions.some((e) => e.reason === 'neighbour-in-flight'), 'no neighbour-in-flight entry without #7001\'s claim');
    assert.ok(short.pulled.stderr.includes('AUTO — dispatch: neighbour-in-flight claim read failed for #7001; treated as not in flight'), short.pulled.stderr);
  } finally {
    for (const sb of sandboxes) sb.cleanup();
  }
});
