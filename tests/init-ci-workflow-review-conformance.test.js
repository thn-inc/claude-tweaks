'use strict';
// Pins #5162's init CI workflow review prose — Step 22's sub-file and SKILL.md
// paragraph, the Update Mode row and its drift-count exclusion, the ci-review
// token on every surface that lists init's step tokens, and the Step 22 check
// table against its code twin CHECKS. A prose test per
// skill-prose-conformance-tests: facts go through missingFactsOf, and each is
// proven red on a mutated copy of the live text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { CHECKS } = require('../plugin/bin/lib/init/ci-workflow-review');
const { extractArgumentHint } = require('../plugin/bin/lib/skill-audit/argument-hint');
const { readText } = require('./helpers/read-skill');
const {
  missingFactsOf, assertEachPatternGoesRed, assertEveryMatchGoesRed, lineStartingWith, sectionOf,
} = require('./helpers/conformance-asserts');

function read(relPath) { return readText(path.join(__dirname, '..', relPath)); }

const SKILL = read('plugin/skills/init/SKILL.md');
const STEP = read('plugin/skills/init/bootstrap/step-22-ci-workflow-review.md');
const UPDATE = read('plugin/skills/init/update-mode.md');
const GRAMMAR = read('plugin/skills/init/input-grammar.md');
const GATE = read('plugin/skills/init/scope-selection-gate.md');
const INDEX = read('plugin/skills/init/bootstrap-steps.md');
const CARD = read('plugin/skills/help/reference-card.md');
const DOC = read('plugin/skills/_shared/ci-skips-drafts.md');

// The text from a whole `### ` heading line to the next `### ` or `## ` heading.
function subsectionOf(text, heading) {
  const padded = `\n${text}\n`;
  const start = padded.indexOf(`\n${heading}\n`);
  if (start === -1) throw new Error(`subsection heading missing: ${heading}`);
  const ends = [padded.indexOf('\n### ', start + 1), padded.indexOf('\n## ', start + 1)].filter((i) => i !== -1);
  return padded.slice(start + 1, ends.length > 0 ? Math.min(...ends) : padded.length);
}

const PHASE_1U6 = '## Phase 1u.6: Update Mode Early-Exit Gate';
const ROW_HEADING = '### CI Workflow Review';

// --- SKILL.md's Step 22 paragraph -------------------------------------------

const STEP21 = '### Step 21: Release Bootstrap';
const STEP22 = '### Step 22: CI Workflow Review';
const FINALIZING = '### Finalizing the worktree-always Decision';

function step22Block(text) {
  const s21 = text.indexOf(STEP21);
  const s22 = text.indexOf(STEP22);
  const fin = text.indexOf(FINALIZING);
  if (s21 === -1 || s22 === -1 || fin === -1) throw new Error('Step 22 paragraph: marker missing (Step 21, Step 22 or the finalization heading)');
  if (!(s21 < s22 && s22 < fin)) throw new Error('Step 22 paragraph: out of order — it must sit after Step 21 and before the finalization section');
  const body = text.slice(s22, fin);
  if (!body.includes('bootstrap/step-22-ci-workflow-review.md')) throw new Error('Step 22 paragraph: does not cite its sub-file');
  if (!body.includes('report-only')) throw new Error('Step 22 paragraph: does not say report-only');
  if (body.split('\n').filter((l) => l.trim() && !l.startsWith('---')).length > 4) throw new Error('Step 22 paragraph: more than 4 lines');
  return body;
}

// --- update-mode.md's row ------------------------------------------------------

