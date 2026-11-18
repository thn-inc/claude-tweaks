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
// Read when Step 1's fact-pack engine is pr-first OR work-backend is github-issues; skipped only
// for local-merge with local-files (final-review ruling F-I2). Never a fresh remote probe.
const SKIP_LINE = 'condition: engine local-merge (Step 1 fact pack) and work-backend local-files →';
const OPENING_RULE = "The release reads the label when `/release` Step 1's fact-pack `engine` is `pr-first` **or** `work-backend` is `github-issues`";
const STEP1_ROUTES = ['`local-merge` with `local-files` → log the `SKIP` line below', '`pr-first`, or `github-issues` under either engine → go on.'];
function assertEngineKeyedSkip(src) {
  const rel = section(src, REL);
  assert.ok(rel.includes(SKIP_LINE), 'skip line must be engine-keyed: local-merge and local-files');
  assert.ok(!src.includes('condition: work-backend'), 'no work-backend condition anywhere');
  const probes = rel.includes('GitHub origin') || src.includes('remote get-url origin') || /forge-detection\.md`? check 1/.test(src);
  assert.ok(!probes, 'no fresh remote probe');
  const opening = src.slice(0, src.indexOf('\n## '));
  assert.ok(opening.includes(OPENING_RULE), 'opening paragraph: not keyed on the engine or the work-backend');
  assert.ok(!opening.includes('under forge detection'), 'opening paragraph: claims the release runs forge detection');
  const step1 = rel.split('\n').find((l) => l.startsWith(ENGINE_STEP)) || '';
  for (const route of STEP1_ROUTES) assert.ok(step1.includes(route), `engine step: missing ${route}`);
}

// The superseded lines, frozen: keyed on work-backend (spec Plan Review Clarifications), then
// on a fresh origin probe (Task 3), each replaced by the engine rule.
const SUPERSEDED_SKIP = 'SKIP … — Step 1.5 release-block check (skipped): condition: work-backend local-files → fallback: no forge label to read; release proceeds. Reversibility: n/a.';
const SUPERSEDED_ORIGIN_SKIP = 'SKIP … — Step 1.5 release-block check (skipped): condition: no GitHub origin (_shared/forge-detection.md check 1) → fallback: no forge label to read; release proceeds. Reversibility: n/a.';
const SUPERSEDED_ORIGIN_STEP = '1. **Forge check.** No GitHub origin → log the `SKIP` line below; the release proceeds.';
const SUPERSEDED_ORIGIN_OPENING = 'It is keyed on the forge, never on `work-backend` — it applies whenever the repository has a GitHub origin (`_shared/forge-detection.md` check 1: `git -C "$RUN_ROOT" remote get-url origin` exits 0), including a GitHub-hosted project with no `## Work records` flag.';
// Then on the engine alone (Task 4 review ruling), replaced by the engine-or-work-backend rule (F-I2).
const SUPERSEDED_ENGINE_SKIP = 'SKIP … — Step 1.5 release-block check (skipped): condition: engine local-merge (Step 1 fact pack) → fallback: no GitHub forge to read; release proceeds. Reversibility: n/a.';
const SUPERSEDED_ENGINE_STEP = '1. **Engine check.** Read `engine` from Step 1\'s fact pack, never re-detected. `local-merge` → log the `SKIP` line below; the release proceeds. `pr-first` → go on.';
const SUPERSEDED_ENGINE_OPENING = 'It is keyed on `/release` Step 1\'s fact-pack `engine`, never on `work-backend` and never on a fresh remote probe: under `pr-first` (GitHub-backed, `_shared/integration-model.md`) the release reads the label, including a project with no `## Work records` flag; under `local-merge` there is no GitHub forge to read, and the release logs a skip. A non-GitHub origin (GitLab, Gitea, a bare remote) resolves `local-merge` under forge detection (`_shared/forge-detection.md`), so it skips rather than failing on a forge `check` cannot read.';

const ENGINE_STEP = '1. **Engine and work-backend check.**';
function assertGhBeforeBash(rel) {
  const engine = rel.indexOf(ENGINE_STEP);
  const detect = rel.indexOf('command -v gh');
  const bash = rel.indexOf('release-block.js" check');
  assert.ok(engine !== -1, 'the engine check is named');
  assert.ok(detect !== -1, 'command -v gh is named');
  assert.ok(bash !== -1, 'the bash check is named');
  assert.ok(engine < detect, 'the engine check must precede command -v gh');
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

test('contract: engine-keyed skip', () => {
  assertEngineKeyedSkip(text);
  const swapped = text.replace(/SKIP …[^\n]*\n?/, `${SUPERSEDED_SKIP}\n`);
  assert.notStrictEqual(swapped, text);
  assert.throws(() => assertEngineKeyedSkip(swapped), { message: /engine-keyed/ });
  assert.throws(() => assertEngineKeyedSkip(`${text}\n${SUPERSEDED_SKIP}\n`), { message: /no work-backend condition/ });
  // The superseded origin-probe forms: the skip line, the procedure step, the opening paragraph.
  const originSkip = text.replace(/SKIP …[^\n]*\n?/, `${SUPERSEDED_ORIGIN_SKIP}\n`);
  assert.notStrictEqual(originSkip, text);
  assert.throws(() => assertEngineKeyedSkip(originSkip), { message: /engine-keyed/ });
  const step1Line = text.split('\n').find((l) => l.startsWith(ENGINE_STEP));
  assert.ok(step1Line, 'no engine and work-backend step');
  const originStep = text.replace(step1Line, SUPERSEDED_ORIGIN_STEP);
  assert.notStrictEqual(originStep, text);
  assert.throws(() => assertEngineKeyedSkip(originStep), { message: /no fresh remote probe/ });
  const openingRun = text.slice(text.indexOf(OPENING_RULE), text.indexOf(' `bin/release-block.js` is the one reader'));
  assert.ok(openingRun.startsWith(OPENING_RULE), 'opening rule not found');
  const originOpening = text.replace(openingRun, SUPERSEDED_ORIGIN_OPENING);
  assert.notStrictEqual(originOpening, text);
  assert.throws(() => assertEngineKeyedSkip(originOpening), { message: /no fresh remote probe/ });
  const unkeyedOpening = text.replace(OPENING_RULE, 'The release reads the label under the engine');
  assert.notStrictEqual(unkeyedOpening, text);
  assert.throws(() => assertEngineKeyedSkip(unkeyedOpening), { message: /opening paragraph: not keyed on the engine or the work-backend/ });
  // The engine-only keying (the pre-F-I2 bytes, frozen): the skip line, the opening, the step.
  const engineSkip = text.replace(/SKIP …[^\n]*\n?/, `${SUPERSEDED_ENGINE_SKIP}\n`);
  assert.notStrictEqual(engineSkip, text);
  assert.throws(() => assertEngineKeyedSkip(engineSkip), { message: /skip line must be engine-keyed: local-merge and local-files/ });
  const engineOpening = text.replace(openingRun, SUPERSEDED_ENGINE_OPENING);
  assert.throws(() => assertEngineKeyedSkip(engineOpening), { message: /opening paragraph: not keyed on the engine or the work-backend/ });
  // The false premise alone (the release never runs forge detection).
  const premise = text.replace(openingRun, `${openingRun} A non-GitHub origin resolves \`local-merge\` under forge detection.`);
  assert.throws(() => assertEngineKeyedSkip(premise), { message: /claims the release runs forge detection/ });
  const engineStep = text.replace(step1Line, SUPERSEDED_ENGINE_STEP.replace('1. **Engine check.**', ENGINE_STEP));
  assert.throws(() => assertEngineKeyedSkip(engineStep), { message: /engine step: missing `local-merge` with `local-files`/ });
});

// Minor 10: the `gh` detection picks the transport; Step 0's no-`gh`-probe rule is about the engine.
test('contract: the gh detection is for the transport, not the engine', () => {
  const rel = section(text, REL);
  const sentence = 'This picks the transport, never the engine: `/release` Step 0\'s "do not ask whether `gh` is installed" is about the engine.';
  assert.ok(rel.includes(sentence));
  assert.ok(!section(text.replace(` ${sentence}`, ''), REL).includes('picks the transport'), 'control: the sentence removed');
});

test('contract: gh detected before the bash check', () => {
  const rel = section(text, REL);
  assertGhBeforeBash(rel);
  assert.match(rel, /gh absent[\s\S]{0,200}## gh-absent \(MCP\) path/);
  assert.match(rel, /no new exit code/);
  assert.match(rel, /unavailable[\s\S]{0,60}exit 3/);
  // Control: the same text with the two markers swapped must fail the order check.
  const swapped = rel.replace('command -v gh', '@@').replace('release-block.js" check', 'command -v gh').replace('@@', 'release-block.js" check');
  assert.throws(() => assertGhBeforeBash(swapped), { message: /command -v gh must precede/ });
  // Control: the engine check moved below the gh detection.
  const engineLine = rel.split('\n').find((l) => l.startsWith(ENGINE_STEP));
  const engineLast = `${rel.replace(`${engineLine}\n`, '')}\n${engineLine}\n`;
  assert.notStrictEqual(engineLast.replace(/\n+$/, ''), rel.replace(/\n+$/, ''));
  assert.throws(() => assertGhBeforeBash(engineLast), { message: /the engine check must precede/ });
});

// An exit outside 0–3, or an exit 1 without the blocked JSON (a Node crash exits 1), fails closed.
const UNMAPPED_RE = /^- \*\*Any other exit, or exit 1 whose stdout is not the `\{"blocked":true,…\}` line\*\*[^\n]*→ treat it as exit 3: `failed`, `release-block state unreadable`, never `HELD`/m;
function assertUnmappedFailsClosed(rel) {
  assert.match(rel, UNMAPPED_RE, 'routing: an unmapped exit or a bare exit 1 is not treated as unreadable');
}

test('contract: an unmapped exit or an exit 1 without the blocked JSON reads as unreadable', () => {
  const rel = section(text, REL);
  assertUnmappedFailsClosed(rel);
  const dropped = rel.replace(UNMAPPED_RE, '');
  assert.notStrictEqual(dropped, rel);
  assert.throws(() => assertUnmappedFailsClosed(dropped), { message: /routing: an unmapped exit/ });
  const asHeld = rel.replace('treat it as exit 3: `failed`, `release-block state unreadable`', 'treat it as exit 1: `HELD`');
  assert.notStrictEqual(asHeld, rel);
  assert.throws(() => assertUnmappedFailsClosed(asHeld), { message: /routing: an unmapped exit/ });
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

const RANGE_RE = /followed by `:` and one or more digits, optionally a range: `-` and one or more digits \(`([^`]+)`\)/;
function assertFindingGrammar(src) {
  const cli = section(src, '## The CLI');
  assert.match(cli, /file part that starts with a non-whitespace character, followed by `:` and one or more digits/, 'location rule');
  assert.match(cli, /file part may contain spaces and colons/, 'location rule: spaces and colons');
  assert.match(cli, RANGE_RE, 'location rule: a line range');
}
// Frozen: the grammar sentence before a range was a location (final-review Minor 7).
const PRE_RANGE_GRAMMAR = 'followed by `:` and one or more digits (the file part may contain spaces and colons).';

test('contract: finding grammar matches isValidFinding', () => {
  assertFindingGrammar(text);
  const loose = text.replace('starts with a non-whitespace character', 'ends');
  assert.notStrictEqual(loose, text);
  assert.throws(() => assertFindingGrammar(loose), { message: /location rule/ });
  const preRange = text.replace(/followed by `:` and one or more digits, optionally a range:[^\n]*colons\./, PRE_RANGE_GRAMMAR);
  assert.notStrictEqual(preRange, text);
  assert.throws(() => assertFindingGrammar(preRange), { message: /location rule: a line range/ });
  // The doc's rule agrees with the CLI on the cases the reviews named, and on the doc's own range example.
  const { isValidFinding } = require('../plugin/bin/release-block');
  assert.strictEqual(isValidFinding('x at  a:5'), false);
  assert.strictEqual(isValidFinding('x at :5'), false);
  assert.strictEqual(isValidFinding('x at C:/a b.js:5'), true);
  const example = section(text, '## The CLI').match(RANGE_RE)[1];
  assert.strictEqual(isValidFinding(`x at ${example}`), true, `the doc's range example ${example}`);
  assert.strictEqual(isValidFinding(`x at ${example.replace(/\d+$/, '')}`), false, 'a range with no end line');
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
  [/ahead of Step 3's tree check and any early-verify step inserted after Step 1/, 'precedes the tree check and any early verify'],
  [/^node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/release-block\.js" check$/m, 'the check fence line'],
  [/never on the prose/, 'routes on the exit code only'],
  [/\*\*0\*\* → log `AUTO[^`\n]*`, then Step 2/, 'exit 0 logs and goes on to Step 2'],
  [/\*\*1\*\* with its `"blocked":true` line → stop `HELD`/, 'exit 1 with the blocked JSON stops HELD'],
  [/\*\*2\*\*, \*\*3\*\* or anything else → stop `failed`, `release-block state unreadable`/, 'exit 2, 3 or anything else stops failed, unreadable'],
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

// The Step 2/3 routing clause, read exactly: it must stop `failed`, never route on.
const UNREADABLE_ROUTE_RE = /\*\*2\*\*, \*\*3\*\* or anything else → ([^;\n]*?)\. On /;
function assertUnreadableFails(body) {
  const m = body.match(UNREADABLE_ROUTE_RE);
  assert.ok(m, 'unreadable route: no **2**, **3** or anything else clause');
  assert.strictEqual(m[1], 'stop `failed`, `release-block state unreadable`', 'unreadable route: not exactly stop failed');
}

test('AC4.2: an unreadable state stops the release and never proceeds', () => {
  const body = step15Of(SKILL);
  assertUnreadableFails(body);
  const proceeds = body.replace('anything else → stop `failed`, `release-block state unreadable`.', 'anything else → log it, then Step 2.');
  assert.notStrictEqual(proceeds, body);
  assert.throws(() => assertUnreadableFails(proceeds), { message: /unreadable route: not exactly stop failed/ });
  // The frozen pre-fix map (Task 4 first pass) stated only 2 or 3, so an unmapped exit was unrouted.
  const preFix = body.replace(/\*\*1\*\* with its[^\n]*/, '**1** → stop `HELD`; **2** or **3** → stop `failed`, `release-block state unreadable`. On the `SKIP` or any exit but 0, read it now.');
  assert.notStrictEqual(preFix, body);
  assert.throws(() => assertUnreadableFails(preFix), { message: /unreadable route: no \*\*2\*\*, \*\*3\*\* or anything else clause/ });
});

// The superseded keyings, frozen: the plan draft's work-backend sentence (spec Plan Review
// Clarifications), and the Task 4 first pass's fresh origin probe (review ruling: key on the engine).
const SUPERSEDED_FORGE = 'Read `work-backend` as `console.md`\'s Inputs does. `local-files` → log the `SKIP` line';
const SUPERSEDED_ORIGIN_P2 = 'Key it on the forge, never `work-backend`: when `git -C "$RUN_ROOT" remote get-url origin` fails (`_shared/forge-detection.md` check 1: no GitHub origin), log the `SKIP` line and go on to Step 2. Otherwise detect `gh` first: `command -v gh` (`_shared/github-write-transport.md`\'s Detection). Present:';
// Then the engine alone (Task 4 review ruling), replaced by local-merge-and-local-files (F-I2).
const SUPERSEDED_ENGINE_P2 = "Key it on Step 1's pack `engine`, never a fresh probe: `local-merge` → log the `SKIP` line and go on to Step 2. `pr-first` → detect `gh` first with `command -v gh`. Present:";
const ENGINE_KEY = "Step 1's `engine` `local-merge` and `work-backend` `local-files` → log the `SKIP` line";

function assertEngineKeyedStep15(body) {
  for (const lit of [ENGINE_KEY, 'never a fresh probe', 'Else detect `gh` first']) {
    assert.ok(body.includes(lit), `engine skip: missing ${lit}`);
  }
  assert.ok(!body.includes('remote get-url origin') && !body.includes('forge-detection'), 'engine skip: probes the remote');
  assert.ok(!body.replace(ENGINE_KEY, '').includes('→ log the `SKIP` line'), 'engine skip: a second skip route');
}

test('AC3.1: local-merge with local-files skips with a logged reason, keyed on Step 1\'s engine and the work-backend', () => {
  const body = step15Of(SKILL);
  assertEngineKeyedStep15(body);
  const p2 = body.split('\n').find((l) => l.startsWith(ENGINE_KEY));
  assert.ok(p2, 'no engine paragraph');
  const swapped = body.replace(p2, SUPERSEDED_ORIGIN_P2);
  assert.throws(() => assertEngineKeyedStep15(swapped), { message: /engine skip: missing Step 1's `engine` `local-merge`/ });
  assert.throws(() => assertEngineKeyedStep15(`${STEP15}\n\n${SUPERSEDED_FORGE}\n`), { message: /engine skip: missing/ });
  const engineOnly = body.replace(p2, SUPERSEDED_ENGINE_P2);
  assert.throws(() => assertEngineKeyedStep15(engineOnly), { message: /engine skip: missing Step 1's `engine` `local-merge`/ });
  // Controls that keep every anchor and add only a superseded keying.
  assert.throws(() => assertEngineKeyedStep15(`${body}\n${SUPERSEDED_ORIGIN_P2}\n`), { message: /probes the remote/ });
  assert.throws(() => assertEngineKeyedStep15(`${body}\n${SUPERSEDED_FORGE}\n`), { message: /a second skip route/ });
  assert.throws(() => assertEngineKeyedStep15(`${body}\n${SUPERSEDED_ENGINE_P2}\n`), { message: /a second skip route/ });
});

function assertGhFirst(body) {
  const engine = body.indexOf(ENGINE_KEY);
  const gh = body.indexOf('command -v gh');
  const fence = body.indexOf(`\n${FENCE_LINE}\n`);
  assert.ok(engine !== -1 && gh !== -1 && fence !== -1, 'gh-first: a marker is missing');
  assert.ok(engine < gh, 'gh-first: the engine check must precede command -v gh');
  assert.ok(gh < fence, 'gh-first: command -v gh must precede the check fence');
  const after = body.slice(fence + FENCE_LINE.length + 1);
  assert.ok(after.includes('gh-absent (MCP)'), 'gh-first: the gh-absent (MCP) check is not named after the fence');
  assert.ok(after.includes('never the fence'), 'gh-first: "never the fence" is not said after the fence');
  const absent = after.split('\n').find((l) => l.startsWith('Absent:'));
  assert.ok(absent && absent.includes('`_shared/release-block.md`'), 'gh-absent: the Absent line does not name _shared/release-block.md');
}

// Moves one sentence of the body to just after the check fence.
function moveAfterFence(body, sentence) {
  const without = body.replace(sentence, '');
  const fenceEnd = without.indexOf('```', without.indexOf(FENCE_LINE));
  return `${without.slice(0, fenceEnd + 3)}\n${sentence}${without.slice(fenceEnd + 3)}`;
}

test('Step 1.5 detects gh before the bash check', () => {
  const body = step15Of(SKILL);
  assertGhFirst(body);
  // Go-red: the frozen "the contract's" wording (file name dropped from the Absent line).
  const nameless = body.replace("Absent: `_shared/release-block.md`'s gh-absent", "Absent: the contract's gh-absent");
  assert.notStrictEqual(nameless, body);
  assert.throws(() => assertGhFirst(nameless), { message: /the Absent line does not name _shared\/release-block\.md/ });
  // Permutation: the `command -v gh` sentence moved after the fence.
  const sentence = body.match(/[^.\n]*`command -v gh`[^.\n]*\./);
  assert.ok(sentence, 'no `command -v gh` sentence');
  const moved = moveAfterFence(body, sentence[0]);
  assert.notStrictEqual(moved, body);
  assert.throws(() => assertGhFirst(moved), { message: /command -v gh must precede the check fence/ });
  // Permutation: the engine sentence moved after the gh detection.
  const engineSentence = body.match(/Step 1's `engine` `local-merge`[^\n]*?never a fresh probe \([^)\n]*\)\./);
  assert.ok(engineSentence, 'no engine sentence');
  const engineMoved = moveAfterFence(body, engineSentence[0]);
  assert.notStrictEqual(engineMoved, body);
  assert.throws(() => assertGhFirst(engineMoved), { message: /the engine check must precede command -v gh/ });
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

// Frozen pre-change prefixes of the `--dry-run` row and the `failed` bullet.
const PRE_OUTCOME = {
  dryRun: '| `--dry-run` | Step 5 is a no-op — nothing is merged, nothing is tagged, no `Release-As:` commit is pushed. Step 3\'s whole-branch review **still runs**',
  failed: '- **`failed`** — nothing landed and no HARD-GATE fired: either the run stopped before the console for a reason that is not a gate (a refused `--train` with no human present at Step 0; Step 3\'s review-tree assertion;',
};
// The round-1 fix's wording (Task 4 re-review): the unreadable stop sat inside the "not a gate"
// list, the HELD exclusion said "no gate fired", and the dry-run summary sentence was unqualified.
const ROUND1 = {
  failedPreamble: "nothing landed and no HARD-GATE fired: either the run stopped before the console for a reason that is not a gate (a refused `--train` with no human present at Step 0; Step 1.5's `release-block state unreadable`, the gate failing closed with no block observed; Step 3's",
  failedHeld: 'Never reported as `HELD` (no gate fired)',
  dryRunSummary: "Step 8's summary reads `dry-run`. |",
};
// Round 2 (Task 5 re-review): the same pieces named only Step 1.5, though Step 4's re-read reaches both outcomes.
const ROUND2 = {
  dryRunSummary: "Step 8's summary reads `dry-run` (`HELD` when Step 1.5 holds it). |",
  heldToo: "Step 1.5's release-block stop is `HELD` too,",
};
// Round 3 (final review, Minor 4): the singular verb.
const ROUND3 = {
  heldToo: "Step 1.5's and Step 4's release-block stop is `HELD` too,",
};
const LIVE_OUTCOME = {
  failedPreamble: "nothing landed and no HARD-GATE fired, or Step 1.5's/Step 4's registered one failed closed (`release-block state unreadable`): either the run stopped before the console for a reason that is not a gate (a refused `--train` with no human present at Step 0; Step 3's",
  failedHeld: 'Never reported as `HELD` (no gate saw a block)',
  dryRunSummary: "Step 8's summary reads `dry-run` (`HELD` on a release block). |",
  heldToo: "Step 1.5's and Step 4's release-block stops are `HELD` too,",
};
const dryRunRow = (s) => lineStartingWith(s, '| `--dry-run` |');
const failedBullet = (s) => lineStartingWith(s, '- **`failed`**');
const heldBullet = (s) => lineStartingWith(s, '- **`HELD`**');
const notAGateList = (s) => {
  const b = failedBullet(s);
  const at = b.indexOf('for a reason that is not a gate (');
  return at === -1 ? '' : b.slice(at, b.indexOf(')', at));
};
const OUTCOME_FACTS = [
  ['--dry-run review sentence names the Step 1.5 hold', (s) => dryRunRow(s).includes("Unless Step 1.5 holds it `HELD`, Step 3's whole-branch review **still runs**")],
  ['--dry-run summary sentence names a release-block hold', (s) => dryRunRow(s).includes(LIVE_OUTCOME.dryRunSummary)],
  ['failed preamble names the gate failing closed', (s) => failedBullet(s).includes("no HARD-GATE fired, or Step 1.5's/Step 4's registered one failed closed (`release-block state unreadable`): either")],
  ['the HELD sweep covers Step 4\'s re-read', (s) => heldBullet(s).includes(LIVE_OUTCOME.heldToo)],
  ['the not-a-gate list excludes the release block', (s) => notAGateList(s) !== '' && !notAGateList(s).includes('release-block')],
  ['the HELD exclusion covers a gate that saw no block', (s) => failedBullet(s).includes(LIVE_OUTCOME.failedHeld) && !failedBullet(s).includes('(no gate fired)')],
];
const missingOutcome = (src) => OUTCOME_FACTS.filter(([, ok]) => !ok(src)).map(([fact]) => fact);

test('a dry run is held by a block, and an unreadable state is the gate failing closed', () => {
  assert.deepStrictEqual(missingOutcome(SKILL), []);
  const swaps = [
    [dryRunRow(SKILL), PRE_OUTCOME.dryRun, ['--dry-run review sentence names the Step 1.5 hold', '--dry-run summary sentence names a release-block hold']],
    [failedBullet(SKILL), PRE_OUTCOME.failed, ['failed preamble names the gate failing closed', 'the HELD exclusion covers a gate that saw no block']],
    // Round-1 wording, one piece at a time.
    [LIVE_OUTCOME.failedPreamble, ROUND1.failedPreamble, ['failed preamble names the gate failing closed', 'the not-a-gate list excludes the release block']],
    [LIVE_OUTCOME.failedHeld, ROUND1.failedHeld, ['the HELD exclusion covers a gate that saw no block']],
    [LIVE_OUTCOME.dryRunSummary, ROUND1.dryRunSummary, ['--dry-run summary sentence names a release-block hold']],
    // Round-2 wording (Step 1.5 only), one piece at a time.
    ["Step 1.5's/Step 4's registered one failed closed", "Step 1.5's registered one failed closed", ['failed preamble names the gate failing closed']],
    [LIVE_OUTCOME.dryRunSummary, ROUND2.dryRunSummary, ['--dry-run summary sentence names a release-block hold']],
    [LIVE_OUTCOME.heldToo, ROUND2.heldToo, ["the HELD sweep covers Step 4's re-read"]],
    // Round-3 wording (the singular verb).
    [LIVE_OUTCOME.heldToo, ROUND3.heldToo, ["the HELD sweep covers Step 4's re-read"]],
  ];
  for (const [livePiece, frozen, facts] of swaps) {
    assert.ok(livePiece && SKILL.includes(livePiece), 'live piece not found');
    const doctored = SKILL.replace(livePiece, frozen);
    assert.notStrictEqual(doctored, SKILL);
    assert.deepStrictEqual(missingOutcome(doctored), facts);
  }
  // Anchored to the HELD bullet: the same sentence elsewhere in the file does not satisfy it.
  const elsewhere = `${SKILL.replace(` ${LIVE_OUTCOME.heldToo}`, ' ')}\n${LIVE_OUTCOME.heldToo}\n`;
  assert.ok(elsewhere.includes(LIVE_OUTCOME.heldToo) && !heldBullet(elsewhere).includes(LIVE_OUTCOME.heldToo), 'the sentence moved out of the bullet');
  assert.deepStrictEqual(missingOutcome(elsewhere), ["the HELD sweep covers Step 4's re-read"]);
});

// Minors 3 and 5 (final review): Step 8's failed error line has a slot for the release-block stop
// line, and a Step 1.5 hold says its records were never computed.
const STEP8_TEMPLATE_FAILED = "{the engine's or forge's own error line, or the stopping step's line, when the outcome is failed}";
const FAILED_ERROR_LINE = "the error line is the engine's or forge's own, quoted verbatim, or the stopping step's line.";
const CONTRACT_FAILED_LINE = '`release: stopped — release-block state unreadable (exit {code}: {first stderr line})`, which Step 8 quotes verbatim as its `failed` error line';
const CONTRACT_RECORDS = "A Step 1.5 hold runs before Step 4 builds the shipped set, so Step 8's line reads `records: not computed (held at Step 1.5)`; a Step 4 hold keeps `records: {n} would ship`.";
const PRE_SLOT = {
  template: "{the engine's or forge's own error line, or the Step 3 stop reason, when the outcome is failed}",
  failed: "the error line is the engine's or forge's own, quoted verbatim, or the Step 3 stop reason.",
};
function missingStopSlots(skill, contract) {
  const rel = section(contract, REL);
  return [
    ['template slot', skill.includes(STEP8_TEMPLATE_FAILED) && !skill.includes(PRE_SLOT.template)],
    ['failed bullet slot', failedBullet(skill).includes(FAILED_ERROR_LINE)],
    ['contract names the error line', rel.includes(CONTRACT_FAILED_LINE)],
    ['contract records line', rel.includes(CONTRACT_RECORDS)],
  ].filter(([, ok]) => !ok).map(([name]) => name);
}

test('Step 8 slots the release-block stop line, and a Step 1.5 hold computes no records', () => {
  assert.deepStrictEqual(missingStopSlots(SKILL, text), []);
  assert.deepStrictEqual(missingStopSlots(SKILL.replace(STEP8_TEMPLATE_FAILED, PRE_SLOT.template), text), ['template slot']);
  assert.deepStrictEqual(missingStopSlots(SKILL.replace(FAILED_ERROR_LINE, PRE_SLOT.failed), text), ['failed bullet slot']);
  assert.deepStrictEqual(missingStopSlots(SKILL, text.replace(', which Step 8 quotes verbatim as its `failed` error line', '')), ['contract names the error line']);
  assert.deepStrictEqual(missingStopSlots(SKILL, text.replace(` ${CONTRACT_RECORDS}`, '')), ['contract records line']);
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
  journeyFeel: '- **Should feel:** Trustworthy to leave alone — the two things it will never do on its own (ship a major, ship past a blocking review) are exactly the two a human would want to see.',
  journeyAction: '- **Action:** Refused unless `release-train: true` and `autonomy: unattended` — with a human present the refusal falls back to an on-demand run, in a headless firing it stops before Step 1 as `failed` with nothing moved; when accepted, Steps 1–4 run without a console prompt,',
};
const HELD_ELSEWHERE_FACTS = [
  ['bookkeeping', (p) => p.bookkeeping.includes("Step 1.5's release-block stop")],
  ['execute', (p) => p.execute.includes("alongside Step 1.5's release-block stop and the Step 4 HARD-GATEs, which fire before this file runs at all")],
  ['journey', (p) => p.journey.includes("at Step 1.5's release-block check")],
  ['resolve', (p) => p.resolve.includes('Step 8 summary') && p.resolve.includes('a Step 1.5 hold never renders the Step 4 console')],
  ['journeyFeel', (p) => p.journeyFeel.includes('the three things it will never do on its own (ship past an open release block,') && !p.journeyFeel.includes('the two things')],
  ['journeyAction', (p) => p.journeyAction.includes('when accepted, an open `release-block` record holds it `HELD` at Step 1.5, before any review')],
];
const missingHeldElsewhere = (pieces) => HELD_ELSEWHERE_FACTS.filter(([, ok]) => !ok(pieces)).map(([name]) => name);

test('HELD lists elsewhere name Step 1.5', () => {
  const pieces = {
    bookkeeping: lineStartingWith(live('plugin/skills/release/bookkeeping.md'), '**Never reached under `HELD`.**'),
    execute: lineStartingWith(live('plugin/skills/release/execute.md'), '`HELD` is only ever a **pre-merge** word here'),
    journey: lineStartingWith(live('docs/journeys/release-a-version.md'), '- **Should understand:** Five outcome words'),
    resolve: stagingExemption('release-held') || '',
    journeyFeel: lineStartingWith(live('docs/journeys/release-a-version.md'), '- **Should feel:** Trustworthy to leave alone'),
    journeyAction: lineStartingWith(live('docs/journeys/release-a-version.md'), '- **Action:** Refused unless `release-train: true`'),
  };
  assert.deepStrictEqual(missingHeldElsewhere(pieces), []);
  for (const name of Object.keys(PRE_HELD_ELSEWHERE)) {
    assert.deepStrictEqual(missingHeldElsewhere({ ...pieces, [name]: PRE_HELD_ELSEWHERE[name] }), [name], `pre-change ${name}`);
  }
});

// ---- Task 5: Step 4's console row and re-read, and Step 8's disposition stamp ----------------
const CONSOLE = live('plugin/skills/release/console.md');
const DISPOSITION = live('plugin/skills/release/disposition.md');
const BASH_CHECK = 'release-block.js" check';
const SKIP_VALUE = '`n/a (local-merge, local-files)`';

function releaseBlockRowOf(src) {
  const lines = src.split('\n');
  const idx = lines.findIndex((l) => l.startsWith('| Release block |'));
  return { idx, row: idx === -1 ? '' : lines[idx], review: lines.findIndex((l) => l.startsWith('| Review |')), ci: lines.findIndex((l) => l.startsWith('| CI on tip |')) };
}
function assertConsoleRow(src) {
  const { idx, row, review, ci } = releaseBlockRowOf(src);
  assert.ok(idx !== -1, 'console row: no | Release block | row');
  for (const v of ['`none`', '`blocked — #N {title}`', 'one line per record', '`unreadable — {first stderr line}`', SKIP_VALUE]) {
    assert.ok(row.includes(v), `console row: missing ${v}`);
  }
  assert.ok(!row.includes('no GitHub origin'), 'console row: keyed on a remote probe');
  assert.ok(review < idx && idx < ci, 'console row: must sit after | Review | and before | CI on tip |');
}
// The superseded wording, frozen: Task 5's first plan keyed the fourth value on the forge, then
// on work-backend alone, then on the engine alone (replaced by local-merge-and-local-files, F-I2).
const SUPERSEDED_ROW_VALUE = '`n/a (no GitHub origin)`';
const SUPERSEDED_ROW_BACKEND = '`n/a (work-backend local-files)`';
const SUPERSEDED_ROW_ENGINE = '`n/a (local-merge)`';

test('AC8.1: Step 4\'s console renders the release-block state', () => {
  assertConsoleRow(CONSOLE);
  const { row } = releaseBlockRowOf(CONSOLE);
  assert.throws(() => assertConsoleRow(CONSOLE.replace(`${row}\n`, '')), { message: /no \| Release block \| row/ });
  for (const frozen of [SUPERSEDED_ROW_VALUE, SUPERSEDED_ROW_BACKEND, SUPERSEDED_ROW_ENGINE]) {
    const doctored = CONSOLE.replace(row, row.replace(SKIP_VALUE, frozen));
    assert.notStrictEqual(doctored, CONSOLE);
    assert.throws(() => assertConsoleRow(doctored), { message: /missing `n\/a \(local-merge, local-files\)`/ });
  }
  const moved = CONSOLE.replace(`${row}\n`, '').replace('| Review |', `${row}\n| Review |`);
  assert.throws(() => assertConsoleRow(moved), { message: /after \| Review \|/ });
});

const inputsOf = (src) => sectionOf(src, '## Inputs');
const gatesOf = (src) => sectionOf(src, '## Gates');
const inputsBullet = (src) => lineStartingWith(inputsOf(src), '- The release-block state');

const rereadParagraph = (src) => lineStartingWith(gatesOf(src), '**The release block, re-read.**');
function assertReread(src) {
  const gates = gatesOf(src);
  const p = rereadParagraph(src);
  assert.ok(p, 'Gates: no re-read paragraph');
  for (const lit of ['`HELD`', '`release-held.md`', 'release-block state unreadable', 'no question', 'Stopped before Step 5.', 'a `--dry-run` changes neither', '`HELD` there too', 'any other exit']) {
    assert.ok(p.toLowerCase().includes(lit.toLowerCase()), `re-read paragraph: missing ${lit}`);
  }
  assert.ok(gates.indexOf('**The release block, re-read.**') < gates.indexOf('**`HELD` is mode-independent.**'), 'the re-read paragraph sits with the gates');
}
// Frozen: the Gates section as Task 5's first commit left it (the literals HELD, release-held.md pre-exist elsewhere in it).
const PRE_REREAD_TAIL = 'stops it `failed`, with reason `release-block state unreadable`.';

test('Step 4 re-reads the block before Step 5', () => {
  assert.ok(inputsOf(CONSOLE).includes(BASH_CHECK), 'Inputs: names no bash check');
  assertReread(CONSOLE);
  const p = rereadParagraph(CONSOLE);
  assert.throws(() => assertReread(CONSOLE.replace(p, '')), { message: /no re-read paragraph/ });
  assert.throws(() => assertReread(CONSOLE.replace(p, p.slice(0, p.indexOf(PRE_REREAD_TAIL) + PRE_REREAD_TAIL.length))), { message: /dry-run/ });
});

function assertEngineThenGh(bullet) {
  const engine = bullet.indexOf("the pack's `engine`");
  const gh = bullet.indexOf('command -v gh');
  const bash = bullet.indexOf(BASH_CHECK);
  assert.ok(engine !== -1 && gh !== -1 && bash !== -1, 'Inputs bullet: a marker is missing');
  assert.ok(engine < gh && gh < bash, 'Inputs bullet: engine, command -v gh, bash check must increase');
  assert.ok(/MCP `check`/.test(bullet), 'Inputs bullet: names no MCP check');
  assert.ok(!bullet.includes('no GitHub origin') && !bullet.includes('remote get-url'), 'Inputs bullet: a remote probe');
  for (const lit of ["the pack's `engine` and the `work-backend` bullet above first", `\`local-merge\` with \`local-files\` → ${SKIP_VALUE}`, '`pr-first`, or `github-issues` under either engine, reads the label']) {
    assert.ok(bullet.includes(lit), `Inputs bullet: missing ${lit}`);
  }
}
// Frozen: the engine-only bullet (replaced by local-merge-and-local-files, F-I2).
const SUPERSEDED_ENGINE_BULLET = '- The release-block state — re-run `release-block.js check` here, just before rendering, in Step 1.5\'s order (`_shared/release-block.md`): read the pack\'s `engine` first (`local-merge` → `n/a (local-merge)`), then `command -v gh`, then, with gh present, the bash `node "${CLAUDE_PLUGIN_ROOT}/bin/release-block.js" check`; gh absent, the MCP `check`. It is keyed on the pack\'s `engine`, never on the `work-backend` bullet beside it and never on a fresh remote probe.';

test('Step 4\'s re-read detects gh before the bash check', () => {
  const bullet = inputsBullet(CONSOLE);
  assert.ok(bullet, 'no Inputs bullet');
  assertEngineThenGh(bullet);
  const moved = `${bullet.replace('then `command -v gh`, ', '')} then \`command -v gh\``;
  assert.throws(() => assertEngineThenGh(moved), { message: /must increase/ });
  assert.throws(() => assertEngineThenGh(`${bullet} no GitHub origin`), { message: /remote probe/ });
  assert.throws(() => assertEngineThenGh(SUPERSEDED_ENGINE_BULLET), { message: /Inputs bullet: missing the pack's `engine` and the `work-backend` bullet/ });
});

const stampParagraph = (src) => lineStartingWith(src, '**Stamp the release block.**');
const SUPERSEDED_STAMP = 'Medium and low findings are never stamped. Neither is a `declined (covered by #{n})` row, because nothing was filed.';
function assertStampParagraph(src) {
  const p = stampParagraph(src);
  assert.ok(p, 'no Stamp the release block paragraph');
  for (const lit of ['release-block.js" stamp --record', '`critical`', '`high`', '{category} at {file:line}', '{category} at general', '`declined (covered by #{n})`', 'the covering record', 'Medium and low findings are never stamped, including when declined as covered', 'Stamping runs whenever `work-backend` is `github-issues`', 'under either engine', 'Under `local-files` nothing is stamped', 'Step 8 disposition stamp (skipped): condition: work-backend local-files — record numbers are local, not GitHub issues →', 'critical at {file:line}']) {
    assert.ok(p.includes(lit), `stamp paragraph: missing ${lit}`);
  }
  assert.ok(!p.includes('never keyed on `work-backend`'), 'stamp paragraph: engine-only keying');
  assert.ok(!p.includes('`pr-first` **and**') && !p.includes('engine local-merge'), 'stamp paragraph: gated on the engine');
  assert.ok(!p.includes('Neither is a') && !p.includes('because nothing was filed'), 'stamp paragraph: superseded sentence');
  assert.ok(!p.includes('GitHub origin') && !p.includes('forge'), 'stamp paragraph: keyed on the forge');
}

test('AC5.1: Step 8 stamps a filed critical or high finding', () => {
  assertStampParagraph(DISPOSITION);
  const p = stampParagraph(DISPOSITION);
  assert.throws(() => assertStampParagraph(DISPOSITION.replace(p, p.replace('{category} at general', 'x'))), { message: /missing \{category\} at general/ });
});

// Frozen: the shell-interpolated stamp command the review found (#5882 review, lens 3b): review-derived
// `{category}` and `{file:line}` inside a double-quoted `--finding "…"`, which a shell expands.
const SUPERSEDED_STAMP_COMMAND = '`node "${CLAUDE_PLUGIN_ROOT}/bin/release-block.js" stamp --record {n} --finding "{category} at {file:line}"`';
const assertStampShellSafe = (p) => {
  assert.ok(p.includes('--finding-file "{that path}"'), 'stamp paragraph: the finding is not passed as a file');
  assert.ok(p.includes('session-tmp-resolve.js" --value release-block-finding.txt'), 'stamp paragraph: no session-tmp path for the finding file');
  assert.ok(!p.includes('--finding "{category}'), 'stamp paragraph: review-derived text interpolated into a shell argument');
};

test('Step 8 passes the finding to stamp as a file, never interpolated into the shell command', () => {
  const p = stampParagraph(DISPOSITION);
  assertStampShellSafe(p);
  const start = p.indexOf('`Write` the finding as one line');
  const end = p.indexOf('`{category}` and `{file:line}` come from');
  assert.ok(start > 0 && end > start, 'stamp paragraph: the finding-file sentences moved');
  const frozen = `${p.slice(0, start)}${SUPERSEDED_STAMP_COMMAND}. ${p.slice(end)}`;
  assert.throws(() => assertStampShellSafe(frozen), { message: /not passed as a file|interpolated/ });
});

test('AC5.1: Step 8 stamps the covering record of a critical or high finding declined as covered', () => {
  const p = stampParagraph(DISPOSITION);
  assert.ok(p.includes('resolved `declined (covered by #{n})` stamps the covering record'));
  const frozen = p.replace('Medium and low findings are never stamped, including when declined as covered.', SUPERSEDED_STAMP);
  assert.notStrictEqual(frozen, p);
  assert.throws(() => assertStampParagraph(DISPOSITION.replace(p, frozen)), { message: /superseded sentence|never stamped, including/ });
});

// Frozen: the engine-only keying Task 5's first commit shipped (controller ruling: local-files record numbers are not GitHub issues).
const SUPERSEDED_ENGINE_ONLY = "Stamping follows Step 1's `engine` (`_shared/release-block.md`): under `pr-first` it runs, with the gh-absent path that file's MCP `stamp`; under `local-merge` nothing is stamped, never keyed on `work-backend`.";
// Frozen: then pr-first AND github-issues (Task 5 fix), replaced by github-issues under either engine (F-I2).
const SUPERSEDED_ENGINE_AND_BACKEND = "Stamping runs only when Step 1's `engine` is `pr-first` **and** `work-backend` is `github-issues` (read as `console.md`'s Inputs reads it), for the filed row and the covering record alike, with the gh-absent path that file's MCP `stamp` (`_shared/release-block.md`): a `local-files` record number is local, not a GitHub issue, and `stamp` would label an unrelated one. Under `local-merge` or `local-files` nothing is stamped, and one line says why: `SKIP {HH:MM:SS} — Step 8 disposition stamp (skipped): condition: {work-backend local-files — record numbers are local, not GitHub issues | engine local-merge} → fallback: no stamp; label a GitHub issue by hand if needed. Reversibility: n/a.`";
const BACKEND_START = 'Stamping runs whenever `work-backend` is `github-issues`';
const SETTER_RULE = 'whenever `work-backend` is `github-issues`, under either engine (a `local-files` record number is not a GitHub issue)';
const SUPERSEDED_SETTER_RULE = 'only when the engine is `pr-first` and `work-backend` is `github-issues` (a `local-files` record number is not a GitHub issue)';
function assertSetterRule(src) {
  const sets = section(src, '## What sets a block');
  assert.ok(sets.includes(SETTER_RULE), 'contract setter: not github-issues under either engine');
  assert.ok(!sets.replace(SETTER_RULE, '').includes('github-issues'), 'contract setter: the condition appears outside the setter');
}

test('the stamp runs whenever work-backend is github-issues, under either engine, and says why it skipped', () => {
  const p = stampParagraph(DISPOSITION);
  const start = p.indexOf(BACKEND_START);
  assert.ok(start !== -1, 'no work-backend sentence');
  const end = p.indexOf('Reversibility: n/a.`', start) + 'Reversibility: n/a.`'.length;
  for (const frozenSentence of [SUPERSEDED_ENGINE_ONLY, SUPERSEDED_ENGINE_AND_BACKEND]) {
    const frozen = p.slice(0, start) + frozenSentence + p.slice(end);
    assert.notStrictEqual(frozen, p);
    assert.throws(() => assertStampParagraph(DISPOSITION.replace(p, frozen)), { message: /missing Stamping runs whenever|engine-only keying|gated on the engine/ });
  }
  assertSetterRule(text);
  const frozenSetter = text.replace(SETTER_RULE, SUPERSEDED_SETTER_RULE);
  assert.notStrictEqual(frozenSetter, text);
  assert.throws(() => assertSetterRule(frozenSetter), { message: /contract setter: not github-issues under either engine/ });
});

const LOCAL_FILES_SENTENCE = 'Every stamp targets a GitHub issue; under `work-backend: local-files` a filer stamps nothing and logs a SKIP';
function assertSettersGated(src) {
  const sec = section(src, '## What sets a block');
  assert.ok(sec.includes(LOCAL_FILES_SENTENCE), 'setters: no local-files rule for every setter');
}
test('every setter stamps only a GitHub issue: local-files stamps nothing', () => {
  assertSettersGated(text);
  // Frozen: the contract before this rule (setter 1 carried no work-backend condition).
  const frozen = text.replace(/\nEvery stamp targets a GitHub issue;[^\n]*\n/, '\n');
  assert.notStrictEqual(frozen, text);
  assert.throws(() => assertSettersGated(frozen), { message: /no local-files rule/ });
});

const MEDIUM_LOW = 'Medium and low findings are never stamped, including when declined as covered';
test('AC5.2: medium and low findings are not stamped', () => {
  assert.ok(stampParagraph(DISPOSITION).includes(MEDIUM_LOW));
  const p = stampParagraph(DISPOSITION);
  assert.throws(() => assertStampParagraph(DISPOSITION.replace(p, p.replace(MEDIUM_LOW, 'Medium and low findings are stamped too'))), { message: /missing Medium and low/ });
  assert.throws(() => assertStampParagraph(DISPOSITION.replace(p, p.replace(`${MEDIUM_LOW}.`, SUPERSEDED_STAMP))), { message: /superseded sentence|missing Medium and low/ });
});

const stampFailureBullet = (src) => src.split('\n').find((l) => l.startsWith('- Exit 2, 3')) || '';
function assertStampFailure(src) {
  const failed = stampFailureBullet(src);
  assert.ok(failed, 'no stamp failure bullet');
  assert.ok(failed.includes('any other non-zero'), 'failure bullet: a crash (exit 1) is not routed');
  assert.ok(failed.includes('stamp failed:') && failed.includes('FAILED') && failed.includes('{k} failed'), 'failure bullet: shape or count');
}
test('stamp failure counts as a disposition failure', () => {
  assertStampFailure(DISPOSITION);
  const failed = stampFailureBullet(DISPOSITION);
  // Frozen: the first commit routed only exits 2 and 3.
  const frozen = failed.replace('- Exit 2, 3, or any other non-zero (a crash exits 1) →', '- Exit 2 or 3 →');
  assert.notStrictEqual(frozen, failed);
  assert.throws(() => assertStampFailure(DISPOSITION.replace(failed, frozen)), { message: /no stamp failure bullet/ });
  assert.throws(() => assertStampFailure(DISPOSITION.replace(failed, failed.replace('any other non-zero', 'x'))), { message: /not routed/ });
});

test('Inventory names the Step 1.5 early exit, and the review gate rows say whose Step 1.5', () => {
  assert.ok(sectionOf(DISPOSITION, '## Inventory').includes('a Step 1.5 release-block stop'));
  const rows = DISPOSITION.split('\n').filter((l) => l.startsWith('| `test-fix-` |') || l.startsWith('| `flaky-allowlist-` |'));
  assert.strictEqual(rows.length, 2);
  for (const r of rows) assert.ok(r.includes("(the review's Step 1.5 test gate)") && !r.includes("(Step 1.5's test gate)"), r);
});

const CONSOLE_FACTS = [
  ['HELD list names Step 1.5', (c) => lineStartingWith(c, '**`HELD` is mode-independent.**').includes("SKILL.md's Step 1.5 release-block stop")],
  ['held-file schema admits the record form', (c) => lineStartingWith(c, '**`HELD` is mode-independent.**').includes('`#N {title} {url}`')],
  ['log line names the release block', (c) => lineStartingWith(c, 'AUTO {time} — Step 4: console rendered').includes('release-block {none|n open|unreadable')],
  ['gate count names the re-read', (c) => lineStartingWith(c, 'Besides the release-block re-read below, two HARD-GATEs evaluate here') !== '' && lineStartingWith(c, 'The console renders read-only').includes('and a release-block hold, which stop regardless of mode')],
  ['interactive bullet asks no question for a hold', (c) => lineStartingWith(c, '- **`interactive`**').includes('a release-block hold asks no question')],
];
const missingConsole = (c) => CONSOLE_FACTS.filter(([, ok]) => !ok(c)).map(([f]) => f);
// Frozen pre-change excerpts of those lines.
const PRE_CONSOLE = [
  ['HELD list names Step 1.5', "(the other `HELD` reasons are `execute.md`'s Step 5 stops", "(the other `HELD` reasons are SKILL.md's Step 1.5 release-block stop, which Step 4 re-reads, and `execute.md`'s Step 5 stops"],
  ['held-file schema admits the record form', '(SKILL.md\'s `--train semantics` composes it).', '(SKILL.md\'s `--train semantics` composes it; a release-block hold names each blocking record as `#N {title} {url}` plus the clearing act instead).'],
  ['log line names the release block', 'hook {value}. Reversibility: n/a.', 'hook {value}, release-block {none|n open|unreadable|n/a}. Reversibility: n/a.'],
  ['gate count names the re-read', 'Two HARD-GATEs evaluate here, on', 'Besides the release-block re-read below, two HARD-GATEs evaluate here, on'],
  ['gate count names the re-read', 'except at the two gates above, which stop', 'except at the two gates above and a release-block hold, which stop'],
  ['interactive bullet asks no question for a hold', '- **`interactive`** — one', '- **`interactive`** (the two gates above only; a release-block hold asks no question) — one'],
];

test('console HELD list, held-file schema, gate counts and log line name the release block', () => {
  assert.deepStrictEqual(missingConsole(CONSOLE), []);
  for (const [fact, frozen, live] of PRE_CONSOLE) {
    assert.ok(CONSOLE.includes(live), `live piece not found: ${live.slice(0, 40)}`);
    assert.deepStrictEqual(missingConsole(CONSOLE.replace(live, frozen)), [fact], `pre-change ${fact}`);
  }
  assert.ok(sectionOf(SKILL, '## Step 4: Console').includes('Besides the release-block re-read, two HARD-GATEs stop the run here'));
  assert.ok(!sectionOf(SKILL, '## Step 4: Console').replace('Besides the release-block re-read, two', 'Two').includes('Besides'));
});

// Minors 1 and 2 (final review): integration-model.md's Consumer table lists the contract, which
// routes on pr-first/local-merge, and the release journey's files: list names both new files.
const INTEGRATION_MODEL = live('plugin/skills/_shared/integration-model.md');
const consumerRow = (src) => lineStartingWith(sectionOf(src, '## Consumer table'), '| `_shared/release-block.md`');
const JOURNEY = live('docs/journeys/release-a-version.md');
const journeyFiles = (src) => src.slice(0, src.indexOf('\n---\n', 4)).split('\n').filter((l) => l.startsWith('  - ')).map((l) => l.slice(4));

test('integration-model.md\'s Consumer table names the release-block contract', () => {
  const row = consumerRow(INTEGRATION_MODEL);
  assert.ok(row.includes('`pr-first`') && row.includes('`local-merge`') && row.includes('`work-backend: github-issues`'), 'consumer row: names the routing');
  const dropped = INTEGRATION_MODEL.replace(`${row}\n`, '');
  assert.notStrictEqual(dropped, INTEGRATION_MODEL);
  assert.strictEqual(consumerRow(dropped), '');
});

test('the release journey lists the release-block CLI and contract', () => {
  const files = journeyFiles(JOURNEY);
  for (const f of ['plugin/bin/release-block.js', 'plugin/skills/_shared/release-block.md']) {
    assert.ok(files.includes(f), `journey files: missing ${f}`);
    const without = JOURNEY.replace(`  - ${f}\n`, '');
    assert.notStrictEqual(without, JOURNEY);
    assert.ok(!journeyFiles(without).includes(f), `control: ${f} removed`);
  }
});

// Step 1.5 names where `work-backend` is read (#5882 residual): the rule otherwise lived only in
// console.md's Inputs, which loads at Step 4, so a local-merge project with no flag guessed the default.
const WORK_BACKEND_SOURCE = '(CLAUDE.md `## Work records`; none → `local-files`)';
const PRE_WORK_BACKEND = 'never a fresh probe. Else detect `gh` first: `command -v gh`. Present:';
const namesWorkBackendSource = (body) => body.includes('## Work records') && body.includes(WORK_BACKEND_SOURCE);

test('Step 1.5 states where work-backend is read and that a missing flag is local-files', () => {
  const body = step15Of(SKILL);
  assert.ok(namesWorkBackendSource(body), 'Step 1.5 does not name the work-backend source');
  // Go-red: the frozen pre-fix text (engine sentence without the source) fails the same helper.
  const doctored = body.replace(` ${WORK_BACKEND_SOURCE}`, '');
  assert.notStrictEqual(doctored, body);
  assert.ok(doctored.includes(PRE_WORK_BACKEND), 'frozen copy anchors on the pre-fix text');
  assert.strictEqual(namesWorkBackendSource(doctored), false);
});
