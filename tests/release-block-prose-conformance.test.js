'use strict';
// #5882 — pins plugin/skills/_shared/release-block.md: its section order, the setters and
// clearing acts, the forge-keyed skip, the exit-code tables, the stamp-comment twin of
// bin/release-block.js, and the gh-absent (MCP) equivalents; then release/SKILL.md's Step 1.5
// gate, its HARD-GATE registration and the HELD lists that name it. Go-red controls run the
// same helpers on mutated or frozen copies (skill-prose-conformance-tests).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { stampCommentBody } = require('../plugin/bin/release-block');

const FILE = path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'release-block.md');
const text = readText(FILE);

const HEADINGS = [
  '## What sets a block',
  '## How a block clears',
  '## The CLI',
  '### Stamp comment',
  '## What a release does while a block is open',
  '## gh-absent (MCP) path',
  '## What this does not stop',
];

function assertContractSections(src) {
  let last = -1;
  const lines = src.split('\n');
  for (const h of HEADINGS) {
    const idx = lines.indexOf(h);
    assert.notStrictEqual(idx, -1, `missing heading: ${h}`);
    assert.ok(idx > last, `heading out of order: ${h}`);
    last = idx;
  }
}

// The slice from a heading line to the next heading of the same or higher level.
function section(src, heading) {
  const lines = src.split('\n');
  const start = lines.indexOf(heading);
  assert.notStrictEqual(start, -1, `missing heading: ${heading}`);
  const level = heading.match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#+) /);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

const REL = '## What a release does while a block is open';
const SKIP_LINE = 'condition: no GitHub origin (_shared/forge-detection.md check 1)';
function assertForgeKeyedSkip(src) {
  assert.ok(section(src, REL).includes(SKIP_LINE), 'skip line must be forge-keyed');
  assert.ok(!src.includes('condition: work-backend'), 'no work-backend condition anywhere');
}

// The superseded line, frozen (spec Plan Review Clarifications): keyed on work-backend.
const SUPERSEDED_SKIP = 'SKIP … — Step 1.5 release-block check (skipped): condition: work-backend local-files → fallback: no forge label to read; release proceeds. Reversibility: n/a.';

function assertGhBeforeBash(rel) {
  const detect = rel.indexOf('command -v gh');
  const bash = rel.indexOf('release-block.js" check');
  assert.ok(detect !== -1, 'command -v gh is named');
  assert.ok(bash !== -1, 'the bash check is named');
  assert.ok(detect < bash, 'command -v gh must precede the bash check');
}

// The fenced `text` block under ### Stamp comment.
function stampFence(src) {
  const m = section(src, '### Stamp comment').match(/```text\n([\s\S]*?)\n```/);
  assert.ok(m, 'Stamp comment needs a ```text fence');
  return m[1];
}
function assertStampTwin(fence) {
  assert.strictEqual(fence.replace('{finding}', 'X at general'), stampCommentBody('X at general').replace(/\n+$/, ''));
}

test('contract: every section heading is present, in order', () => {
  assertContractSections(text);
  const mutated = text.replace('## How a block clears\n', '');
  assert.notStrictEqual(mutated, text);
  assert.throws(() => assertContractSections(mutated), { message: /missing heading: ## How a block clears/ });
});

test('contract: sets and clears', () => {
  const sets = section(text, '## What sets a block');
  const items = sets.split('\n').filter((l) => /^\d\. /.test(l));
  assert.strictEqual(items.length, 3, 'exactly three numbered setters');
  assert.match(items[0], /critical or high/);
  assert.match(items[0], /rolling review/);
  assert.match(items[0], /delta review/);
  assert.match(items[1], /Step 8's disposition/);
  assert.ok(items[1].includes('declined (covered by #{n})'), 'covering-record stamp on the Step 8 setter');
  assert.match(items[2], /a human/);
  const clears = section(text, '## How a block clears');
  assert.match(clears, /close the record/);
  assert.match(clears, /remove the label/);
  assert.match(clears, /no reason is required/i);
});

test('contract: forge-keyed skip', () => {
  assertForgeKeyedSkip(text);
  const swapped = text.replace(/SKIP …[^\n]*\n?/, `${SUPERSEDED_SKIP}\n`);
  assert.notStrictEqual(swapped, text);
  assert.throws(() => assertForgeKeyedSkip(swapped), { message: /forge-keyed|work-backend/ });
  assert.throws(() => assertForgeKeyedSkip(`${text}\n${SUPERSEDED_SKIP}\n`), { message: /no work-backend condition/ });
});

test('contract: gh detected before the bash check', () => {
  const rel = section(text, REL);
  assertGhBeforeBash(rel);
  assert.match(rel, /gh absent[\s\S]{0,200}## gh-absent \(MCP\) path/);
  assert.match(rel, /no new exit code/);
  assert.match(rel, /unavailable[\s\S]{0,60}exit 3/);
  // Control: the same text with the two markers swapped must fail the order check.
  const swapped = rel.replace('command -v gh', '@@').replace('release-block.js" check', 'command -v gh').replace('@@', 'release-block.js" check');
  assert.throws(() => assertGhBeforeBash(swapped), { message: /must precede/ });
});

// Each table is sliced from its header row to the first blank line, so a row can only
// satisfy the table it sits in.
function tableSlice(src, header) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.startsWith(header));
  assert.notStrictEqual(start, -1, `missing table: ${header}`);
  const end = lines.findIndex((l, i) => i > start && l.trim() === '');
  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}
function assertExitTables(cli) {
  const check = tableSlice(cli, '| `check` |');
  for (const row of ['| 0 | none open', '| 1 | blocked', '| 2 | usage error, or an unresolvable or refused repo', '| 3 | state unreadable']) {
    assert.ok(check.includes(row), `check table: missing row ${row.slice(0, 3)}`);
  }
  const stamp = tableSlice(cli, '| `stamp` |');
  for (const row of ['| 0 | stamped or already stamped', '| 2 | usage error, an unresolvable or refused repo, no such record, or a PR number', '| 3 | write failure']) {
    assert.ok(stamp.includes(row), `stamp table: missing row ${row.slice(0, 3)}`);
  }
}

test('contract: exit codes', () => {
  const cli = section(text, '## The CLI');
  assertExitTables(cli);
  const noStamp3 = cli.split('\n').filter((l) => !l.startsWith('| 3 | write failure')).join('\n');
  assert.notStrictEqual(noStamp3, cli);
  assert.throws(() => assertExitTables(noStamp3), { message: /stamp table: missing row \| 3/ });
  const noCheck2 = cli.split('\n').filter((l) => !l.startsWith('| 2 | usage error, or')).join('\n');
  assert.notStrictEqual(noCheck2, cli);
  assert.throws(() => assertExitTables(noCheck2), { message: /check table: missing row \| 2/ });
  const gutted = cli.replace('| 2 | usage error, an unresolvable or refused repo, no such record, or a PR number', '| 2 | usage error');
  assert.notStrictEqual(gutted, cli);
  assert.throws(() => assertExitTables(gutted), { message: /stamp table: missing row \| 2/ });
  assert.ok(cli.includes('{"blocked":true,"records":[{"number":N,"title":"…","url":"…"}]}'), 'exit-1 JSON shape');
  assert.match(cli, /fills `--limit 100`/);
  assert.match(cli, /missing label reads as none/);
});

function assertFindingGrammar(src) {
  const cli = section(src, '## The CLI');
  assert.match(cli, /file part that starts with a non-whitespace character, followed by `:` and one or more digits/, 'location rule');
  assert.match(cli, /file part may contain spaces and colons/, 'location rule: spaces and colons');
}

test('contract: finding grammar matches isValidFinding', () => {
  assertFindingGrammar(text);
  const loose = text.replace('starts with a non-whitespace character', 'ends');
  assert.notStrictEqual(loose, text);
  assert.throws(() => assertFindingGrammar(loose), { message: /location rule/ });
  // The doc's rule agrees with the CLI on the two cases the review named.
  const { isValidFinding } = require('../plugin/bin/release-block');
  assert.strictEqual(isValidFinding('x at  a:5'), false);
  assert.strictEqual(isValidFinding('x at :5'), false);
  assert.strictEqual(isValidFinding('x at C:/a b.js:5'), true);
});

test('contract: stamp comment twin', () => {
  assertStampTwin(stampFence(text));
  assert.throws(() => assertStampTwin(`${stampFence(text)} extra`), { name: 'AssertionError' });
});

test('AC2.1: a held release names each blocking record in release-held.md', () => {
  const rel = section(text, REL);
  assert.match(rel, /release-held\.md/);
  assert.match(rel, /`release-block`/);
  assert.ok(rel.includes('#N {title} {url}'));
  assert.match(rel, /effective version and its base/);
  assert.match(rel, /clearing act/);
  assert.match(rel, /No autonomy ceiling/);
  assert.match(rel, /re-runs `check`/);
});

test('contract: MCP path', () => {
  const mcp = section(text, '## gh-absent (MCP) path');
  assert.match(mcp, /`list_issues`[^\n]*release-block[^\n]*open[^\n]*`perPage: 100`/);
  assert.ok(mcp.includes('{number, title, url, state}'));
  assert.ok(mcp.includes('release-block.js" check --records-json'));
  assert.match(mcp, /unavailable or erroring[^\n]*exit 3/);
  assert.match(mcp, /`issue_read`/);
  assert.match(mcp, /`issue_write`[^\n]*`mergeLabelNames`[^\n]*Full-replace hazard/);
  assert.ok(mcp.includes('_shared/github-write-transport.md'));
  assert.match(mcp, /`add_issue_comment`/);
  assert.match(mcp, /`label create` has no MCP row/);
});

// ── Release Step 1.5 and the HELD sweep (#5882 Task 4) ──────────────────────────────────────
// Each claim runs twice through one helper: on the live text, and on the live text with the
// pinned piece swapped for a frozen excerpt of the pre-change bytes (or a permuted copy).
const { sectionOf, lineStartingWith } = require('./helpers/conformance-asserts');
const { stagingExemption } = require('../plugin/bin/lib/console/resolve');
const { parseRoutineTemplate } = require('../plugin/bin/lib/routine-template-parser');

const ROOT = path.join(__dirname, '..');
const live = (rel) => readText(path.join(ROOT, rel));
const SKILL = live('plugin/skills/release/SKILL.md');
const STEP15 = '## Step 1.5: Release-block check';
const FENCE_LINE = 'node "${CLAUDE_PLUGIN_ROOT}/bin/release-block.js" check';
const step15Of = (src) => sectionOf(src, STEP15);

// The pre-change step headings, in file order (no Step 1.5 between Steps 1 and 2).
const PRE_STEP_HEADINGS = '## Step 1: Preflight fact pack\n\n## Step 2: Nothing to release\n\n## Step 3: Whole-branch review (before any bump)\n';

const STEP_ORDER = ['## Step 1: Preflight fact pack', STEP15, '## Step 2: Nothing to release', '## Step 3: Whole-branch review'];
function assertStepOrder(src) {
  const lines = src.split('\n');
  let last = -1;
  for (const marker of STEP_ORDER) {
    const idx = lines.findIndex((l) => l.startsWith(marker));
    assert.notStrictEqual(idx, -1, `step marker missing: ${marker}`);
    assert.ok(idx > last, `step out of order: ${marker}`);
    last = idx;
  }
}

test('AC1.1/AC1.2: Step 1.5 sits after Step 1 and before Steps 2 and 3, so no review or suite work precedes it', () => {
  assertStepOrder(SKILL);
  assert.throws(() => assertStepOrder(PRE_STEP_HEADINGS), { message: /step marker missing: ## Step 1\.5/ });
  // Permutation: the Step 1.5 section moved after Step 3's section.
  const block = `${step15Of(SKILL)}\n`;
  const without = SKILL.replace(block, '');
  assert.notStrictEqual(without, SKILL);
  const at = without.indexOf('## Step 4: Console');
  const moved = without.slice(0, at) + block + without.slice(at);
  assert.throws(() => assertStepOrder(moved), { message: /step out of order: ## Step 2/ });
});

const STEP15_FACTS = [
  [/before any review or suite work, on every path: interactive, `auto`, headless, `--train` and `--dry-run`/, 'every path, before any review or suite work'],
  [/precedes Step 3's tree check and any early-verify step inserted after Step 1/, 'precedes the tree check and any early verify'],
  [/^node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/release-block\.js" check$/m, 'the check fence line'],
  [/never on the prose/, 'routes on the exit code only'],
  [/\*\*0\*\* → log `AUTO[^`\n]*`, then Step 2/, 'exit 0 logs and goes on to Step 2'],
  [/\*\*1\*\* → stop `HELD`/, 'exit 1 stops HELD'],
  [/\*\*2\*\* or \*\*3\*\* → stop `failed`, `release-block state unreadable`/, 'exit 2 or 3 stops failed, unreadable'],
  [/`_shared\/release-block\.md`'s "What a release does while a block is open" section/, 'points at the contract section'],
];
const missingStep15 = (body) => STEP15_FACTS.filter(([re]) => !re.test(body)).map(([, fact]) => fact);

test('AC1.1: Step 1.5 runs check and routes on the exit code only', () => {
  const body = step15Of(SKILL);
  assert.deepStrictEqual(missingStep15(body), []);
  assert.throws(() => missingStep15(step15Of(PRE_STEP_HEADINGS)), { message: /heading not found: ## Step 1\.5/ });
  for (const [re, fact] of STEP15_FACTS) {
    const doctored = body.replace(re, '');
    assert.notStrictEqual(doctored, body, `anchor for "${fact}" not found`);
    assert.deepStrictEqual(missingStep15(doctored), [fact], `removing only "${fact}" turns exactly it red`);
  }
});

// The exit-0 log line is a twin of the contract's AUTO line (time placeholder aside).
function assertAutoLineTwin(body, contract) {
  const m = body.match(/`(AUTO \{HH:MM:SS\} — Step 1\.5: [^`\n]*)`/);
  assert.ok(m, 'Step 1.5 carries no AUTO line');
  assert.ok(section(contract, REL).includes(m[1].replace('{HH:MM:SS}', '…')), 'AUTO line differs from the contract');
}

test('AC1.1: Step 1.5\'s exit-0 log line matches the contract', () => {
  assertAutoLineTwin(step15Of(SKILL), text);
  const drifted = text.replace('release-block check: none open.', 'release-block check: clear.');
  assert.notStrictEqual(drifted, text);
  assert.throws(() => assertAutoLineTwin(step15Of(SKILL), drifted), { message: /differs from the contract/ });
});

test('AC4.2: an unreadable state stops the release and never proceeds', () => {
  const body = step15Of(SKILL);
  assert.ok(body.includes('release-block state unreadable'));
  assert.match(body, /stop `failed`/);
  assert.doesNotMatch(body, /\*\*[23]\*\*[^\n]{0,40}→ (?:log|Step 2)/, 'an unreadable state never routes on to Step 2');
});

// The superseded plan-draft sentence (spec Plan Review Clarifications): keyed on work-backend.
const SUPERSEDED_FORGE = 'Read `work-backend` as `console.md`\'s Inputs does. `local-files` → log the `SKIP` line';

function assertForgeKeyedStep15(body) {
  for (const lit of ['remote get-url origin', '`_shared/forge-detection.md` check 1', 'no GitHub origin', '`SKIP`']) {
    assert.ok(body.includes(lit), `forge skip: missing ${lit}`);
  }
  assert.ok(!body.includes('local-files'), 'forge skip: keyed on local-files');
  assert.ok(!body.includes('Read `work-backend`'), 'forge skip: reads work-backend');
}

test('AC3.1: no GitHub origin skips with a logged reason, keyed on the forge', () => {
  const body = step15Of(SKILL);
  assertForgeKeyedStep15(body);
  assert.throws(() => assertForgeKeyedStep15(`${STEP15}\n\n${SUPERSEDED_FORGE}\n`), { message: /forge skip: missing remote get-url origin/ });
  // Controls that keep every forge anchor and add only the superseded keying.
  assert.throws(() => assertForgeKeyedStep15(`${body}\n${SUPERSEDED_FORGE}\n`), { message: /keyed on local-files/ });
  assert.throws(() => assertForgeKeyedStep15(`${body}\nRead \`work-backend\` first.\n`), { message: /reads work-backend/ });
});

function assertGhFirst(body) {
  const origin = body.indexOf('remote get-url origin');
  const gh = body.indexOf('command -v gh');
  const fence = body.indexOf(`\n${FENCE_LINE}\n`);
  assert.ok(origin !== -1 && gh !== -1 && fence !== -1, 'gh-first: a marker is missing');
  assert.ok(origin < gh, 'gh-first: the forge check must precede command -v gh');
  assert.ok(gh < fence, 'gh-first: command -v gh must precede the check fence');
  const after = body.slice(fence + FENCE_LINE.length + 1);
  assert.ok(after.includes('gh-absent (MCP)'), 'gh-first: the gh-absent (MCP) check is not named after the fence');
  assert.ok(after.includes('never the fence'), 'gh-first: "never the fence" is not said after the fence');
}

test('Step 1.5 detects gh before the bash check', () => {
  const body = step15Of(SKILL);
  assertGhFirst(body);
  // Permutation: the `command -v gh` sentence moved after the fence.
  const sentence = body.match(/[^.\n]*`command -v gh`[^.\n]*\./);
  assert.ok(sentence, 'no `command -v gh` sentence');
  const without = body.replace(sentence[0], '');
  const fenceEnd = without.indexOf('```', without.indexOf(FENCE_LINE));
  const moved = `${without.slice(0, fenceEnd + 3)}\n${sentence[0]}${without.slice(fenceEnd + 3)}`;
  assert.notStrictEqual(moved, body);
  assert.throws(() => assertGhFirst(moved), { message: /command -v gh must precede the check fence/ });
});

// Frozen pre-change excerpts (each a prefix of its pre-change line, or a paragraph run).
const PRE = {
  trainRow: '| `--train` | The unattended path (see `## --train semantics`). Step 4\'s console is never interactive. The two HARD-GATEs — `review: blocking`, or a major bump on the effective version — stage `release-held.md` in the run directory before Step 5 and exit `HELD`; so do Step 5\'s no-merge stops.',
  held: '- **`HELD`** — a HARD-GATE fired at Step 4, **before** Step 5, in **any** mode — `--train`, `auto`, headless, or an interactive run whose gate question was answered `Stop`.',
  everyExit: '**Every exit runs the close-out.** Disposition, the close, then the archival, in that order, run for a **created** directory on every exit after Step 0\'s mint, not only on a run that reaches this step\'s summary: Step 1\'s terminal stops, Step 2\'s nothing-to-release, Step 3\'s stops, a refused `--train` with no human present, and any other stop.',
  trainSection: '## --train semantics\n\n`--train` is how the release train Routine (#2258) invokes this skill on a schedule. It changes three things and nothing else.\n\n**Two HARD-GATEs stop it before Step 5; Step 5\'s no-merge stops end it the same way.** Evaluated after Step 4 renders and before any merge or tag:\n\nEither gate composes `release-held.md` — naming which gate fired, the effective version and its base, and the blocking findings\' staged paths — and stages it.\n',
};

const HELD_REASON = '`release-block — {n} open record(s)`';
const TRAIN_FACTS = [
  ['--train semantics names release-block', (s) => sectionOf(s, '## --train semantics').includes('release-block')],
  ['release-held.md admits the record form', (s) => sectionOf(s, '## --train semantics').includes('`#N {title} {url}`')],
  ['--train Input row names release-block', (s) => lineStartingWith(s, '| `--train` |').includes('release-block')],
  ['HELD bullet names Step 1.5', (s) => lineStartingWith(s, '- **`HELD`**').includes('Step 1.5')],
  ['HELD bullet names the release-block reason', (s) => lineStartingWith(s, '- **`HELD`**').includes(HELD_REASON)],
  ['close-out list names Step 1.5', (s) => lineStartingWith(s, '**Every exit runs the close-out.**').includes('Step 1.5')],
];
const missingTrain = (src) => TRAIN_FACTS.filter(([, ok]) => !ok(src)).map(([fact]) => fact);

test('AC2.1: --train holds on a block with release-held.md', () => {
  assert.deepStrictEqual(missingTrain(SKILL), []);
  const swaps = [
    [lineStartingWith(SKILL, '| `--train` |'), PRE.trainRow, ['--train Input row names release-block']],
    [lineStartingWith(SKILL, '- **`HELD`**'), PRE.held, ['HELD bullet names Step 1.5', 'HELD bullet names the release-block reason']],
    [lineStartingWith(SKILL, '**Every exit runs the close-out.**'), PRE.everyExit, ['close-out list names Step 1.5']],
    [sectionOf(SKILL, '## --train semantics'), PRE.trainSection, ['--train semantics names release-block', 'release-held.md admits the record form']],
  ];
  for (const [livePiece, frozen, facts] of swaps) {
    assert.ok(livePiece, 'live piece not found');
    const doctored = SKILL.replace(livePiece, frozen);
    assert.notStrictEqual(doctored, SKILL);
    assert.deepStrictEqual(missingTrain(doctored), facts, `swapping in the pre-change ${facts[0]} piece`);
  }
});

function assertHeldReason(contract, skill) {
  assert.ok(section(contract, REL).includes(`\`HELD\` in every mode (reason ${HELD_REASON})`), 'contract: exit 1 names no HELD reason');
  assert.ok(lineStartingWith(skill, '- **`HELD`**').includes(`reason ${HELD_REASON}`), 'SKILL.md: the HELD bullet names no release-block reason');
}

test('HELD reason: Step 8 and the contract name the same release-block reason', () => {
  assertHeldReason(text, SKILL);
  const preContract = text.replace(` (reason ${HELD_REASON})`, '');
  assert.notStrictEqual(preContract, text);
  assert.throws(() => assertHeldReason(preContract, SKILL), { message: /contract: exit 1 names no HELD reason/ });
  const preSkill = SKILL.replace(lineStartingWith(SKILL, '- **`HELD`**'), PRE.held);
  assert.throws(() => assertHeldReason(text, preSkill), { message: /SKILL\.md: the HELD bullet names no release-block reason/ });
});

const CONTRACT_AUTO = live('plugin/skills/_shared/auto-mode-contract.md');
const HARD_GATE_ROW = '| HARD-GATE / BLOCKED / STOP conditions |';
const PRE_HARD_GATE = `${HARD_GATE_ROW} … \`/release\` Step 4's two gates (review: blocking, a major bump — release/console.md); \`/test\` Step 0 (PR-bookkeeping precondition check).`;
function assertRegistered(src) {
  const row = lineStartingWith(src, HARD_GATE_ROW);
  assert.ok(row.includes("release/console.md); `/release` Step 1.5's release-block stop ("), 'registry: Step 1.5 stop not right after the Step 4 gates');
  assert.ok(row.includes('no autonomy ceiling lifts it'), 'registry: the ceiling clause is missing');
}

test('HARD-GATE registry: Step 1.5\'s release-block stop is a registered HARD-GATE', () => {
  assertRegistered(CONTRACT_AUTO);
  assert.throws(() => assertRegistered(PRE_HARD_GATE), { message: /registry: Step 1\.5 stop not right after/ });
  const noCeiling = CONTRACT_AUTO.replace('no autonomy ceiling lifts it', 'no ceiling');
  assert.notStrictEqual(noCeiling, CONTRACT_AUTO);
  assert.throws(() => assertRegistered(noCeiling), { message: /registry: the ceiling clause is missing/ });
});

const CEILING = live('plugin/skills/_shared/autonomy-ceiling.md');
const PRE_CEILING = {
  train: '| `train` | … It never does three things at any ceiling, and the three do **not** share one outcome. The two that are evaluated **before** anything is merged or tagged — landing a major bump on the effective version, and proceeding past a `review: blocking` verdict (`--allow-blocking` is not honoured under `--train`) — stage `release-held.md` in the run directory and exit `HELD`: nothing moved, and re-running the train after the gate is addressed is the right recovery. Both are evaluated at Step 4, … The third — a failed publish hook — can only be observed at Step 6',
  routine: '| `train (Routine firing)` | … It never lands a major bump, never proceeds past `review: blocking`, and never treats a failed publish hook as clean: the first two are `HELD` with `release-held.md` in the firing\'s run directory as the only record (no Review Console renders in a firing), the third is `PARTIAL` with Step 6\'s recovery command in the firing\'s report. |',
};
const trainRow = (s) => lineStartingWith(s, '| `train` |');
const routineRow = (s) => lineStartingWith(s, '| `train (Routine firing)` |');
const CEILING_FACTS = [
  ['train row names release-block', (s) => trainRow(s).includes('release-block')],
  ['train row counts four', (s) => trainRow(s).includes('never does four things') && !trainRow(s).includes('three things')],
  ['train row ordinals', (s) => /The three that are evaluated \*\*before\*\*/.test(trainRow(s)) && trainRow(s).includes('The fourth —')
    && !trainRow(s).includes('The two that are evaluated') && !trainRow(s).includes('The third —') && !trainRow(s).includes('Both are evaluated')],
  ['routine row names release-block', (s) => routineRow(s).includes('release-block')],
  ['routine row ordinals', (s) => routineRow(s).includes('the first three are `HELD`') && routineRow(s).includes('the fourth is `PARTIAL`')],
];
const missingCeiling = (src) => CEILING_FACTS.filter(([, ok]) => !ok(src)).map(([fact]) => fact);

test('autonomy ceiling never lifts the block, and its counts stay true', () => {
  assert.deepStrictEqual(missingCeiling(CEILING), []);
  const swapTrain = CEILING.replace(trainRow(CEILING), PRE_CEILING.train);
  assert.deepStrictEqual(missingCeiling(swapTrain), ['train row names release-block', 'train row counts four', 'train row ordinals']);
  const swapRoutine = CEILING.replace(routineRow(CEILING), PRE_CEILING.routine);
  assert.deepStrictEqual(missingCeiling(swapRoutine), ['routine row names release-block', 'routine row ordinals']);
  // Single-claim controls: one stale count or ordinal turns exactly its own fact red.
  for (const [from, to, fact] of [
    ['never does four things', 'never does three things', 'train row counts four'],
    ['The fourth —', 'The third —', 'train row ordinals'],
    ['the fourth is `PARTIAL`', 'the third is `PARTIAL`', 'routine row ordinals'],
  ]) {
    const doctored = CEILING.replace(from, to);
    assert.notStrictEqual(doctored, CEILING, `anchor ${from} not found`);
    assert.deepStrictEqual(missingCeiling(doctored), [fact]);
  }
});

const ROUTINE_YML = live('plugin/skills/release/routine-template.yml');
const PRE_NOTES = 'notes: >\n  The release train (refs #2258): each firing invokes /claude-tweaks:release --train and lets\n  that skill decide — it reads the preflight fact pack, runs the whole-branch review before any\n  bump, and merges release-please\'s PR (pr-first) or runs bin/release-local.js (local-merge)\n';
function assertNotesNameBlock(yml) {
  const notes = parseRoutineTemplate(yml).notes || '';
  assert.match(notes, /open `release-block` record holds a firing `HELD` at Step 1\.5, before any review/, 'notes: no release-block hold');
  assert.match(notes, /nothing-to-release firings included/, 'notes: nothing-to-release firings not covered');
  assert.match(notes, /until a human closes the record or removes the label/, 'notes: no clearing act');
}

test('routine notes name the release block', () => {
  assertNotesNameBlock(ROUTINE_YML);
  const head = ROUTINE_YML.slice(0, ROUTINE_YML.indexOf('notes: >'));
  assert.throws(() => assertNotesNameBlock(head + PRE_NOTES), { message: /notes: no release-block hold/ });
});

const PRE_HELD_ELSEWHERE = {
  bookkeeping: '**Never reached under `HELD`.** A Step 4 HARD-GATE, or one of Step 5\'s stops that merge nothing (`execute.md`: the `gh`-absent Transport stop, delta 5\'s re-render to a major, the reviewed-tip comparison\'s two stops), fires before anything is merged — in any mode, not only under `--train` — so there is no Step 6 or Step 7 to reach.',
  execute: '`HELD` is only ever a **pre-merge** word here — the `gh`-absent Transport stop, delta 5\'s re-rendered-major re-gate and the reviewed-tip comparison\'s two stops (`integration branch kept moving`, a blocking delta review), all of which move nothing — alongside the Step 4 HARD-GATEs that fire before this file runs at all.',
  journey: '- **Should understand:** Five outcome words, never folded: `released`, `dry-run`, `HELD` (a gate stopped the run before the merge — at Step 4, or at one of Step 5\'s no-merge stops such as `integration branch kept moving` — in any mode, not only the train; nothing moved, and `release-held.md` names which gate)',
  resolve: "/claude-tweaks:release's standalone run dir; surfaced by release's own Step 4 console (release/console.md), never by wrap-up's console-resolve.js",
};
const HELD_ELSEWHERE_FACTS = [
  ['bookkeeping', (p) => p.bookkeeping.includes("Step 1.5's release-block stop")],
  ['execute', (p) => p.execute.includes("alongside Step 1.5's release-block stop and the Step 4 HARD-GATEs, which fire before this file runs at all")],
  ['journey', (p) => p.journey.includes("at Step 1.5's release-block check")],
  ['resolve', (p) => p.resolve.includes('Step 8 summary') && p.resolve.includes('a Step 1.5 hold never renders the Step 4 console')],
];
const missingHeldElsewhere = (pieces) => HELD_ELSEWHERE_FACTS.filter(([, ok]) => !ok(pieces)).map(([name]) => name);

test('HELD lists elsewhere name Step 1.5', () => {
  const pieces = {
    bookkeeping: lineStartingWith(live('plugin/skills/release/bookkeeping.md'), '**Never reached under `HELD`.**'),
    execute: lineStartingWith(live('plugin/skills/release/execute.md'), '`HELD` is only ever a **pre-merge** word here'),
    journey: lineStartingWith(live('docs/journeys/release-a-version.md'), '- **Should understand:** Five outcome words'),
    resolve: stagingExemption('release-held') || '',
  };
  assert.deepStrictEqual(missingHeldElsewhere(pieces), []);
  for (const name of Object.keys(PRE_HELD_ELSEWHERE)) {
    assert.deepStrictEqual(missingHeldElsewhere({ ...pieces, [name]: PRE_HELD_ELSEWHERE[name] }), [name], `pre-change ${name}`);
  }
});