const ROW_FACTS = [
  [/ci-workflow-review\.js" --root \. --drift --json/, 'row: calls the CLI with --drift --json'],
  [/\{reviewed, findings, unparsed\}/, 'row: names the JSON envelope'],
  [/Report-only/, 'row: is report-only'],
  [/exit 1 →/, 'row: routes exit 1'],
  [/as its own finding, never as "no drift"/, 'row: exit 1 is its own finding, never "no drift"'],
  [/output unreadable/, 'row: unreadable stdout is its own finding'],
  [/never "no drift" while `unparsed` is non-empty/, 'row: never "no drift" while unparsed is non-empty'],
  [/\{remedy\} as-is when it is `see thn-inc\/claude-tweaks#5152`, otherwise `_shared\/ci-skips-drafts\.md` § \{remedy\}/, 'row: the remedy reads as formatRemedy prints it'],
  [/is re-run by pushes to the PR \(`types` undeclared or including `synchronize`\) yet lacks workflow-level `cancel-in-progress: true`/, 'row: check 4 applies only to a PR workflow pushes re-run'],
];
const missingRowFacts = missingFactsOf(ROW_FACTS);

test('AC11.1: update-mode.md\'s CI Workflow Review row calls the CLI with --drift --json, is report-only, and surfaces exit 1 as its own finding', () => {
  assert.deepEqual(missingRowFacts(subsectionOf(UPDATE, ROW_HEADING)), []);
});

test('AC11.1: init/SKILL.md carries a Step 22 paragraph after Step 21 and before the finalization section, pointing at its sub-file', () => {
  const body = step22Block(SKILL);
  assert.ok(body.startsWith(`${STEP22} (Optional)\n`), 'the block opens with its own heading');
  // Permutation control: the same block spliced above Step 21 fails on order.
  const fin = SKILL.indexOf(FINALIZING);
  const without = SKILL.slice(0, SKILL.indexOf(STEP22)) + SKILL.slice(fin);
  const permuted = without.replace(STEP21, `${body}${STEP21}`);
  assert.notEqual(permuted, without);
  assert.throws(() => step22Block(permuted), /out of order/);
  // Deletion control: no Step 22 heading fails on the missing marker.
  assert.throws(() => step22Block(SKILL.replace(STEP22, '### Step 2x: CI Workflow Review')), /marker missing/);
  // Each body guard fails on its own mutated copy.
  const s22 = SKILL.indexOf(STEP22);
  const withBody = (newBody) => SKILL.slice(0, s22) + newBody + SKILL.slice(fin);
  assert.throws(() => step22Block(withBody(body.replace('bootstrap/step-22-ci-workflow-review.md', 'bootstrap/step-22.md'))), /does not cite its sub-file/);
  assert.throws(() => step22Block(withBody(body.replace('report-only', 'read-only'))), /does not say report-only/);
  assert.throws(() => step22Block(withBody(body.replace('\n\n---', '\nline three\nline four\nline five\n\n---'))), /more than 4 lines/);
  // Paragraph removed, heading kept: fails on the missing citation.
  const headingOnly = `${STEP22} (Optional)\n\n---\n\n`;
  assert.ok(body.endsWith('---\n\n'), 'the block ends with the --- separator');
  assert.throws(() => step22Block(withBody(headingOnly)), /does not cite its sub-file/);
});

test('AC11.2: removing the Update Mode row or the SKILL.md paragraph turns these checks red', () => {
  assertEachPatternGoesRed(subsectionOf(UPDATE, ROW_HEADING), ROW_FACTS, missingRowFacts);
  assert.throws(() => subsectionOf(UPDATE.replace(`\n${ROW_HEADING}\n`, '\n'), ROW_HEADING), /subsection heading missing/);
  const paragraphs = SKILL.split('\n\n');
  const kept = paragraphs.filter((p) => !p.startsWith(STEP22) && !p.includes('bootstrap/step-22-ci-workflow-review.md'));
  assert.equal(paragraphs.length - kept.length, 2, 'the Step 22 block is exactly its heading plus one body paragraph');
  assert.throws(() => step22Block(kept.join('\n\n')), /Step 22 paragraph: marker missing/);
});

// --- the step-22 sub-file ------------------------------------------------------

const STEP_FACTS = [
  [/^# Step 22 — /, 'step: title'],
  [/\*Optional Enhancement step — see `\.\.\/SKILL\.md`/, 'step: standard preamble'],
  [/ci-workflow-review\.js" --root \./, 'step: the one command'],
  [/never writes, edits or regenerates/, 'step: never writes'],
  [/_shared\/ci-skips-drafts\.md/, 'step: cites the remedy doc'],
  [/update-mode\.md`'s `CI Workflow Review`/, 'step: cites the Update Mode row'],
  [/ci-workflow-review: reported by Update Mode/, 'step: the skip line'],
  [/never reviews the plugin's generated `track-issue-fixes\.yml` while it is the current or an earlier generated version/, 'step: only the generated tracking workflow is skipped'],
  [/a hand-modified copy is reviewed like any project workflow/, 'step: a hand-modified copy is reviewed'],
  [/A single workflow file that is unreadable, a dangling symlink, or resolves outside the checkout is not an exit 1: it is an `unparsed` row under exit 0/, 'step: a per-file failure is unparsed under exit 0'],
  [/except one unparsed only for a concurrency reason \(`cancel-in-progress expression not evaluated`, or a workflow-level `concurrency:` block it could not read\), which got every check but concurrency/, 'step: a concurrency reason suppresses check 4 alone'],
  [/A summary ending `not clean: \{K\} workflow\(s\) unparsed` is never reported as clean/, 'step: exit 0 with unparsed workflows is never reported as clean'],
  [/\*\*Exit 1\*\* — the review could not run: show `ci-workflow-review: could not review — \{stderr\}`/, 'step: exit 1 shows could not review'],
  [/\*\*Exit 2\*\* — a usage bug in the command line: report it, never as clean/, 'step: exit 2 is reported, never as clean'],
];
const missingStepFacts = missingFactsOf(STEP_FACTS);

test('step-22 file: preamble, command, never-writes, citations, and re-run gate', () => {
  assert.deepEqual(missingStepFacts(STEP), []);
  assertEveryMatchGoesRed(STEP, STEP_FACTS, missingStepFacts);
});

function rerunGateOf(text) {
  const start = text.indexOf('**Re-run gate.**');
  if (start === -1) throw new Error('re-run gate paragraph missing');
  const end = text.indexOf('\n\n', start);
  return text.slice(start, end === -1 ? text.length : end);
}

const SKIP_FACTS = [
  [/skips itself only when this invocation will reach Update Mode's Phase 1u\.5/, 'gate: skips only when Phase 1u.5 will be reached'],
  [/`\$ARGUMENTS` carries `--update` or `update`, or Phase 1's existence check/, 'gate: Update Mode routing'],
  [/`\$ARGUMENTS` carries a Phase scope and no `bootstrap`/, 'gate: a Phase scope without bootstrap'],
  [/print `ci-workflow-review: reported by Update Mode's CI Workflow Review \(update-mode\.md\)` and stop/, 'gate: the skip line and stop'],
];
const missingSkipFacts = missingFactsOf(SKIP_FACTS);

test('step-22 re-run gate: skips only when this run will reach Phase 1u.5', () => {
  const gate = rerunGateOf(STEP);
  assert.deepEqual(missingSkipFacts(gate), []);
  assertEachPatternGoesRed(gate, SKIP_FACTS, missingSkipFacts);
  assert.throws(() => rerunGateOf(STEP.replace('**Re-run gate.**', '**Gate.**')), /re-run gate paragraph missing/);
});

const RUN_FACTS = [
  [/In every other case it runs now: Initial Mode, the `bootstrap` scope, or Enhancement filter tokens with no Phase scope/, 'gate: runs now otherwise'],
  [/no Phase scope and no Enhancement filter token, the Scope Selection Gate decides, so hold the review/, 'gate: holds for the Scope Selection Gate'],
  [/the gate's Option 4 \("Done"\), or an Interactive "Done" chosen before Phase 1 runs, runs it before that exit/, 'gate: the early exits run it'],
  [/an Interactive "Skip Phase 1" runs it before Phase 2/, 'gate: Skip Phase 1 runs it'],
];
const missingRunFacts = missingFactsOf(RUN_FACTS);

const HOLD_SENTENCE = 'If Step 22 held its CI workflow review';

function gateHoldSentences(text) {
  const count = text.split(HOLD_SENTENCE).length - 1;
  if (count !== 2) throw new Error(`scope-selection-gate.md: expected the held-review sentence exactly twice, found ${count}`);
  const opt2 = text.indexOf('**Option 2 (Interactive):**');
  const opt3 = text.indexOf('**Option 3');
  const opt4 = text.indexOf('**Option 4 (Done):**');
  const first = text.indexOf(HOLD_SENTENCE);
  const second = text.indexOf(HOLD_SENTENCE, first + 1);
  if (!(opt2 < first && first < opt3)) throw new Error('scope-selection-gate.md: the first held-review sentence is not in Option 2');
  if (!(opt4 < second)) throw new Error('scope-selection-gate.md: the second held-review sentence is not in Option 4');
  const skip = text.indexOf(SKIP_PHASE_1_SENTENCE);
  if (!(opt2 < skip && skip < opt3)) throw new Error('scope-selection-gate.md: Option 2 does not release the held review on "Skip Phase 1"');
}
const SKIP_PHASE_1_SENTENCE = 'Choosing "Skip Phase 1" releases a held Step 22 review the same way: run it before Phase 2.';

test('step-22 re-run gate: runs whenever the run stops before Phase 1u.5', () => {
  const gate = rerunGateOf(STEP);
  assert.deepEqual(missingRunFacts(gate), []);
  assertEachPatternGoesRed(gate, RUN_FACTS, missingRunFacts);
  gateHoldSentences(GATE);
  const opt4 = GATE.indexOf('**Option 4 (Done):**');
  const withoutOpt4 = GATE.slice(0, opt4) + GATE.slice(opt4).replace(HOLD_SENTENCE, 'If Step 22 skipped');
  assert.throws(() => gateHoldSentences(withoutOpt4), /expected the held-review sentence exactly twice, found 1/);
  assert.throws(() => gateHoldSentences(GATE.replace(SKIP_PHASE_1_SENTENCE, '')), /does not release the held review on "Skip Phase 1"/);
});

// --- Phase 1u.6's drift count --------------------------------------------------

const EXCLUSION_FACTS = [
  [/does not count toward Phase 1u\.6's Total drift count/, 'row: not counted as drift'],
  [/Its lines are never dropped: on the early exit they are listed in Phase 1u\.6's Quick Audit block/, 'row: listed in the Quick Audit on the early exit'],
  [/on the full pass they are presented as their own report-only block before Phase 2/, 'row: presented on the full pass too'],
];
const missingExclusionFacts = missingFactsOf(EXCLUSION_FACTS);
const QUICK_AUDIT_FACTS = [
  [/if the CI Workflow Review row surfaced any line/, 'quick audit: conditional on the row surfacing a line'],
  [/preliminary gap signals \(below threshold\)\. CI workflow review — report-only, not counted as drift:"/, 'quick audit: its own heading line'],
  [/Never print "No drift detected\." while the CI Workflow Review row surfaced any line/, 'quick audit: never "No drift detected."'],
  [/first present every line the CI Workflow Review row surfaced \(Phase 1u\.5\), verbatim/, 'full pass: presents the lines first'],
  [/under the header line `CI workflow review — report-only, not counted as drift:` printed on its own \(the Quick Audit's phrase without its "Config is current\. \{N\} preliminary gap signals \(below threshold\)\." lead, since a full pass prints no Quick Audit block\)/, 'full pass: names its exact header line'],
  [/as its own report-only block outside the drift count/, 'full pass: report-only, not drift'],
  [/still presenting the CI Workflow Review row's lines first/, 'full pass: --full presents them too'],
];
const missingQuickAuditFacts = missingFactsOf(QUICK_AUDIT_FACTS);

test('drift count: the CI Workflow Review row does not count toward Phase 1u.6\'s Total drift count, its lines surface on the early exit and on the full pass, and the Quick Audit never prints "No drift detected" while it surfaced a line', () => {
  const row = subsectionOf(UPDATE, ROW_HEADING);
  const phase = sectionOf(UPDATE, PHASE_1U6);
  assert.deepEqual(missingExclusionFacts(row), []);
  assert.deepEqual(missingQuickAuditFacts(phase), []);
  assertEachPatternGoesRed(row, EXCLUSION_FACTS, missingExclusionFacts);
  assertEachPatternGoesRed(phase, QUICK_AUDIT_FACTS, missingQuickAuditFacts);
  assert.ok(phase.includes('Config is current. No drift detected.'), 'the unchanged path keeps its line');
  // The full pass once pointed at a "CI workflow review heading line" the Quick Audit never prints on its own.
  assert.doesNotMatch(phase, /under the Quick Audit's `CI workflow review` heading line/);
});

// --- the ci-review token -------------------------------------------------------

const TOKEN_LINE = /Enhancement filter tokens\*\* — one per Optional Enhancement step:[^\n]*`ci-review`/;
const GRAMMAR_ROW = /^\| `ci-review` \| Step 22 — /m;
const hintLeaves = (text) => extractArgumentHint(text).replace(/^\[|\]$/g, '').split('|');
const cardInitLine = (text) => lineStartingWith(text, '| `/claude-tweaks:init` |');
// The init row's Takes cell (its third, split on unescaped `|`), as its `\|`-separated leaves.
const cardTakesLeaves = (text) => {
  const cells = cardInitLine(text).split(/(?<!\\)\|/).map((c) => c.trim());
  return (cells[3] || '').replace(/^`\[|\]`$/g, '').split('\\|');
};

test('ci-review: the Enhancement filter token is listed in SKILL.md\'s token line, input-grammar.md, the argument-hint and the reference card', () => {
  assert.match(SKILL, TOKEN_LINE);
  assert.match(GRAMMAR, GRAMMAR_ROW);
  assert.ok(hintLeaves(SKILL).includes('ci-review'), 'argument-hint carries ci-review');
  assert.ok(cardTakesLeaves(CARD).includes('ci-review'), 'reference card Takes cell carries ci-review');
  // Every Enhancement filter token on SKILL.md's token line is a hint leaf, release included.
  const tokenLine = lineStartingWith(SKILL, '**Enhancement filter tokens**');
  const tokens = [...tokenLine.split('. Each narrows')[0].matchAll(/`([a-z-]+)`/g)].map((m) => m[1]);
  assert.ok(tokens.includes('release') && tokens.includes('ci-review'), 'the token line lists release and ci-review');
  assert.deepEqual(tokens.filter((t) => !hintLeaves(SKILL).includes(t)), []);
  assert.deepEqual(tokens.filter((t) => !hintLeaves(SKILL.replace('|release|', '|')).includes(t)), ['release']);
  // Controls: each surface without the token fails its own check.
  const skillNoToken = SKILL.replace(', `ci-review`', '');
  assert.notEqual(skillNoToken, SKILL);
  assert.doesNotMatch(skillNoToken, TOKEN_LINE);
  assert.doesNotMatch(GRAMMAR.replace('| `ci-review` |', '| `ci-reviewx` |'), GRAMMAR_ROW);
  assert.ok(!hintLeaves(SKILL.replace('|ci-review]"', ']"')).includes('ci-review'));
  const cardNoToken = CARD.replace('\\|ci-review]', ']');
  assert.notEqual(cardNoToken, CARD);
  assert.ok(!cardTakesLeaves(cardNoToken).includes('ci-review'));
  // Membership, not position: the token moved to the front of the cell still counts, and a
  // longer token that merely contains it does not.
  assert.ok(cardTakesLeaves(cardNoToken.replace('`[<path>', '`[ci-review\\|<path>')).includes('ci-review'));
  assert.ok(!cardTakesLeaves(CARD.replace('\\|ci-review]', '\\|ci-reviewx]')).includes('ci-review'));
  assert.ok(cardTakesLeaves(CARD).includes('<path>') && cardTakesLeaves(CARD).includes('release'), 'the split reads the whole Takes cell');
});

// --- the check table and its code twin -------------------------------------------

const REMEDY_PREFIX = '`_shared/ci-skips-drafts.md` § ';
// Check 5's remedy, qualified: it prints in the adopting project, where a bare #5152 is its own issue.
const POINTER = 'see thn-inc/claude-tweaks#5152';

function checkTableOf(text) {
  const start = text.indexOf('| Check | Remedy |');
  if (start === -1) throw new Error('check table: header missing');
  const lines = text.slice(start).split('\n');
  if (!/^\|-+\|-+\|$/.test(lines[1])) throw new Error('check table: separator row missing');
  const rows = [];
  for (const line of lines.slice(2)) {
    if (!line.startsWith('|')) break;
    const m = /^\| `([^`]+)` \| (.+) \|$/.exec(line);
    if (!m) throw new Error(`check table: malformed row: ${line}`);
    const cell = m[2];
    if (cell === POINTER) rows.push([m[1], cell]);
    else if (cell.startsWith(REMEDY_PREFIX)) rows.push([m[1], cell.slice(REMEDY_PREFIX.length)]);
    else throw new Error(`check table: remedy cell is neither a ci-skips-drafts.md section nor ${POINTER}: ${cell}`);
  }
  return rows;
}

test('step-22\'s check table matches CHECKS row for row', () => {
  assert.deepEqual(checkTableOf(STEP), Object.entries(CHECKS));
  const firstRow = STEP.split('\n').find((l) => l.startsWith('| `draft-skip-no-ready-for-review` |'));
  assert.ok(firstRow, 'the first CHECKS row is in the table');
  assert.throws(() => assert.deepEqual(checkTableOf(STEP.replace(`${firstRow}\n`, '')), Object.entries(CHECKS)));
  const flattened = STEP.replace('Coexistence with the `ci` verification source', 'Coexistence with the ci verification source');
  assert.notEqual(flattened, STEP);
  assert.throws(() => assert.deepEqual(checkTableOf(flattened), Object.entries(CHECKS)));
  assert.throws(() => checkTableOf(STEP.replace(`| ${POINTER} |`, '| see the issue |')), /neither a ci-skips-drafts\.md section nor see thn-inc\/claude-tweaks#5152/);
  // The bare form a consumer project would misread is refused too.
  assert.throws(() => checkTableOf(STEP.replace(`| ${POINTER} |`, '| see #5152 |')), /neither a ci-skips-drafts\.md section nor/);
});

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const remedyHeadingsMissing = (doc) => Object.values(CHECKS)
  .filter((r) => r !== POINTER)
  .filter((r) => !new RegExp(`^## ${escapeRegExp(r)}$`, 'm').test(doc));

test('every CHECKS remedy except the #5152 pointer is a ## heading in _shared/ci-skips-drafts.md', () => {
  assert.deepEqual(remedyHeadingsMissing(DOC), []);
  assert.deepEqual(remedyHeadingsMissing(DOC.replace('\n## Concurrency\n', '\n## Concurrency control\n')), ['Concurrency']);
});

const INDEX_ROW = /^\| 22 \| `step-22-ci-workflow-review\.md` \|/m;

test('bootstrap-steps.md lists step 22', () => {
  assert.match(INDEX, INDEX_ROW);
  assert.doesNotMatch(INDEX.replace('| 22 |', '| 2x |'), INDEX_ROW);
});

// --- maintainer docs: skill-graph edges and plugin-structure entries ------------

const GRAPH = read('docs/skill-graph.md');
const STRUCTURE = read('docs/plugin-structure.md');

// Each init-owned edge Step 22 adds, as [row prefix, a fact its Relationship cell must carry].
const GRAPH_ROWS = [
  ['| `_shared/ci-skips-drafts.md` |', 'Step 22'],
  ['| `bin/ci-workflow-review.js` |', 'Step 22'],
];
const missingGraphRows = (section) => GRAPH_ROWS
  .filter(([prefix, fact]) => !section.split('\n').some((l) => l.startsWith(prefix) && l.includes(fact)))
  .map(([prefix]) => prefix);

test('docs/skill-graph.md\'s init section carries the ci-skips-drafts and ci-workflow-review.js edges', () => {
  const section = sectionOf(GRAPH, '## init');
  assert.deepEqual(missingGraphRows(section), []);
  // Control: each row removed from the section turns exactly its own check red.
  for (const [prefix] of GRAPH_ROWS) {
    const without = section.split('\n').filter((l) => !l.startsWith(prefix)).join('\n');
    assert.notEqual(without, section, `row ${prefix} not found — control cannot discriminate`);
    assert.deepEqual(missingGraphRows(without), [prefix]);
  }
});

// Facts per line of docs/plugin-structure.md, each read from the one line its prefix starts.
const INIT_LIB_LINE = 'plugin/bin/lib/init/ ';
const READER_LINE = 'plugin/bin/lib/merge-verification.js ';
const CLI_LINE = 'node plugin/bin/ci-workflow-review.js ';
const STRUCTURE_FACTS = [
  [INIT_LIB_LINE, /ci-workflow-review\.js \(#5162\) — init Step 22's and Update Mode's report-only review/, 'module: entry'],
  [INIT_LIB_LINE, /CHECKS maps each to its _shared\/ci-skips-drafts\.md section/, 'module: CHECKS to remedy sections'],
  [INIT_LIB_LINE, /; consumed by plugin\/bin\/ci-workflow-review\.js/, 'module: its consumer'],
  [READER_LINE, /→ Three line-based GitHub Actions workflow readers \(no YAML library\); the first fails toward off, the other two toward unparsed\./, 'reader: three readers'],
  [READER_LINE, /readWorkflowShape\(text\) → \{name, prTrigger, types, typesDeclared, draftReference, prFilters, prFiltersByTrigger, pushTrigger, pushBranches, pushBranchesIgnore, pushTags, jobs\[\{id, if, stepIfCount, concurrency\}\], concurrency, unparsed\[reason\]\}/, 'reader: the shape fields'],
  [READER_LINE, /Tests in tests\/merge-verification\.test\.js and tests\/merge-verification-workflow-shape\.test\.js/, 'reader: its test suites'],
  // With CLI_LINE as the line's prefix, this completes the command `node plugin/bin/ci-workflow-review.js --root <dir> [--drift] [--json]`.
  [CLI_LINE, /--root <dir> \[--drift\] \[--json\] {3}# Init's CI-workflow review \(#5162\)/, 'cli: the command'],
  [CLI_LINE, /reads \.github\/workflows\/\*\.yml and \*\.yaml \(extension matched case-insensitively\)/, 'cli: workflow discovery'],
  [CLI_LINE, /one JSON line \{reviewed, findings, unparsed\} under --json \(with or without --drift\)/, 'cli: the JSON envelope'],
  [CLI_LINE, /exit 0 report printed, findings or not \(a per-file read failure is an unparsed entry\), 1 /, 'cli: exit 0'],
  [CLI_LINE, /— reason on stderr, empty stdout — 2 usage/, 'cli: exit 1 and 2'],
];
const missingStructureFacts = (text) => STRUCTURE_FACTS
  .filter(([prefix, pattern]) => !pattern.test(lineStartingWith(text, prefix)))
  .map(([, , fact]) => fact);

test('docs/plugin-structure.md lists the CLI, the module and the reader', () => {
  assert.deepEqual(missingStructureFacts(STRUCTURE), []);
  assertEachPatternGoesRed(STRUCTURE, STRUCTURE_FACTS.map(([, pattern, fact]) => [pattern, fact]), missingStructureFacts);
  assert.doesNotMatch(STRUCTURE, /Two line-based GitHub Actions workflow readers/);
});
