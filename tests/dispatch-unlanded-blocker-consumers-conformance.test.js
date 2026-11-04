// tests/dispatch-unlanded-blocker-consumers-conformance.test.js — #4792.
//
// Pins the consumers of queue-pull-script.md's unlanded-blocker pass: the exclusion report that renders
// its `unlanded-blocker` and `malformed-blocker` entries, the gh-absent (MCP transport) section that runs
// the pass as written, and the skill-graph and plugin-structure rows that name the edge. The pass's own
// logic is pinned by tests/bin-lib/dispatch/unlanded-blockers*.test.js and its call site by
// tests/dispatch-unlanded-blocker-exclusion-fixture.test.js. The prose pinned here is added in the same
// change, so every assertion proves itself on a mutated copy of the live text.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith, sectionOf } = require('./helpers/conformance-asserts');
const { NATIVE_MISSING_CAUSE, malformedRecords } = require('../plugin/bin/lib/dispatch/unlanded-blockers');

const ROOT = path.join(__dirname, '..');
const REPORT = readText(path.join(ROOT, 'plugin', 'skills', 'dispatch', 'blocked-exclusion-report.md'));
const MCP = readText(path.join(ROOT, 'plugin', 'skills', 'dispatch', 'mcp-transport.md'));
const SKILL_GRAPH = readText(path.join(ROOT, 'docs', 'skill-graph.md'));
const PLUGIN_STRUCTURE = readText(path.join(ROOT, 'docs', 'plugin-structure.md'));

const collapse = (s) => s.replace(/\s+/g, ' ');

// Each marker must exist before the order is checked, so a reworded marker fails as missing, not as
// a vacuous pass.
function requireOrder(text, markers) {
  const at = markers.map((m) => text.indexOf(m));
  at.forEach((idx, i) => assert.notEqual(idx, -1, `marker missing: ${markers[i]}`));
  for (let i = 1; i < markers.length; i++) {
    assert.ok(at[i] > at[i - 1], `${markers[i]} must come after ${markers[i - 1]}`);
  }
}

// --- blocked-exclusion-report.md ---------------------------------------------------------------------

const REPORT_START = "Then read the same file's `reason: 'unlanded-blocker'`";
const REPORT_CHUNKS = 4; // unlanded intro, unlanded line, malformed intro, malformed line
const TARGET_MISSING_LINE = '`#{number} excluded — named target {path}';
const EXCEPTION = '**Exception — the headless drain steady state.**';

function reportParagraphs(text) {
  const chunks = text.split('\n\n');
  const at = chunks.findIndex((c) => c.startsWith(REPORT_START));
  assert.notEqual(at, -1, `report paragraph not found: ${REPORT_START}`);
  return { chunks, at, paragraphs: chunks.slice(at, at + REPORT_CHUNKS) };
}

