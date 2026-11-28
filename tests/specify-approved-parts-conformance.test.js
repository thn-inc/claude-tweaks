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

// --- decomposition-mode.md: the approval check (Step 1), the units (Step 2), Overlap Analysis -----

// Heading lines, not the backticked mentions of them elsewhere in the file.
const CHECK_HEADING = '\n### Approved parts list (checked first)\n';
const READS_HEADING = '\n### Landscape reads\n';
const UNITS_HEADING = '\n### Approved parts as work units\n';
const SIZING_HEADING = '\n### Sizing Guidelines\n'; // the heading line, not the branch's own mention of it
const OVERLAP_HEADING = '\n### Overlap Analysis\n';
const STEP1 = '## Step 1: Understand the Landscape';
const STEP2 = '## Step 2: Decompose into Work Units';
const REGIONS = {
  check: (text) => between(text, CHECK_HEADING, READS_HEADING, 'approval check'),
  units: (text) => between(text, UNITS_HEADING, SIZING_HEADING, 'approved units'),
  overlap: (text) => between(text, OVERLAP_HEADING, `\n${STEP2}`, 'Overlap Analysis'),
};

const CLI_CALL = /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/design-session\.js" check-approval --folder "\{folder\}"/;

const FACTS = {
  check: [
    [/When the design doc is a file named exactly `design\.md` inside a design session folder, `docs\/superpowers\/specs\/\{YYYY-MM-DD\}-\{slug\}\/`, run this before anything else in Step 1/, 'F1 run check-approval first'],
    [/Any other design doc, a brainstorming `\*-design\.md` with a `## Parts` heading included, skips this check and runs Steps 1 and 2 as today\./, 'F1b any other design doc runs today\'s path'],
    [CLI_CALL, 'CLI check-approval call'],
    [/`no-parts` → Steps 1 and 2 run as today/, 'F5a no-parts falls through'],
    [/when the session knows this checkout's `owner\/name` \(`gh repo view --json nameWithOwner -q \.nameWithOwner`, or the cloud session's repository\), run `check-approval` again with `--repository \{owner\/name\}`/, 'F5b no-repository reruns with --repository'],
    [/otherwise stop: `This checkout has no origin remote naming owner\/name, so the parts' repositories cannot be matched\.`/, 'F5c no-repository stop message'],
    [/Any other reason → stop before Step 1's reads: `The design is not approved \(\{reason\}\) — run \/claude-tweaks:design \{argument\} to approve its parts, then decompose again\.`/, 'F5d not-approved stop message'],
    [/\*\*Exit 2\*\* → stop and show stderr/, 'F5e exit 2 stops'],
    [/\*\*Exit 0\*\* → the parts are this run's work units \(Step 2's `### Approved parts as work units`\), and the rule below holds from here to Step 9/, 'F0 exit 0 hands the units to Step 2'],
    [/\*\*No gate changes an approved part\.\*\* No step applies an outcome that would drop, merge, rename or re-size an approved part, or add or remove one of its blockers/, 'F4a no gate changes an approved part'],
    [/an overlap resolution \(`overlap-resolution\.md`\), an implicit-dependency link, a red-team resolution, a scoring judgment/, 'F4b the gates named'],
    [/Before that part's record is created, the step stops and asks with one `AskUserQuestion`: `Keep the part as approved \(Recommended\)` \/ `Change it — the design goes back for a new approval`/, 'F4c the question'],
    [/Choosing the change stops decomposition and names `\/claude-tweaks:design \{argument\}`/, 'F4d change stops decomposition'],
    [/Records this run already created stay, with `ready` cleared; the stop message lists them and says that after the new approval a renamed part's old record must be closed or reused, since its fingerprint no longer matches\./, 'F4j a change keeps created records, ready cleared, and names renamed parts'],
    [/With no human reachable it stops all the same, before that part's record is written, and stages the question/, 'F4e headless stops before the write and stages'],
    [/it never keeps going on its own/, 'F4f never keeps going'],
    [/At Steps 4 and 5, once the record exists, the part's name, size and blockers stay as approved and the record's `ready` is cleared/, 'F4g after the create the part stays and ready clears'],
    [/the question is staged when a run directory resolved, or asked when a human is present, and with neither the finding's marker stays in the record and `ready` stays cleared/, 'F4h staged, asked, or marker kept'],
    [/The change is never applied\./, 'F4i never applied'],
  ],
  units: [
    [/When `### Approved parts list \(checked first\)` \(Step 1\) exited 0, its JSON decides the work units/, 'U0 Step 2 consumes the check'],
    [/The parts in `filing\.file` are the work units, in table order/, 'F2a filing.file parts are the units, in order'],
    [/each unit's title is the part's `name`, its `size:` label the part's `size`, its unit slug the part's `slug`, and its blockers the part's resolved `blockers`/, 'F2b name, size, slug, blockers taken'],
    [/`sibling` → that sibling sub-issue's link in Step 4, `issue` → the `owner\/name#N` ref as written, `symbolic` → the line `Blocked by: \{ref\}`, its printed `ref` \(`\{part name\} \(left for \{owner\/name\}\)`\) as is/, 'F2c blocker kinds'],
    [/A `symbolic` line names no issue and no resolvable state, so a sub-issue carrying one is created without `ready`; the later repository's run restores it when it writes the `owner\/name#N` form/, 'F2f a symbolic blocker means no ready'],
    [/Skip `### Sizing Guidelines`, `### Decomposition Heuristics` \(its rewrite-signal check included\) and `--granularity`/, 'F2d skips sizing, heuristics, granularity'],
    [/Implicit Dependency Detection with its file-overlap check, Step 2\.6 and Steps 3 to 9 still run, each under Step 1's no-gate rule/, 'F2e the rest runs under the rule'],
    [/Parts in `filing\.leftFor` are not filed: Step 9's summary lists each as left for that repository's run/, 'F3a leftFor not filed'],
    [/Parts in `filing\.skipped` are already filed, by a sibling repository's earlier run, and are never filed again/, 'F3b skipped never filed again'],
    [/carries `## Worth-it measure` followed by `measure` word for word/, 'F6 parent carries the measure'],
  ],
  overlap: [
    [/On an approved parts list, each approved part is a design section here/, 'O1 parts are design sections'],
    [/`skip` on a part, or a `companion` that adds a unit or a `Blocked by` link to a part — takes `### Approved parts list \(checked first\)`'s no-gate rule instead of auto-resolving/, 'O2 part-changing resolutions take the rule'],
    [/a resolution that touches no part, such as a link written on the existing record's side only, runs as today/, 'O3 part-neutral resolutions run as today'],
  ],
};
const missingIn = Object.fromEntries(Object.entries(FACTS).map(([k, f]) => [k, missingFactsOf(f)]));

// Present in its region, and each one alone goes red on that region's shared predicate.
function pinFacts(region, ...prefixes) {
  const text = REGIONS[region](DM);
  const subset = FACTS[region].filter(([, fact]) => prefixes.some((p) => fact.startsWith(p)));
  assert.ok(subset.length > 0, `no facts named ${prefixes.join(', ')}`);
  const missing = missingIn[region](text).filter((f) => subset.some(([, s]) => s === f));
  assert.deepEqual(missing, [], `${region} region is missing facts`);
  assertEachPatternGoesRed(text, subset, missingIn[region]);
}

test('every approved-parts region states every fact, each exactly once', () => {
  for (const region of Object.keys(FACTS)) {
    const text = REGIONS[region](DM);
    assert.deepEqual(missingIn[region](text), [], region);
    assertEachPatternGoesRed(text, FACTS[region], missingIn[region]);
  }
});

test('AC1.1: an approved list\'s parts become the work units, in order, with their names and blockers', () => {
  pinFacts('check', 'F1', 'F0');
  pinFacts('units', 'U0', 'F2');
});

test('AC2.2: no gate changes an approved part\'s name, size or blockers without asking', () => {
  pinFacts('check', 'F4a', 'F4b', 'F4c', 'F4d', 'F4g', 'F4i');
});

test('a headless gate still stops', () => {
  pinFacts('check', 'F4e', 'F4f', 'F4h');
});

test('a change chosen after records exist keeps them, with ready cleared, and names the renamed parts', () => {
  pinFacts('check', 'F4j');
  // Move-out control: the sentence moved out of the no-gate bullet, still in the check region, goes red on the bullet.
  const check = REGIONS.check(DM);
  const sentence = check.match(FACTS.check.find(([, f]) => f.startsWith('F4j'))[0])[0];
  const noGate = (text) => text.split('\n').find((l) => l.startsWith('- **No gate changes an approved part.**')) || '';
  const rule = (text) => assert.ok(noGate(text).includes(sentence), 'the created-records sentence must sit in the no-gate bullet');
  rule(check);
  const moved = check.replace(` ${sentence}`, '').replace('- **Exit 0**', () => `${sentence}\n- **Exit 0**`);
  assert.notEqual(moved, check);
  assert.deepEqual(missingIn.check(moved), []);
  assert.throws(() => rule(moved), { message: /must sit in the no-gate bullet/ });
});

test('only a design.md in a design session folder takes the approved-parts check', () => {
  pinFacts('check', 'F1', 'F1b');
  // Control: the old trigger, any design.md holding a ## Parts section, goes red on F1 alone.
  const old = DM.replace(/a file named exactly `design\.md` inside a design session folder, `docs\/superpowers\/specs\/\{YYYY-MM-DD\}-\{slug\}\/`, run this before anything else in Step 1, `\{folder\}` being that folder/,
    'a `design.md` that holds a `## Parts` section, run this before anything else in Step 1, `{folder}` being the folder that holds that `design.md`');
  assert.notEqual(old, DM);
  assert.deepEqual(missingIn.check(REGIONS.check(old)), ['F1 run check-approval first']);
});

test('a sub-issue with a symbolic blocker is created without ready (decomposition-mode.md)', () => {
  pinFacts('units', 'F2f');
});

test('AC3.1: an unapproved parts section is refused with the not-approved message', () => {
  pinFacts('check', 'F5d', 'F5e');
});

test('a no-repository verdict reruns with --repository when the session knows it, else stops', () => {
  pinFacts('check', 'F5b', 'F5c');
});

test('Overlap Analysis treats approved parts as sections and sends part-changing resolutions to the rule', () => {
  pinFacts('overlap', 'O');
});

// Every move goes red on its own pair's message.
function moveBelow(text, block, anchor) {
  const out = text.replace(block, '').replace(anchor, () => `${anchor}\n${block}\n`);
  assert.notEqual(out, text);
  return out;
}

test('AC4.1: the check runs before Step 1\'s reads and Overlap Analysis; no parts falls through', () => {
  pinFacts('check', 'F5a');
  const order = (text) => {
    requireOrder(text, STEP1, CHECK_HEADING, 'check inside Step 1');
    requireOrder(text, CHECK_HEADING, READS_HEADING, 'check before the reads');
    requireOrder(text, CHECK_HEADING, OVERLAP_HEADING, 'check before Overlap Analysis');
  };
  order(DM);
  const check = REGIONS.check(DM);
  assert.throws(() => order(moveBelow(DM, check, OVERLAP_HEADING)), { message: /check before the reads: order violated/ });
  // Overlap Analysis moved above the check: only the Overlap pair goes red.
  const overlap = REGIONS.overlap(DM);
  const overlapFirst = DM.replace(overlap, '').replace(CHECK_HEADING, () => `\n${overlap.trim()}\n${CHECK_HEADING}`);
  assert.notEqual(overlapFirst, DM);
  assert.throws(() => order(overlapFirst), { message: /check before Overlap Analysis: order violated/ });
});

test('Step 2 opens with the approved units, under a lead-in that sits above what it introduces', () => {
  const LEAD = `${STEP2}\n\nBreak the design doc into self-contained work units, sized and shaped by the subsections below.\n${UNITS_HEADING}`;
  const order = (text) => {
    assert.ok(text.includes(LEAD), 'Step 2 lead-in must sit directly above the approved units');
  };
  order(DM);
  const units = REGIONS.units(DM);
  assert.throws(() => order(moveBelow(DM, units, SIZING_HEADING)), { message: /lead-in must sit directly above/ });
  const dangling = DM.replace('work units, sized and shaped by the subsections below.', 'work units. Each work unit must be:');
  assert.notEqual(dangling, DM);
  assert.throws(() => order(dangling), { message: /lead-in must sit directly above/ });
});

test('a part for another repository is left for that repository\'s run', () => {
  pinFacts('units', 'F3');
});

test('the check-approval call is pinned, and its flags are ones the CLI accepts', () => {
  pinFacts('check', 'CLI');
  const usage = execFileSync(process.execPath, [path.join(ROOT, 'plugin', 'bin', 'design-session.js'), '--help'], { encoding: 'utf8' });
  const accepted = (line) => line.split('\n').some((l) => l.includes('design-session.js check-approval --folder <dir> [--repository <owner/name>]'));
  assert.ok(accepted(usage), 'check-approval no longer takes --folder and --repository');
  // Control: a renamed flag in the usage line is caught.
  assert.equal(accepted(usage.replace('check-approval --folder', 'check-approval --dir')), false);
});

function chainOf(anchors, label) {
  return (text) => {
    for (let i = 1; i < anchors.length; i++) requireOrder(text, anchors[i - 1], anchors[i], `${label} ${i}-${i + 1}`);
  };
}
const swapLines = (text, a, b) => text.replace(a, '\u0000').replace(b, a).replace('\u0000', b);
const bullet = (text, prefix) => {
  const line = text.split('\n').find((l) => l.startsWith(prefix));
  assert.ok(line, `bullet ${prefix} must be one line`);
  return line;
};

test('the facts are stated in the planned order', () => {
  const check = REGIONS.check(DM);
  const checkChain = chainOf(['- **Exit 1**', '- **Exit 0**', '- **No gate changes an approved part.**'], 'check');
  checkChain(check);
  const swappedCheck = swapLines(check, bullet(check, '- **Exit 1**'), bullet(check, '- **No gate changes an approved part.**'));
  assert.notEqual(swappedCheck, check);
  assert.throws(() => checkChain(swappedCheck), { message: /check 1-2: order violated/ });

  const units = REGIONS.units(DM);
  const unitsChain = chainOf(['- **The units.**', '- **Other repositories\' parts.**', '- **The parent**'], 'units');
  unitsChain(units);
  const swappedUnits = swapLines(units, bullet(units, '- **The units.**'), bullet(units, '- **The parent**'));
  assert.notEqual(swappedUnits, units);
  assert.throws(() => unitsChain(swappedUnits), { message: /units 1-2: order violated/ });
});

// --- decomposition-mode.md: the Implicit Dependency Detection clause ---------------------------

const IDD = (text) => between(text, '### Implicit Dependency Detection', '## Step 2.6: Collapse Decision', 'Implicit Dependency Detection');
const IDD_FACTS = [
  [/On an approved parts list, a flagged link that the part's own `blockers` do not carry would change an approved part, so `### Approved parts list \(checked first\)`'s rule asks before Step 4 writes it\./, 'I1 a new implicit link goes to the approved-part rule'],
];
const missingIdd = missingFactsOf(IDD_FACTS);

test('Implicit Dependency Detection sends a link an approved part lacks to the approved-part rule', () => {
  const region = IDD(DM);
  assert.deepEqual(missingIdd(region), []);
  assertEachPatternGoesRed(region, IDD_FACTS, missingIdd);
  // Move-out control: the clause moved into the approved-parts branch leaves this section red.
  const clause = DM.match(IDD_FACTS[0][0])[0];
  const moved = DM.replace(`\n\n${clause}`, '').replace(SIZING_HEADING, () => `\n${clause}\n${SIZING_HEADING}`);
  assert.notEqual(moved, DM);
  assert.ok(moved.includes(clause), 'the move must keep the clause in the file');
  assert.deepEqual(missingIdd(IDD(moved)), ['I1 a new implicit link goes to the approved-part rule']);
});

// --- collapse-decision.md ---------------------------------------------------------------------

const COLLAPSE_HEAD = '**An approved parts list fixes the decision.** Two or more approved parts always keep the parent, whatever the signals below say; one approved part collapses as below.';
const COUNT_CLAUSE = "The count is `check-approval`'s `parts`, the whole approved list across every repository, never `filing.file`: an approved order of two or more parts keeps a parent in every repository's run, even one that files a single part here.";
const EMPTY_CLAUSE = "The whole-list count applies when this run files at least one part: an empty `filing.file`, every part left for another repository or already filed, creates nothing — no parent, no sub-issue — and Step 9's summary says nothing was filed here and lists the left and skipped parts.";
const UNIT_SET = '**The unit set counted here';
const ONE_UNIT = '**1 work unit — always collapses.**';
const THREE_UNITS = '**3+ work units — never collapses.**';
const collapseParaOf = (text) => text.split('\n').find((l) => l.startsWith('**An approved parts list fixes the decision.**')) || '';

function assertCollapsePara(text) {
  assert.equal(text.split(COLLAPSE_HEAD).length - 1, 1, 'approved-parts collapse paragraph must appear exactly once');
  requireOrder(text, UNIT_SET, COLLAPSE_HEAD, 'collapse paragraph after the unit-set paragraph');
  requireOrder(text, COLLAPSE_HEAD, ONE_UNIT, 'collapse paragraph before the 1-unit rule');
  assert.ok(collapseParaOf(text).includes(COUNT_CLAUSE), 'collapse count must be the whole approved list, not filing.file');
  assert.ok(collapseParaOf(text).includes(EMPTY_CLAUSE), 'an empty filing.file must create nothing');
}

test('an empty filing.file creates nothing and Step 9 says so', () => {
  assertCollapsePara(COLLAPSE);
  // Mutation control: an empty run that still keeps a parent goes red on its own message.
  const keeps = COLLAPSE.replace('creates nothing — no parent, no sub-issue —', 'keeps the parent with no sub-issue,');
  assert.notEqual(keeps, COLLAPSE);
  assert.throws(() => assertCollapsePara(keeps), { message: /an empty filing\.file must create nothing/ });
  // Move-out control: the clause moved to its own paragraph, still in the file.
  const split = COLLAPSE.replace(` ${EMPTY_CLAUSE}`, '').replace(THREE_UNITS, () => `${EMPTY_CLAUSE}\n\n${THREE_UNITS}`);
  assert.notEqual(split, COLLAPSE);
  assert.ok(split.includes(EMPTY_CLAUSE));
  assert.throws(() => assertCollapsePara(split), { message: /an empty filing\.file must create nothing/ });
});

test('AC2.1: two or more approved parts keep the parent', () => {
  assertCollapsePara(COLLAPSE);
  const para = collapseParaOf(COLLAPSE);
  // Deletion control.
  const deleted = COLLAPSE.replace(`${para}\n\n`, '');
  assert.notEqual(deleted, COLLAPSE);
  assert.throws(() => assertCollapsePara(deleted), { message: /must appear exactly once/ });
  // Move-out control: the paragraph moved below the 3+ rule stays in the file but out of place.
  const threeLine = COLLAPSE.split('\n').find((l) => l.startsWith(THREE_UNITS));
  const moved = deleted.replace(threeLine, () => `${threeLine}\n\n${para}`);
  assert.notEqual(moved, deleted);
  assert.throws(() => assertCollapsePara(moved), { message: /collapse paragraph before the 1-unit rule: order violated/ });
});

test('the collapse count is the whole approved list across repositories, never filing.file', () => {
  assertCollapsePara(COLLAPSE);
  // Mutation control: the count narrowed to this run's filing.file goes red on its own message.
  const narrowed = COLLAPSE.replace("`parts`, the whole approved list across every repository, never `filing.file`", '`filing.file`, the parts this run files');
  assert.notEqual(narrowed, COLLAPSE);
  assert.throws(() => assertCollapsePara(narrowed), { message: /collapse count must be the whole approved list, not filing\.file/ });
  // Move-out control: the count clause moved to its own paragraph, still in the file, goes red too.
  const split = COLLAPSE.replace(` ${COUNT_CLAUSE}`, '').replace(THREE_UNITS, () => `${COUNT_CLAUSE}\n\n${THREE_UNITS}`);
  assert.notEqual(split, COLLAPSE);
  assert.ok(split.includes(COUNT_CLAUSE));
  assert.throws(() => assertCollapsePara(split), { message: /collapse count must be the whole approved list, not filing\.file/ });
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

const READY_REGION = (text) => between(text, '**Only sub-issues get `ready`**', '**Fresh manifest for this invocation.**', 'ready region');
const READY_FACTS = [
  [/\*\*No `ready` on a symbolic blocker\.\*\* On an approved parts list \(`decomposition-mode\.md` Step 2\), a sub-issue whose blockers include a `symbolic` one, a part left for another repository and written `Blocked by: \{ref\}`, is created without `ready`/, 'Y1 a symbolic blocker creates the sub-issue without ready'],
  [/each runs `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/ready-gate\.js" "\$SPECIFY_SUB_ISSUE_BODY"` and adds `ready` \(the `--label ready` flag under `github-issues`, `stage: 'ready'` under `local-files`\) only on exit 0/, 'Y2 the ready label or stage follows the gate'],
  [/The later repository's run restores `ready` when it writes the `owner\/name#N` form \(`decomposition-mode-closeout\.md` Step 4\)\./, 'Y3 the later run restores ready'],
];
const missingReady = missingFactsOf(READY_FACTS);

test('record-creation-subissues.md: a symbolic blocker is created without ready, restored by the later run', () => {
  const region = READY_REGION(SUB);
  assert.deepEqual(missingReady(region), []);
  assertEachPatternGoesRed(region, READY_FACTS, missingReady);
  // Move-out control: the paragraph moved below the Fingerprint heading stays in the file but leaves the region red.
  const para = SUB.split('\n').find((l) => l.startsWith('**No `ready` on a symbolic blocker.**'));
  assert.ok(para, 'the paragraph must be one line');
  const moved = SUB.replace(`${para}\n\n`, '').replace('**Fingerprint**', () => `${para}\n\n**Fingerprint**`);
  assert.notEqual(moved, SUB);
  assert.deepEqual(missingReady(moved), [], 'the moved paragraph must still match file-wide');
  assert.deepEqual(missingReady(READY_REGION(moved)), READY_FACTS.map(([, f]) => f));
});

// --- red-team.md, decomposition-mode-closeout.md, mechanical-handoff.md (#6353 Task 5) ----------

const RT = read('red-team.md');
const CLOSE = read('decomposition-mode-closeout.md');
const HANDOFF = read('mechanical-handoff.md');

const T5_REGIONS = {
  rt: (text) => between(text, '5. **Decision-worthy findings stage instead', '6. **Compose-then-write-once**', 'red-team write-back step 5'),
  step4: (text) => between(text, '## Step 4: Link and order', '## Step 5: Multi-Persona Red-Team', 'closeout Step 4'),
  step6: (text) => between(text, '3. **Scope check**', '4. **Ambiguity check**', 'closeout Step 6 scope check'),
  check5: (text) => between(text, '5. **Design-doc coverage**', 'When all five checks come back clean', 'closeout Step 6 check 5'),
  staged: (text) => between(text, '**Resolving a `### Staged for caller` row.**', '`{ref}` is `#{N}` under', 'closeout staged-row resolution'),
  rtConsole: (text) => between(text, '   - **A run directory resolved**', '   - **No run directory resolved**', 'red-team staged-proposal bullet'),
  kept: (text) => between(text, '## Step 4: Link and order', '## Step 7: Delete Consumed Artifacts', 'closeout Steps 4-6'),
  step7: (text) => between(text, '## Step 7: Delete Consumed Artifacts', '## Step 9: Summary and Commit', 'closeout Step 7'),
  step9: (text) => between(text, '## Step 9: Summary and Commit', 'By the time Next Actions renders', 'closeout Step 9'),
  row: (text) => between(text, '\n## Required inputs', '\n## Dispatch prompt', 'handoff Required inputs'),
  prompt: (text) => between(text, '\n## Dispatch prompt', '\nStatus line (required)', 'handoff dispatch prompt'),
};

const T5_FACTS = {
  rt: [
    [/On an approved parts list \(`decomposition-mode\.md`'s Approved parts list\), a finding whose resolution would change a part's name, size or blockers is always decision-worthy and is never applied: it is staged or asked as above, and the part stays as approved/, 'T1 a part-changing finding is never applied'],
    [/with neither a run directory nor a human, the marker stays and `ready` stays cleared\. The red-team may still write its marker or Open Questions row\./, 'T2 no run dir and no human keeps the marker'],
  ],
  step4: [
    [/for each `filing\.writeBack` entry `\{ issue, waitsOn, line \}`, replace the entry's `line`, the exact text the earlier run wrote, in that issue's body with `Blocked by \{thisRepository\}#\{N\}`/, 'W1 the exact symbolic line is replaced by the sibling ref'],
    [/`gh issue view \{n\} --repo \{owner\/name\} --json body` read and one `gh issue edit \{n\} --repo \{owner\/name\} --body-file` write per issue/, 'W2 gh read and write per issue'],
    [/A line that is not there is left alone and named in Step 9's summary\./, 'W3 a missing line is named, not edited'],
    [/Under `local-files` there is no other repository's store to edit, so each entry is listed in Step 9's summary instead, with the `ready` it would restore\./, 'W4 local-files lists the entries'],
    [/once all its entries are replaced, add `ready` back only when `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/ready-gate\.js"` exits 0 on the composed body \(written to a session temp file first\); on exit 1 `ready` stays off/, 'W5 ready comes back only when ready-gate.js exits 0 on the composed body'],
    [/\(with `--add-label ready` when `ready` comes back\)/, 'W6 the gh write adds ready back'],
    [/an issue this check keeps without `ready` is named in Step 9's summary with its number and the reason\./, 'W7 an issue kept without ready is named in Step 9'],
  ],
  staged: [
    [/no `## Open Questions` heading is left, and no `Blocked by: … \(left for …\)` line remains \(a part left for another repository keeps `ready` off until that repository's run rewrites the line\)\./, 'R4a a staged-row resolution keeps ready off while a left-for line remains'],
  ],
  rtConsole: [
    [/restores `ready`, except while the body still carries a `Blocked by: … \(left for …\)` line: that keeps `ready` off until the later repository's run rewrites it \(`bin\/resolve-ambiguity\.js` prints `readyRestorable: false` then\)\./, 'R4b the Review Console keeps ready off while a left-for line remains'],
  ],
  step6: [
    [/On the approved branch this check does not apply to approved parts: a scope concern on a part goes through `decomposition-mode\.md`'s no-gate rule, which the dispatch prompt's `Approved parts` line states, and the part stays as approved\./, 'C1 Step 6 split and merge never touch an approved part'],
  ],
  check5: [
    [/the doc is about to be deleted in Step 7 \(kept on the approved branch\)\./, 'C5 check 5 says the approved branch keeps the doc'],
  ],
  kept: [
    [/before Step 7 \(on the approved branch the design folder is kept, never deleted\)/, 'D1 Step 4 keeps the folder'],
    [/Before deleting the design doc \(on the approved branch the design folder is kept, never deleted\), dispatch persona/, 'D2 Step 5 keeps the folder'],
    [/Before deleting the design doc \(on the approved branch the design folder is kept, never deleted\), look at every record/, 'D3 Step 6 keeps the folder'],
  ],
  step7: [
    [/\| Approved parts list \(Step 2's approved branch\) \| \*\*No\*\* — the design folder is kept, since it holds the evidence and the notes\./, 'K1 the folder is kept'],
    [/Mark each part this run filed `\{thisRepository\}#\{N\}` and each part in `filing\.leftFor` `left for \{owner\/name\}` \(never a part in `filing\.skipped`\)/, 'K2 filed, left-for and skipped marks'],
    [/write the marks to a session temp JSON file with the Write tool and run `mark-filed`; Step 9's `git add` stages the marked `design\.md`\./, 'K3 marks file by Write, then mark-filed, Step 9\'s git add stages design.md'],
    [/node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/design-session\.js" mark-filed --folder "\{folder\}" --marks "\{marks file\}"/, 'K4 the mark-filed call'],
    [/The `git rm` block below does not run on this branch, and Step 7 makes no commit of its own: Step 9's commit stages the marked `design\.md`\./, 'K5 git rm does not run, Step 9 commits'],
  ],
  step9: [
    [/the design-doc deletion\/marker from Step 7 \(on the approved branch, the marked `design\.md`\)/, 'S5 Step 9 commit stages the marked design.md'],
    [/docs\/: design-doc removal\/marker, or the marked design\.md on the approved branch/, 'S6 bash comment names the marked design.md'],
    [/Under the approved branch\*\* \(`\{argument\}` is `check-approval`'s `designSlug` with each `-` read as a space, which slugs back to the same design folder\) the summary's Artifacts line reads `Design folder kept: \{path\} \(parts marked filed\)`/, 'S1 Artifacts line'],
    [/### Left for another repository \(optional/, 'S2 the block heading in the template'],
    [/The `### Left for another repository` block lists each part in `filing\.leftFor` with its repository and the rerun line `\/claude-tweaks:design \{argument\}` \(in that repository's checkout, from a copy of the folder as this step commits it; its `status` reads that repository, finds the part marked `left for` it and resumes at step 10\)/, 'S3 block content and rerun line'],
    [/- \{part name\} — left for \{owner\/name\}; copy the design folder, as this step commits it, into that repository's checkout and rerun `\/claude-tweaks:design \{argument\}` there: it resumes at step 10/, 'S7 the template rerun line copies the committed folder'],
    [/With an empty `filing\.file` the summary says nothing was filed here and lists the left and skipped parts\./, 'S4 empty filing.file'],
    [/each issue whose `ready` Step 4 kept off \(`\{owner\/name\}#\{n\} — ready stays off: \{each of the gate's printed `reasons`\} remains`\)/, 'S8 an issue Step 4 kept without ready, with its number and why'],
  ],
  row: [
    [/\| Approved parts \(omit unless Step 2 took the approved branch\) \| `check-approval`'s JSON \(parts, measure, designSlug, and `filing`'s file, skipped, leftFor and writeBack lists\), the folder path, and the no-gate rule in one sentence, since the subagent never reads `decomposition-mode\.md` \|/, 'H1 row inputs carry the JSON, folder and the no-gate rule'],
    [/Step 3 titles, sizes and slugs each unit from it, creates a unit with a `symbolic` blocker without `ready`, and writes the measure on the parent; Step 4 writes `filing\.writeBack` back and restores those issues' `ready`; Step 5 keeps every part as approved; Step 7 marks and keeps the folder instead of deleting it; Step 9 lists the left-for parts \|/, 'H2 row says why each step needs it'],
  ],
  prompt: [
    [/\[Approved parts — omit unless Step 2 took the approved branch: check-approval JSON \{the whole\nprinted object\}; design folder \{path\}\./, 'H3 prompt line carries JSON and folder'],
    [/No gate changes an approved part: no step applies an\noutcome that would drop, merge, rename or re-size a part, or add or remove one of its blockers —\nbefore its record exists, stop and ask or stage; once it exists, leave the part as approved, clear\nthe record's ready, and stage or ask the question, never applying the change\./, 'H4 prompt states the no-gate rule itself'],
    [/Keep the design\nfolder; mark it with mark-filed instead of deleting it\]/, 'H5 prompt keeps and marks the folder'],
    [/A choice to change\nit stops the run: records already created stay, with ready cleared, and the stop message lists\nthem and says that after the new approval a renamed part's old record must be closed or reused,\nsince its fingerprint no longer matches\./, 'H6 prompt: a change keeps created records, ready cleared'],
  ],
};
const missingT5 = Object.fromEntries(Object.entries(T5_FACTS).map(([k, f]) => [k, missingFactsOf(f)]));
const T5_SOURCE = { rt: RT, rtConsole: RT, step4: CLOSE, step6: CLOSE, check5: CLOSE, staged: CLOSE, kept: CLOSE, step7: CLOSE, step9: CLOSE, row: HANDOFF, prompt: HANDOFF };
const allFacts = (region) => T5_FACTS[region].map(([, f]) => f);

function pinT5(region, ...prefixes) {
  const text = T5_REGIONS[region](T5_SOURCE[region]);
  const subset = T5_FACTS[region].filter(([, fact]) => prefixes.some((p) => fact.startsWith(p)));
  assert.ok(subset.length > 0, `no facts named ${prefixes.join(', ')}`);
  assert.deepEqual(missingT5[region](text).filter((f) => subset.some(([, s]) => s === f)), [], `${region} is missing facts`);
  assertEachPatternGoesRed(text, subset, missingT5[region]);
}

test('every Task 5 region states every fact, each exactly once', () => {
  for (const region of Object.keys(T5_FACTS)) {
    const text = T5_REGIONS[region](T5_SOURCE[region]);
    assert.deepEqual(missingT5[region](text), [], region);
    assertEachPatternGoesRed(text, T5_FACTS[region], missingT5[region]);
  }
});

test('AC2.2: red-team never changes an approved part', () => {
  pinT5('rt', 'T');
  // Move-out control: the clause moved below step 6 stays in the file but leaves step 5 red.
  const para = RT.split('\n').find((l) => T5_FACTS.rt[0][0].test(l));
  assert.ok(para, 'the clause must sit in one paragraph');
  const moved = RT.replace(`${para}\n`, '').replace('7. **Decision-log entries', () => `${para}\n7. **Decision-log entries`);
  assert.notEqual(moved, RT);
  assert.ok(moved.includes(para));
  assert.deepEqual(missingT5.rt(T5_REGIONS.rt(moved)), allFacts('rt'));
});

test('a later repository\'s run rewrites the earlier issues\' symbolic blockers', () => {
  pinT5('step4', 'W');
  // Move-out control: the paragraph moved into Step 5 stays in the file but leaves Step 4 red.
  const para = CLOSE.split('\n').find((l) => l.startsWith('**Approved parts list (Step 2\'s approved branch) — write back'));
  assert.ok(para, 'write-back paragraph must be one line');
  const moved = CLOSE.replace(`${para}\n\n`, '').replace('## Step 5: Multi-Persona Red-Team\n', () => `## Step 5: Multi-Persona Red-Team\n\n${para}\n`);
  assert.notEqual(moved, CLOSE);
  assert.ok(moved.includes(para));
  assert.deepEqual(missingT5.step4(T5_REGIONS.step4(moved)), allFacts('step4'));
});

test('the design folder is kept and its parts marked filed', () => {
  pinT5('step7', 'K');
  const ROW = '| Approved parts list (Step 2\'s approved branch)';
  const FIRST = '| No `phase-N` argument; doc has 0 phase sections';
  const GIT_RM = 'git rm docs/superpowers/specs/';
  const order = (text) => {
    requireOrder(text, ROW, FIRST, 'approved row first in the table');
    requireOrder(text, FIRST, GIT_RM, 'table before the git rm block');
    requireOrder(text, 'design-session.js" mark-filed', GIT_RM, 'mark-filed before the git rm block');
  };
  order(CLOSE);
  const row = CLOSE.split('\n').find((l) => l.startsWith(ROW));
  const firstRow = CLOSE.split('\n').find((l) => l.startsWith(FIRST));
  const rowSecond = CLOSE.replace(`${row}\n`, '').replace(`${firstRow}\n`, () => `${firstRow}\n${row}\n`);
  assert.notEqual(rowSecond, CLOSE);
  assert.throws(() => order(rowSecond), { message: /approved row first in the table: order violated/ });
  const call = 'node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" mark-filed --folder "{folder}" --marks "{marks file}"';
  const markLate = CLOSE.replace(`\`\`\`bash\n${call}\n\`\`\`\n\n`, '').replace('git rm docs/superpowers/specs/YYYY-MM-DD-{topic}-design.md\n', (m) => `${m}${call}\n`);
  assert.notEqual(markLate, CLOSE);
  assert.throws(() => order(markLate), { message: /mark-filed before the git rm block: order violated/ });
});

test('the mark-filed call is one the CLI accepts', () => {
  const usage = execFileSync(process.execPath, [path.join(ROOT, 'plugin', 'bin', 'design-session.js'), '--help'], { encoding: 'utf8' });
  const flagsOf = (line) => [...line.matchAll(/--[a-z-]+/g)].map((m) => m[0]);
  const closeoutCall = (text) => {
    const line = text.split('\n').find((l) => l.startsWith('node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" mark-filed'));
    assert.ok(line, 'the closeout must carry the mark-filed call');
    return line;
  };
  const accepted = (text, usageText) => {
    const usageLine = usageText.split('\n').find((l) => l.includes('design-session.js mark-filed'));
    assert.ok(usageLine, 'the CLI usage must list mark-filed');
    const allowed = flagsOf(usageLine);
    assert.ok(allowed.length > 0, 'the usage line must list flags');
    const used = flagsOf(closeoutCall(text));
    assert.ok(used.length > 0, 'the closeout call must pass flags');
    for (const flag of used) assert.ok(allowed.includes(flag), `mark-filed flag ${flag} is not in the CLI usage`);
  };
  accepted(CLOSE, usage);
  // Control: a renamed flag in the closeout copy goes red on its own message.
  const renamed = CLOSE.replace('mark-filed --folder "{folder}" --marks', 'mark-filed --folder "{folder}" --marksfile');
  assert.notEqual(renamed, CLOSE);
  assert.throws(() => accepted(renamed, usage), { message: /mark-filed flag --marksfile is not in the CLI usage/ });
});

test('parts left for another repository appear in the Step 9 summary', () => {
  pinT5('step9', 'S');
  // Move-out control: the Artifacts-line paragraph moved above Step 9 leaves its facts red.
  const para = CLOSE.split('\n').find((l) => l.startsWith('**Under the approved branch**'));
  assert.ok(para, 'Step 9 approved paragraph must be one line');
  const moved = CLOSE.replace(`${para}\n\n`, '').replace('## Step 9: Summary and Commit\n', () => `${para}\n\n## Step 9: Summary and Commit\n`);
  assert.notEqual(moved, CLOSE);
  assert.ok(moved.includes(para));
  assert.deepEqual(missingT5.step9(T5_REGIONS.step9(moved)), ['S1 Artifacts line', 'S3 block content and rerun line', 'S4 empty filing.file', 'S8 an issue Step 4 kept without ready, with its number and why']);
});

test('an issue whose ready the write-back held back is named in Step 9 with its number and why', () => {
  pinT5('step4', 'W7');
  pinT5('step9', 'S8');
});

test('neither the staged-row resolution nor the Review Console re-readies an issue with a left-for line', () => {
  pinT5('staged', 'R4a');
  pinT5('rtConsole', 'R4b');
  // Control: the old staged-row wording, with no left-for clause, goes red on R4a alone.
  const old = CLOSE.replace(", no `## Open Questions` heading is left, and no `Blocked by: … (left for …)` line remains (a part left for another repository keeps `ready` off until that repository's run rewrites the line).",
    ' and no `## Open Questions` heading is left.');
  assert.notEqual(old, CLOSE);
  assert.deepEqual(missingT5.staged(T5_REGIONS.staged(old)), ['R4a a staged-row resolution keeps ready off while a left-for line remains']);
  // Control: the console clause moved below the staged-proposal bullet, still in the file, leaves that bullet red.
  const clause = RT.match(T5_FACTS.rtConsole[0][0])[0];
  const tail = clause.slice('restores `ready`'.length);
  const moved = RT.replace(tail, '.').replace('   Everything below this bar keeps the existing no-stop flow.', (m) => `${m}\n   The console ${clause}`);
  assert.notEqual(moved, RT);
  assert.ok(T5_FACTS.rtConsole[0][0].test(moved), 'the moved clause must stay in the file');
  assert.deepEqual(missingT5.rtConsole(T5_REGIONS.rtConsole(moved)), ['R4b the Review Console keeps ready off while a left-for line remains']);
});

test('Step 6 never splits or merges an approved part, and Steps 4-6 keep the design folder', () => {
  pinT5('step6', 'C');
  pinT5('kept', 'D');
  // Move-out control: the Step 6 carve-out moved to Step 7 stays in the file but leaves the scope check red.
  const clause = ' On the approved branch this check does not apply to approved parts';
  const line = CLOSE.split('\n').find((l) => l.includes(clause));
  assert.ok(line, 'carve-out must sit on the scope check line');
  const tail = line.slice(line.indexOf(clause));
  const moved = CLOSE.replace(tail, '').replace('## Step 7: Delete Consumed Artifacts (only when fully decomposed)\n', (m) => `${m}\n${tail.trim()}\n`);
  assert.notEqual(moved, CLOSE);
  assert.ok(moved.includes(tail.trim()));
  assert.deepEqual(missingT5.step6(T5_REGIONS.step6(moved)), allFacts('step6'));
  // The deletion wording alone, with the keep note stripped from Step 5, goes red on D2 only.
  const stripped = CLOSE.replace('Before deleting the design doc (on the approved branch the design folder is kept, never deleted), dispatch', 'Before deleting the design doc, dispatch');
  assert.notEqual(stripped, CLOSE);
  assert.deepEqual(missingT5.kept(T5_REGIONS.kept(stripped)), ['D2 Step 5 keeps the folder']);
});

test('Step 6 check 5 and Step 7 say the approved branch keeps design.md for Step 9\'s git add', () => {
  pinT5('check5', 'C5');
  pinT5('step7', 'K3');
  // Control: the old Step 7 wording, design.md left staged for Step 9's commit, goes red on K3 alone.
  const old = CLOSE.replace("write the marks to a session temp JSON file with the Write tool and run `mark-filed`; Step 9's `git add` stages the marked `design.md`.",
    "write the marks to a session temp JSON file with the Write tool, run `mark-filed`, and leave `design.md` staged for Step 9's commit.");
  assert.notEqual(old, CLOSE);
  assert.deepEqual(missingT5.step7(T5_REGIONS.step7(old)), ["K3 marks file by Write, then mark-filed, Step 9's git add stages design.md"]);
});

test('the mechanical handoff carries the approved parts', () => {
  pinT5('row', 'H1', 'H2');
  pinT5('prompt', 'H3', 'H4', 'H5', 'H6');
  // Move-out control: the prompt line moved above the dispatch prompt heading leaves the prompt red.
  const start = HANDOFF.indexOf('[Approved parts — omit unless');
  const tail = 'instead of deleting it]';
  const end = HANDOFF.indexOf(tail, start) + tail.length;
  assert.ok(start > 0 && end > start, 'prompt line must resolve');
  const line = HANDOFF.slice(start, end);
  const moved = HANDOFF.replace(`${line}\n`, '').replace('\n## Dispatch prompt', () => `\n${line}\n\n## Dispatch prompt`);
  assert.notEqual(moved, HANDOFF);
  assert.deepEqual(missingT5.prompt(T5_REGIONS.prompt(moved)), allFacts('prompt'));
  requireOrder(HANDOFF, '| Approved parts (omit unless', '| Design doc — path and', 'approved row before the design doc row');
});
