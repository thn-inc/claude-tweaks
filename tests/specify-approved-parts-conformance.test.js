'use strict';
// tests/specify-approved-parts-conformance.test.js — #6353 Task 4: /claude-tweaks:specify's
// decomposition takes an approved `/claude-tweaks:design` parts list as its work units. Pins the
// approved-parts branch of decomposition-mode.md's Step 2, the collapse paragraph in
// collapse-decision.md, the `## Worth-it measure` and design-slug clauses in record-creation.md, and
// the taken-not-judged size and slug clauses in record-creation-subissues.md. The prose is new in this
// change, so every assertion proves go-red on a mutated in-memory copy of the live text, matched to
// that assertion's own message (.claude/skills/skill-prose-conformance-tests/SKILL.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed } = require('./helpers/conformance-asserts');

const ROOT = path.join(__dirname, '..');
const SPECIFY = path.join(ROOT, 'plugin', 'skills', 'specify');
const read = (name) => readText(path.join(SPECIFY, name));

const DM = read('decomposition-mode.md');
const COLLAPSE = read('collapse-decision.md');
const RC = read('record-creation.md');
const SUB = read('record-creation-subissues.md');

// The text between two markers; both must resolve, in order.
function between(text, start, end, label) {
  const a = text.indexOf(start);
  assert.notEqual(a, -1, `${label}: start marker missing`);
  const b = text.indexOf(end, a + start.length);
  assert.notEqual(b, -1, `${label}: end marker missing`);
  return text.slice(a, b);
}

function requireOrder(text, first, second, label) {
  const a = text.indexOf(first);
  const b = text.indexOf(second);
  assert.notEqual(a, -1, `${label}: first marker missing`);
  assert.notEqual(b, -1, `${label}: second marker missing`);
  assert.ok(a < b, `${label}: order violated`);
}

// --- decomposition-mode.md: the approved-parts branch, one region -------------------------------

const BRANCH_HEADING = '### Approved parts list (checked first)';
const SIZING_HEADING = '\n### Sizing Guidelines\n'; // the heading line, not the branch's own mention of it
const branchOf = (text) => between(text, BRANCH_HEADING, SIZING_HEADING, 'approved-parts branch');

const CLI_CALL = /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/design-session\.js" check-approval --folder "\{folder\}"/;