const REPORT_FACTS = [
  [/`reason: 'unlanded-blocker'` entries \(`records: \[number\], detail: \{blockers: \[\{blocker, commit\}\]\}` each, #4792/, 'reads the unlanded-blocker entries'],
  [/under the same exception and empty-array rules below/, 'inherits the headless-silence and empty rules'],
  [/`#\{number\} excluded — blocker not landed: #\{blocker\} \(closing commit \{commit\}\), … — eligible again once it reaches the integration branch`/, 'AC3.1: the report line names blocker, commit and when it is eligible again'],
  [/Then its `reason: 'malformed-blocker'` entries \(`records: \[number\], detail: \{cause\}` each, #4792/, 'AC4.3: reads the malformed-blocker entries'],
  [/`#\{number\} excluded — malformed blocker declaration: \{cause\} — eligible again once its blocker declaration can be checked`/, 'AC4.2 AC4.3: the malformed record has its own report line'],
];
const reportMissing = missingFactsOf(REPORT_FACTS);
const reportRegion = (text) => collapse(reportParagraphs(text).paragraphs.join('\n\n'));
const assertReportPlacement = (text) => requireOrder(text, [TARGET_MISSING_LINE, REPORT_START, EXCEPTION]);

test('AC3.1 AC4.3: blocked-exclusion-report.md renders unlanded-blocker and malformed-blocker entries (#4792)', () => {
  const region = reportRegion(REPORT);
  assert.deepEqual(reportMissing(region), []);
  assertEachPatternGoesRed(region, REPORT_FACTS, reportMissing);
  // The slice is exactly the four chunks: the line after them is the Exception paragraph.
  const { chunks, at } = reportParagraphs(REPORT);
  assert.ok(chunks[at + REPORT_CHUNKS].startsWith(EXCEPTION), 'the report paragraph is followed by the Exception paragraph');

  assertReportPlacement(REPORT);
  // Permutation, not deletion: the four chunks move below the Exception paragraph.
  const rest = chunks.filter((_, i) => i < at || i >= at + REPORT_CHUNKS);
  const exceptionAt = rest.findIndex((c) => c.startsWith(EXCEPTION));
  const moved = [...rest.slice(0, exceptionAt + 1), ...chunks.slice(at, at + REPORT_CHUNKS), ...rest.slice(exceptionAt + 1)].join('\n\n');
  assert.notEqual(moved, REPORT);
  assert.throws(() => assertReportPlacement(moved), /must come after/);
});

test("AC4.3: the malformed-blocker report line's cause is a cause the CLI writes", () => {
  const line = lineStartingWith(REPORT, '`#{number} excluded — malformed blocker declaration:');
  assert.ok(line, 'the malformed-blocker report line exists');
  const screened = malformedRecords([{ number: 13, body: 'Blocked by #0', labels: [] }]);
  assert.equal(screened.length, 1, 'the screen flags the Blocked by #0 record');
  const fill = (template, cause) => template.replace('{number}', '13').replace('{cause}', cause);
  const causes = [NATIVE_MISSING_CAUSE, screened[0].cause];
  for (const cause of causes) {
    assert.ok(cause && typeof cause === 'string', 'the CLI writes a non-empty cause');
    assert.ok(!fill(line, cause).includes('{'), `a filled report line has no placeholder left: ${fill(line, cause)}`);
  }
  // Control: a line whose cause placeholder was renamed leaves one behind.
  const renamed = line.replace('{cause}', '{reason}');
  assert.notEqual(renamed, line);
  assert.ok(fill(renamed, causes[0]).includes('{'), 'a renamed placeholder survives filling');
});

// --- mcp-transport.md ---------------------------------------------------------------------------------

const MCP_HEADING = '## Step 2 — unlanded-blocker exclusion (#4792)';
const MCP_FACTS = [
  [/Run the pass's `if node … dispatch-unlanded-blockers\.js … fi` block as written anyway/, 'MCP path runs the block'],
  [/its `malformed-blocker` screen reads only the bodies already in `dispatch-groups\.json`, so it still excludes/, 'AC4.3: the screen needs no gh'],
  [/the GitHub MCP server has no generic GraphQL bridge \(the #2523 section below\)/, 'cites the #2523 convention'],
  [/reads every closed blocker `undetermined`, so it can never return the `unlanded` verdict/, 'why no MCP substitute'],
  [/`\/claude-tweaks:flow` Step 2\.7b has the same blind spot on this transport/, 'same blind spot as /flow'],
  [/the CLI prints one `Warning:` line and excludes no `unlanded-blocker` record/, 'run as written, the landing call fails open'],
];
const mcpMissing = missingFactsOf(MCP_FACTS);
const mcpSection = (text) => collapse(sectionOf(text, MCP_HEADING));
const MCP_ORDER = ['## Step 2 — cross-PR overlap report (#1579)', MCP_HEADING, '## Step 2 — native blocked-by / linked-PR batching: no generic GraphQL bridge (#2523)'];

test('AC4.3: mcp-transport.md runs the unlanded-blocker pass as written on a gh-absent firing (#4792)', () => {
  const section = mcpSection(MCP);
  assert.deepEqual(mcpMissing(section), []);
  assertEachPatternGoesRed(section, MCP_FACTS, mcpMissing);
  const bansSkip = (s) => /skip the pass's/i.test(s);
  assert.ok(!bansSkip(section), "the pre-Q4 'skip the pass's' instruction is gone");
  // Control: the ban goes red on a copy carrying the phrase, capitalized as a sentence start too.
  for (const phrase of ["skip the pass's block", "Skip the pass's block"]) {
    const doctored = `${section} ${phrase}`;
    assert.notEqual(doctored, section);
    assert.ok(bansSkip(doctored), `the ban must catch "${phrase}"`);
  }
});

test('mcp-transport.md places the unlanded-blocker section above the #2523 section it cites (#4792)', () => {
  requireOrder(MCP, MCP_ORDER);
  // Permutation, not deletion: the section moves below the #2523 heading (to the end of the file).
  const raw = sectionOf(MCP, MCP_HEADING).trimEnd();
  const without = MCP.replace(`${raw}\n\n`, '');
  assert.notEqual(without, MCP);
  const moved = `${without.replace(/\n*$/, '')}\n\n${raw}\n`;
  assert.throws(() => requireOrder(moved, MCP_ORDER), /must come after/);
  assert.throws(() => requireOrder(without, MCP_ORDER), /marker missing/);
});

// --- docs ---------------------------------------------------------------------------------------------

const GRAPH_ROW_PREFIX = '| `bin/dispatch-unlanded-blockers.js` (`bin/lib/dispatch/unlanded-blockers.js`) |';
const GRAPH_NEEDLES = [
  'queue-pull-script.md',
  '--prefetched-json',
  "reason: 'unlanded-blocker'",
  "reason: 'malformed-blocker'",
  'every other candidate is still checked',
  'blocked-exclusion-report.md',
  'mcp-transport.md',
];

test('skill-graph names the unlanded-blocker queue-pull edge (#4792)', () => {
  const row = lineStartingWith(SKILL_GRAPH, GRAPH_ROW_PREFIX);
  assert.ok(row, `skill-graph row missing: ${GRAPH_ROW_PREFIX}`);
  for (const needle of GRAPH_NEEDLES) assert.ok(collapse(row).includes(needle), `the skill-graph row names ${needle}`);
  // Controls: removing the line fails the existence check; removing one needle fails that needle.
  const without = SKILL_GRAPH.split('\n').filter((l) => !l.startsWith(GRAPH_ROW_PREFIX)).join('\n');
  assert.notEqual(without, SKILL_GRAPH);
  assert.equal(lineStartingWith(without, GRAPH_ROW_PREFIX), '');
  for (const needle of GRAPH_NEEDLES) {
    const stripped = row.split(needle).join('');
    assert.notEqual(stripped, row, `needle ${needle} is in the row`);
    assert.ok(!collapse(stripped).includes(needle));
  }
});

const STRUCTURE_CLAUSE = 'and where the not-spec-shaped, open-linked-PR, named-target and unlanded-blocker passes sit and why (#4792)';

test("plugin-structure.md describes queue-pull-notes.md's pass-placement section", () => {
  const HEADING = '### Skills with sub-files';
  const dispatchRow = (text) => lineStartingWith(sectionOf(text, HEADING), '| dispatch |');
  const row = dispatchRow(PLUGIN_STRUCTURE);
  assert.ok(row, 'the dispatch row exists under the sub-files heading');
  assert.ok(collapse(row).includes(STRUCTURE_CLAUSE), 'the dispatch row carries the pass-placement clause');
  const without = row.replace(STRUCTURE_CLAUSE, '');
  assert.notEqual(without, row);
  assert.ok(!collapse(without).includes(STRUCTURE_CLAUSE));

  // Control: the row moved out of the sub-files section (to just under `## Commands`) is no longer found.
  const stripped = PLUGIN_STRUCTURE.split('\n').filter((l) => l !== row).join('\n');
  assert.notEqual(stripped, PLUGIN_STRUCTURE);
  const moved = stripped.replace('\n## Commands\n', `\n## Commands\n${row}\n`);
  assert.notEqual(moved, stripped);
  assert.equal(dispatchRow(moved), '', 'a dispatch row outside the sub-files section is not found');
});