const DM_FACTS = [
  [/When the design doc is a `design\.md` that holds a `## Parts` section, run this before anything else in Step 2/, 'F1 run check-approval first'],
  [CLI_CALL, 'CLI check-approval call'],
  [/The parts in `filing\.file` are the work units, in table order/, 'F2a filing.file parts are the units, in order'],
  [/each unit's title is the part's `name`, its `size:` label the part's `size`, its unit slug the part's `slug`, and its blockers the part's resolved `blockers`/, 'F2b name, size, slug, blockers taken'],
  [/`sibling` → that sibling sub-issue's link in Step 4, `issue` → the `owner\/name#N` ref as written, `symbolic` → the line `Blocked by: \{part name\} \(left for \{owner\/name\}\)`/, 'F2c blocker kinds'],
  [/Skip `### Sizing Guidelines`, `### Decomposition Heuristics` \(its rewrite-signal check included\) and `--granularity`/, 'F2d skips sizing, heuristics, granularity'],
  [/Overlap Analysis, Implicit Dependency Detection with its file-overlap check, Step 2\.6 and Steps 3 to 9 run as today/, 'F2e the rest runs as today'],
  [/Parts in `filing\.leftFor` are not filed: Step 9's summary lists each as left for that repository's run/, 'F3a leftFor not filed'],
  [/Parts in `filing\.skipped` are already filed, by a sibling repository's earlier run, and are never filed again/, 'F3b skipped never filed again'],
  [/\*\*No gate changes an approved part\.\*\* Any step from here to Step 9 whose outcome would change a part's name, size or blockers/, 'F4a no gate changes an approved part'],
  [/an overlap resolution \(`overlap-resolution\.md`\), an implicit-dependency link, a red-team resolution, a scoring judgment/, 'F4b the gates named'],
  [/stops and asks with one `AskUserQuestion`: `Keep the part as approved \(Recommended\)` \/ `Change it — the design goes back for a new approval`/, 'F4c the question'],
  [/Choosing the change stops decomposition and names `\/claude-tweaks:design \{argument\}`/, 'F4d change stops decomposition'],
  [/With no human reachable it stops all the same, before that part's record is written, and stages the question/, 'F4e headless stops before the write and stages'],
  [/it never keeps going on its own/, 'F4f never keeps going'],
  [/`no-parts` → the rest of Step 2 runs as today/, 'F5a no-parts falls through'],
  [/when the session knows this checkout's `owner\/name` \(`gh repo view --json nameWithOwner -q \.nameWithOwner`, or the cloud session's repository\), run `check-approval` again with `--repository \{owner\/name\}`/, 'F5b no-repository reruns with --repository'],
  [/otherwise stop: `This checkout has no origin remote naming owner\/name, so the parts' repositories cannot be matched\.`/, 'F5c no-repository stop message'],
  [/Any other reason → stop before Step 3: `The design is not approved \(\{reason\}\) — run \/claude-tweaks:design \{argument\} to approve its parts, then decompose again\.`/, 'F5d not-approved stop message'],
  [/\*\*Exit 2\*\* → stop and show stderr/, 'F5e exit 2 stops'],
  [/carries `## Worth-it measure` followed by `measure` word for word/, 'F6 parent carries the measure'],
];
const missingDm = missingFactsOf(DM_FACTS);
const factsNamed = (...prefixes) => DM_FACTS.filter(([, fact]) => prefixes.some((p) => fact.startsWith(p)));

// Present in the branch, and each one alone goes red on the shared predicate.
function pinBranchFacts(...prefixes) {
  const branch = branchOf(DM);
  const subset = factsNamed(...prefixes);
  assert.ok(subset.length > 0, `no facts named ${prefixes.join(', ')}`);
  const missing = missingDm(branch).filter((f) => subset.some(([, s]) => s === f));
  assert.deepEqual(missing, [], 'approved-parts branch is missing facts');
  assertEachPatternGoesRed(branch, subset, missingDm);
}

test('the approved-parts branch states every fact, each exactly once', () => {
  assert.deepEqual(missingDm(branchOf(DM)), []);
  assertEachPatternGoesRed(branchOf(DM), DM_FACTS, missingDm);
});

test('AC1.1: an approved list\'s parts become the work units, in order, with their names and blockers', () => {
  pinBranchFacts('F1', 'F2');
});

test('AC2.2: no gate changes an approved part\'s name, size or blockers without asking', () => {
  pinBranchFacts('F4a', 'F4b', 'F4c', 'F4d');
});

test('a headless gate still stops', () => {
  pinBranchFacts('F4e', 'F4f');
});

test('AC3.1: an unapproved parts section is refused with the not-approved message', () => {
  pinBranchFacts('F5d', 'F5e');
});

test('a no-repository verdict reruns with --repository when the session knows it, else stops', () => {
  pinBranchFacts('F5b', 'F5c');
});

test('AC4.1: no parts section falls through to today\'s Step 2', () => {
  pinBranchFacts('F5a');
  requireOrder(DM, BRANCH_HEADING, SIZING_HEADING, 'branch before Sizing Guidelines');
  requireOrder(DM, '## Step 2: Decompose into Work Units', BRANCH_HEADING, 'branch inside Step 2');
  // Permutation control: the branch moved below Sizing Guidelines goes red on the order check.
  const branch = branchOf(DM);
  const moved = DM.replace(branch, '').replace(SIZING_HEADING, () => `${SIZING_HEADING}\n\n${branch}`);
  assert.notEqual(moved, DM);
  assert.throws(() => requireOrder(moved, BRANCH_HEADING, SIZING_HEADING, 'branch before Sizing Guidelines'),
    { message: /branch before Sizing Guidelines: order violated/ });
});

test('a part for another repository is left for that repository\'s run', () => {
  pinBranchFacts('F3');
});

test('the check-approval call is pinned, and its flags are ones the CLI accepts', () => {
  pinBranchFacts('CLI');
  const usage = execFileSync(process.execPath, [path.join(ROOT, 'plugin', 'bin', 'design-session.js'), '--help'], { encoding: 'utf8' });
  const accepted = (line) => line.split('\n').some((l) => l.includes('design-session.js check-approval --folder <dir> [--repository <owner/name>]'));
  assert.ok(accepted(usage), 'check-approval no longer takes --folder and --repository');
  // Control: a renamed flag in the usage line is caught.
  assert.equal(accepted(usage.replace('check-approval --folder', 'check-approval --dir')), false);
});

test('the six facts are stated in the planned order', () => {
  const branch = branchOf(DM);
  const anchors = ['Exit 0', 'Other repositories', 'No gate changes an approved part', '**Exit 1**', 'The parent'];
  const chain = (text) => {
    for (let i = 1; i < anchors.length; i++) requireOrder(text, anchors[i - 1], anchors[i], `facts ${i}-${i + 1}`);
  };
  chain(branch);
  // Permutation control: the gate bullet moved below the exit-1 bullet goes red on its own pair.
  const gate = branch.split('\n').find((l) => l.startsWith('- **No gate changes an approved part.**'));
  const exit1 = branch.split('\n').find((l) => l.startsWith('- **Exit 1**'));
  assert.ok(gate && exit1, 'gate and exit-1 bullets must each be one line');
  const swapped = branch.replace(gate, '\u0000').replace(exit1, gate).replace('\u0000', exit1);
  assert.notEqual(swapped, branch);
  assert.throws(() => chain(swapped), { message: /facts 3-4: order violated/ });
});

// --- collapse-decision.md ---------------------------------------------------------------------

const COLLAPSE_PARA = '**An approved parts list fixes the decision.** Two or more approved parts always keep the parent, whatever the signals below say; one approved part collapses as below.';
const UNIT_SET = '**The unit set counted here';
const ONE_UNIT = '**1 work unit — always collapses.**';
const THREE_UNITS = '**3+ work units — never collapses.**';

function assertCollapsePara(text) {
  assert.equal(text.split(COLLAPSE_PARA).length - 1, 1, 'approved-parts collapse paragraph must appear exactly once');
  requireOrder(text, UNIT_SET, COLLAPSE_PARA, 'collapse paragraph after the unit-set paragraph');
  requireOrder(text, COLLAPSE_PARA, ONE_UNIT, 'collapse paragraph before the 1-unit rule');
}

test('AC2.1: two or more approved parts keep the parent', () => {
  assertCollapsePara(COLLAPSE);
  // Deletion control.
  const deleted = COLLAPSE.replace(`${COLLAPSE_PARA}\n\n`, '');
  assert.notEqual(deleted, COLLAPSE);
  assert.throws(() => assertCollapsePara(deleted), { message: /must appear exactly once/ });
  // Move-out control: the paragraph moved below the 3+ rule stays in the file but out of place.
  const threeLine = COLLAPSE.split('\n').find((l) => l.startsWith(THREE_UNITS));
  const moved = deleted.replace(threeLine, () => `${threeLine}\n\n${COLLAPSE_PARA}`);
  assert.notEqual(moved, deleted);
  assert.throws(() => assertCollapsePara(moved), { message: /collapse paragraph before the 1-unit rule: order violated/ });
});

// --- record-creation.md -----------------------------------------------------------------------

const IDEMPOTENCY = (text) => between(text, '### Idempotency (resume path)', '### Parent record', 'Idempotency section');
const PARENT = (text) => between(text, '### Parent record', 'SPECIFY_PARENT_PAYLOAD=$(', 'Parent record section');
const RC_FACTS = [
  [/For a `design\.md` in a design folder, `\{design-doc-slug\}` is `check-approval`'s `designSlug`/, 'R1 design slug of a design folder'],
  [/the body also carries a `## Worth-it measure` section: the heading followed by `check-approval`'s `measure`, word for word/, 'R2 worth-it measure section'],
];
const missingRc = missingFactsOf(RC_FACTS);
const R1 = RC_FACTS.slice(0, 1);
const R2 = RC_FACTS.slice(1);

test('record-creation.md: a design folder\'s design-doc slug is check-approval\'s designSlug', () => {
  const region = IDEMPOTENCY(RC);
  assert.deepEqual(missingFactsOf(R1)(region), []);
  assertEachPatternGoesRed(region, R1, missingFactsOf(R1));
});

test('AC5.1: the parent carries the worth-it measure word for word', () => {
  const region = PARENT(RC);
  assert.deepEqual(missingFactsOf(R2)(region), []);
  assertEachPatternGoesRed(region, R2, missingFactsOf(R2));
  // Move-out control: the clause moved into the Idempotency section leaves the Parent record section red.
  const sentence = region.match(/On an approved parts list[^\n]*?word for word\./);
  assert.ok(sentence, 'worth-it sentence not found');
  const moved = RC.replace(sentence[0], '').replace('### Idempotency (resume path)\n', () => `### Idempotency (resume path)\n\n${sentence[0]}\n`);
  assert.notEqual(moved, RC);
  assert.ok(moved.includes(sentence[0]), 'the move must keep the clause in the file');
  assert.deepEqual(missingFactsOf(R2)(PARENT(moved)), ['R2 worth-it measure section']);
  assert.deepEqual(missingRc(moved), [], 'the moved clause must still match file-wide');
});

// --- record-creation-subissues.md -------------------------------------------------------------

const SUB_REGION = (text) => between(text, '**Scoring**', '**Fingerprint**', 'Scoring-to-Fingerprint region');
const SUB_FACTS = [
  [/On an approved parts list \(`decomposition-mode\.md` Step 2\), `\$SUB_ISSUE_SIZE` is the part's `size` without its `size:` prefix, taken, not judged; `risk` is still judged\./, 'S1 size taken, risk judged'],
  [/On an approved parts list, `\$UNIT_SLUG` is the part's `slug`, taken, not derived/, 'S2 unit slug taken'],
  [/the record file's own slug still comes from `deriveSlug\(part slug, existingSlugs\)`/, 'S3 local file slug derived'],
  [/a part whose slug an existing local record already holds gets a suffixed file name while its fingerprint keeps the part slug/, 'S4 collision keeps the fingerprint'],
  [/resume matches on the fingerprint, never the file name/, 'S5 resume matches the fingerprint'],
];
const missingSub = missingFactsOf(SUB_FACTS);

test('record-creation-subissues.md: an approved part\'s size is taken, not judged', () => {
  const region = SUB_REGION(SUB);
  assert.deepEqual(missingSub(region), []);
  assertEachPatternGoesRed(region, SUB_FACTS.slice(0, 2), missingSub);
  // Move-out control: the size clause moved off the Scoring line, still inside the region, goes red
  // on the line check.
  const onScoringLine = (text) => {
    const scoring = text.split('\n').find((l) => l.startsWith('**Scoring**')) || '';
    assert.ok(scoring, 'Scoring line missing');
    assert.match(scoring, SUB_FACTS[0][0], 'size clause must sit on the Scoring line');
  };
  onScoringLine(SUB);
  const clause = SUB.match(SUB_FACTS[0][0])[0];
  const moved = SUB.replace(` ${clause}`, '').replace('**Fingerprint**', () => `${clause}\n\n**Fingerprint**`);
  assert.notEqual(moved, SUB);
  assert.deepEqual(missingSub(SUB_REGION(moved)), [], 'the moved clause must stay inside the region');
  assert.throws(() => onScoringLine(moved), { message: /size clause must sit on the Scoring line/ });
});

test('a local-files slug collision keeps the part slug in the fingerprint', () => {
  const region = SUB_REGION(SUB);
  assertEachPatternGoesRed(region, SUB_FACTS.slice(2), missingSub);
});
