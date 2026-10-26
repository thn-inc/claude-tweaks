// tests/console-shadow-dup-outcomes-conformance.test.js — #3946: the console prose
// registers the `Dismissed duplicates` section (review-console-section-addition's
// sites 7, 9, 10 and 11; site 8's heading in console-template.md is pinned by
// reflect-wrap-up-insights-staging-conformance.test.js, which reads SECTIONS).
//
// Reading the live prose is the declared carve-out here (skill-prose-conformance-tests,
// [IL-80]): these files restate a structure that lives in plugin/bin/lib/console/resolve.js
// (the section name and its resolution), so updating them IS the response to a change there.
// The section name and the `dismissed` resolution are read from that module, never hand-typed.
//
// Each of the four `assert*` helpers is the single assertion both the live-file test and its
// go-red control call: the control doctors the live text in memory (assert.notEqual guards a
// replace that matched nothing) and expects the same helper to throw with that assertion's own
// message. Later tasks in #3946 append assertions to this file using these helpers.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');

const ROOT = path.resolve(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const { SECTIONS, SECTION_STANCES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'resolve.js'));

const NAME = SECTIONS.DISMISSED;
const RESOLUTION = SECTION_STANCES[NAME].resolution;

const APPENDIX = read('plugin', 'skills', 'wrap-up', 'review-console-appendix.md');
const INTERACTIVE = read('plugin', 'skills', 'wrap-up', 'review-console-interactive.md');
const MULTISPEC_TEMPLATE = read('plugin', 'skills', 'flow', 'multispec-console-template.md');
const WRAPUP_SKILL = read('plugin', 'skills', 'wrap-up', 'SKILL.md');

// --- helpers -------------------------------------------------------------------

// The Resolution-to-step mapping's bullet for `resolution`, from its `- \`resolution\`` opener
// to the next top-level bullet. Throws (with its own message) when the section or bullet is gone.
function mappingBullet(appendixText, resolution) {
  const start = appendixText.indexOf('### Resolution-to-step mapping');
  assert.notEqual(start, -1, 'the appendix has no "### Resolution-to-step mapping" section');
  const end = appendixText.indexOf('\n## ', start);
  assert.notEqual(end, -1, 'the Resolution-to-step mapping has no following ## section to bound it');
  const lines = appendixText.slice(start, end).split('\n');
  const opener = `- \`${resolution}\``;
  const first = lines.findIndex((l) => l.startsWith(opener));
  assert.notEqual(first, -1, `the Resolution-to-step mapping has no ${opener} bullet`);
  let last = first + 1;
  while (last < lines.length && !lines[last].startsWith('- ') && lines[last].trim() !== '') last += 1;
  return lines.slice(first, last).join(' ').replace(/\s+/g, ' ');
}

// The facts the `dismissed` bullet owes, as [label, pattern]. Non-global on purpose.
const DISMISSED_FACTS = [
  ['executes nothing', /^- `dismissed` — execute \*\*nothing\*\*/],
  ['names the section', new RegExp(`\\*\\*${NAME}\\*\\*`)],
  ['a .shadow-dup copy', /`\.shadow-dup` copy/],
  ['byte-identical to its anchor', /byte-identical to its anchor \(`shadow-dup-duplicate`\)/],
  ['the anchor is its own item', /anchor is its own item/],
  ['the copy stays in staged/', /copy stays in `staged\/`/],
];

function missingDismissedFacts(bullet) {
  return DISMISSED_FACTS.filter(([, pattern]) => !pattern.test(bullet)).map(([label]) => label);
}

function assertDismissedRouted(appendixText) {
  const bullet = mappingBullet(appendixText, RESOLUTION);
  assert.deepEqual(missingDismissedFacts(bullet), [], `the \`${RESOLUTION}\` bullet lost a fact`);
}

// The Numbering rules' first bullet (the named batch sections), as one line.
function namedBatchBullet(interactiveText) {
  const line = interactiveText.split('\n').find((l) => l.startsWith("- The console's **named batch sections**"));
  assert.ok(line, "the Numbering rules have no \"- The console's **named batch sections**\" bullet");
  return line;
}

function assertInBatchList(interactiveText, name) {
  const line = namedBatchBullet(interactiveText);
  assert.ok(
    line.includes(`${SECTIONS.PENDING}, ${name}, ${SECTIONS.LOW},`),
    `the named-batch-sections list does not put ${name} between ${SECTIONS.PENDING} and ${SECTIONS.LOW}`,
  );
  const anchor = line.indexOf('render only when non-empty');
  assert.notEqual(anchor, -1, 'the named-batch-sections bullet has no "render only when non-empty" parenthetical');
  const open = line.lastIndexOf('(', anchor);
  const close = line.indexOf(')', anchor);
  assert.ok(open !== -1 && close !== -1, 'the "render only when non-empty" clause is not inside a parenthetical');
  assert.ok(
    line.slice(open, close).includes(name),
    `the "render only when non-empty" parenthetical does not name ${name}`,
  );
}

// A `#### {name} (` heading must exist once, between Pending review and Low-confidence findings.
function assertHeading(templateText, name) {
  const head = (n) => `\n#### ${n} (`;
  const idx = templateText.indexOf(head(name));
  assert.notEqual(idx, -1, `no "#### ${name} (" heading`);
  assert.equal(templateText.indexOf(head(name), idx + 1), -1, `more than one "#### ${name} (" heading`);
  const pending = templateText.indexOf(head(SECTIONS.PENDING));
  const low = templateText.indexOf(head(SECTIONS.LOW));
  assert.ok(pending !== -1 && low !== -1, 'the Pending review or Low-confidence findings heading is missing — the order check has no anchors');
  assert.ok(pending < idx && idx < low, `"#### ${name} (" is not between ${SECTIONS.PENDING} and ${SECTIONS.LOW}`);
}

// wrap-up/SKILL.md's Review Console paragraph: the parenthesized `/`-separated section list.
function assertInSkillList(skillText, name) {
  const marker = 'the named sections `review-console.md` heads (';
  const start = skillText.indexOf(marker);
  assert.notEqual(start, -1, 'wrap-up/SKILL.md has no "the named sections `review-console.md` heads (" list');
  const listStart = start + marker.length;
  const listEnd = skillText.indexOf(')', listStart);
  assert.notEqual(listEnd, -1, 'the Review Console section list is never closed');
  assert.ok(
    skillText.slice(listStart, listEnd).includes(`${SECTIONS.PENDING} / ${name} / ${SECTIONS.LOW}`),
    `the Review Console section list does not put ${name} between ${SECTIONS.PENDING} and ${SECTIONS.LOW}`,
  );
}

// multispec-review-console.md: both enumerations of the prose-aggregated sections (the step-2 read
// and the "Canonical render order") put `name` right after Pending review.
function assertInMultispecOrder(consoleText, name) {
  const adjacent = `${SECTIONS.PENDING}, ${name}, ${SECTIONS.LOW}`;
  const count = consoleText.split(adjacent).length - 1;
  assert.equal(count, 2, `multispec-review-console.md carries "${adjacent}" ${count} times, expected 2 (the step-2 read list and the Canonical render order)`);
}

// Doctor `text` by replacing exactly one match; the notEqual guard stops a no-op replace passing.
function doctor(text, pattern, replacement) {
  const out = text.replace(pattern, replacement);
  assert.notEqual(out, text, `control did not change the text: ${pattern}`);
  return out;
}

// --- appendix: Resolution-to-step mapping -----------------------------------------

test('the resolution read from code is `dismissed` (the bullet below is keyed on it)', () => {
  assert.equal(RESOLUTION, 'dismissed');
  assert.equal(NAME, 'Dismissed duplicates');
});

test('dismissed routes to execute-nothing in the appendix mapping', () => {
  assertDismissedRouted(APPENDIX);
});

test('control: deleting the dismissed bullet fails assertDismissedRouted', () => {
  const lines = APPENDIX.split('\n');
  const first = lines.findIndex((l) => l.startsWith(`- \`${RESOLUTION}\``));
  assert.notEqual(first, -1);
  let last = first + 1;
  while (last < lines.length && !lines[last].startsWith('- ') && lines[last].trim() !== '') last += 1;
  const mutated = [...lines.slice(0, first), ...lines.slice(last)].join('\n');
  assert.notEqual(mutated, APPENDIX);
  assert.throws(() => assertDismissedRouted(mutated), { message: /has no - `dismissed` bullet/ });
});

test('control: each fact of the dismissed bullet is individually load-bearing', () => {
  const bullet = mappingBullet(APPENDIX, RESOLUTION);
  assert.deepEqual(missingDismissedFacts(bullet), []);
  for (const [label, pattern] of DISMISSED_FACTS) {
    const stripped = bullet.replace(pattern, '');
    assert.notEqual(stripped, bullet, `fact "${label}" matched nothing in the live bullet`);
    assert.deepEqual(missingDismissedFacts(stripped), [label], `stripping "${label}" must report exactly itself`);
  }
});

// --- interactive: Numbering rules ------------------------------------------------

test('the Numbering rules list Dismissed duplicates among the named batch sections', () => {
  assertInBatchList(INTERACTIVE, NAME);
});

test('control: deleting the name from the batch list fails assertInBatchList (list message)', () => {
  const mutated = doctor(INTERACTIVE, `${SECTIONS.PENDING}, ${NAME}, `, `${SECTIONS.PENDING}, `);
  assert.throws(() => assertInBatchList(mutated, NAME), { message: /does not put Dismissed duplicates between/ });
});

test('control: deleting the name from the non-empty parenthetical fails assertInBatchList (parenthetical message)', () => {
  const line = namedBatchBullet(INTERACTIVE);
  const anchor = line.indexOf('render only when non-empty');
  const open = line.lastIndexOf('(', anchor);
  const close = line.indexOf(')', anchor);
  const parenthetical = line.slice(open, close);
  assert.ok(parenthetical.includes(NAME));
  // Remove the name from the parenthetical alone; the list occurrence stays.
  const mutatedLine = line.slice(0, open) + parenthetical.replace(NAME, 'something else') + line.slice(close);
  const mutated = doctor(INTERACTIVE, line, mutatedLine);
  assert.throws(() => assertInBatchList(mutated, NAME), { message: /parenthetical does not name Dismissed duplicates/ });
});

// --- multi-spec template ---------------------------------------------------------

test('multispec-console-template.md renders a #### Dismissed duplicates heading', () => {
  assertHeading(MULTISPEC_TEMPLATE, NAME);
});

test('control: deleting the multispec heading fails assertHeading', () => {
  const mutated = doctor(MULTISPEC_TEMPLATE, `\n#### ${NAME} (`, '\n#### Something else (');
  assert.throws(() => assertHeading(mutated, NAME), { message: /no "#### Dismissed duplicates \(" heading/ });
});

test('control: moving the heading below Low-confidence findings fails assertHeading (order message)', () => {
  const head = `\n#### ${NAME} (`;
  const low = `\n#### ${SECTIONS.LOW} (`;
  const start = MULTISPEC_TEMPLATE.indexOf(head);
  const lowIdx = MULTISPEC_TEMPLATE.indexOf(low);
  const contestedIdx = MULTISPEC_TEMPLATE.indexOf(`\n#### ${SECTIONS.CONTESTED} (`);
  assert.ok(start !== -1 && lowIdx !== -1 && contestedIdx !== -1);
  assert.ok(start < lowIdx && lowIdx < contestedIdx);
  const block = MULTISPEC_TEMPLATE.slice(start, lowIdx);
  const without = MULTISPEC_TEMPLATE.slice(0, start) + MULTISPEC_TEMPLATE.slice(lowIdx);
  const at = without.indexOf(`\n#### ${SECTIONS.CONTESTED} (`);
  const permuted = without.slice(0, at) + block + without.slice(at);
  assert.notEqual(permuted, MULTISPEC_TEMPLATE);
  assert.throws(() => assertHeading(permuted, NAME), { message: /is not between/ });
});

test('control: a duplicated heading fails assertHeading', () => {
  const head = `\n#### ${NAME} (`;
  const mutated = doctor(MULTISPEC_TEMPLATE, head, `${head}x)\n${head}`);
  assert.throws(() => assertHeading(mutated, NAME), { message: /more than one/ });
});

// --- wrap-up/SKILL.md ------------------------------------------------------------

test("wrap-up/SKILL.md's Review Console section list names Dismissed duplicates", () => {
  assertInSkillList(WRAPUP_SKILL, NAME);
});

test('control: deleting the name from the Review Console section list fails assertInSkillList', () => {
  const mutated = doctor(WRAPUP_SKILL, `${SECTIONS.PENDING} / ${NAME} / `, `${SECTIONS.PENDING} / `);
  assert.throws(() => assertInSkillList(mutated, NAME), { message: /does not put Dismissed duplicates between/ });
});

// --- multispec-review-console.md: step-2 read list and Canonical render order ----------

const MULTISPEC_CONSOLE = read('plugin', 'skills', 'flow', 'multispec-review-console.md');

test("multispec-review-console.md's section enumerations name Dismissed duplicates after Pending review", () => {
  assertInMultispecOrder(MULTISPEC_CONSOLE, NAME);
});

test('control: dropping the name from either enumeration fails assertInMultispecOrder', () => {
  const adjacent = `${SECTIONS.PENDING}, ${NAME}, ${SECTIONS.LOW}`;
  const once = doctor(MULTISPEC_CONSOLE, adjacent, `${SECTIONS.PENDING}, ${SECTIONS.LOW}`);
  assert.throws(() => assertInMultispecOrder(once, NAME), { message: /carries .* 1 times, expected 2/ });
  const twice = doctor(once, adjacent, `${SECTIONS.PENDING}, ${SECTIONS.LOW}`);
  assert.throws(() => assertInMultispecOrder(twice, NAME), { message: /carries .* 0 times, expected 2/ });
});

// --- Queue writes: step 7 composes a shadow-dup copy's header (Task 5) ------------------
//
// A divergent or collision `.shadow-dup` copy is a raw staged file with no `Title:`/`Type:`/
// `Labels:` header, so step 7 cannot read one off it: it runs bin/shadow-dup-proposal.js first.
// Every assertion below is a helper the matching control re-runs on doctored text.

const REVIEW_CONSOLE = read('plugin', 'skills', 'wrap-up', 'review-console.md');
const CONSOLE_TEMPLATE = read('plugin', 'skills', 'wrap-up', 'console-template.md');
const { USAGE: CLI_USAGE } = require(path.join(ROOT, 'plugin', 'bin', 'shadow-dup-proposal.js'));

// review-console.md "On approval" step 7, as one line (it is a single list item).
function step7(consoleText) {
  const line = consoleText.split('\n').find((l) => l.startsWith('7. `Q#` queue writes'));
  assert.ok(line, 'review-console.md has no "7. `Q#` queue writes" step');
  return line;
}

// The facts step 7 owes a `.shadow-dup` item, as [label, pattern]. Non-global on purpose.
const STEP7_FACTS = [
  ['names the item kinds', /`\*\.shadow-dup\*` item \(`shadow-dup-divergent`\/`shadow-dup-collision`\)/],
  ['carries no header of its own', /carries no header of its own/],
  ['resolves a scratch path', /session-tmp-resolve\.js" SHADOW_DUP_PROPOSAL=shadow-dup-proposal-\{Q#\}\.md`/],
  ['no eval, prints a quoted assignment', /\(no `eval`; it prints `SHADOW_DUP_PROPOSAL="<path>"` — use the path inside the quotes as `\{proposal-path\}`\)/],
  ['runs the composer', /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/shadow-dup-proposal\.js" --run "\{item-run-dir\}" --item '\{name\}' --out "\{proposal-path\}"/],
  ['quotes the copy verbatim', /quotes the copy verbatim under `Defer-reason: needs-human-decision` and `needs:definition`/],
  ['defines {name}', /\(`\{name\}`: the item's staged filename, single-quoted here and below because it is read from `staged\/`, not written by a pipeline producer;/],
  ['defines {item-run-dir}', /`\{item-run-dir\}`: the run directory whose `staged\/` holds the item — `\$PIPELINE_RUN_DIR` in a single-spec run\)/],
  ['files from the proposal, not the raw copy', /create the record from `\{proposal-path\}`, not the raw copy/],
  ['a non-zero exit logs a Degrade-trace SKIP', /A non-zero exit is not a refusal: log one `SKIP` per `_shared\/auto-decision-log\.md`'s Degrade-trace rule/],
  ['the full SKIP command', /`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/log-decision\.js" --run "\{item-run-dir\}" --status SKIP --section "\/wrap-up" --step "Shadow-dup proposal \(skipped\)" --text 'condition: shadow-dup-proposal\.js exited \{code\} for \{name\} → fallback: copy stays in staged\/, not filed this run' --reversibility n\/a`/],
  ['the true fallback', /the copy stays in `staged\/`, the item is not filed this run, and that `SKIP` line is its trace/],
  ['a failed composer is recorded for a human', /then record it per `refused-proposals\.md`'s failed-execution rewrite, `\{why\}` = `shadow-dup-proposal\.js exited \{code\}`/],
  ['a failed gh issue create cites refused-proposals.md', /A failed `gh issue create` on the proposal follows `refused-proposals\.md`'s failed-execution rewrite/],
];

function missingStep7Facts(line) {
  return STEP7_FACTS.filter(([, pattern]) => !pattern.test(line)).map(([label]) => label);
}

// `FAILED` is a hand-composed status only two named writers may use (_shared/auto-decision-log.md),
// and log-decision.js exits 2 on it, so step 7 must route a composer failure to `SKIP` instead.
function assertStep7Composer(consoleText) {
  const line = step7(consoleText);
  assert.deepEqual(missingStep7Facts(line), [], 'step 7 lost a shadow-dup fact');
  assert.ok(!line.includes('FAILED'), 'step 7 names FAILED, a status log-decision.js rejects');
  // Under `unattended` the console has already resolved, so no "next console" re-offers the copy (#3946 M2).
  assert.ok(!line.includes('for the next console'), 'step 7 still says a skipped copy stays staged for the next console');
}

// The `apply` on a `Q#` item bullet of the appendix's Resolution-to-step mapping, joined.
function applyOnQBullet(appendixText) {
  const lines = appendixText.split('\n');
  const first = lines.findIndex((l) => l.startsWith('- `apply` on a `Q#` item'));
  assert.notEqual(first, -1, 'the appendix has no "- `apply` on a `Q#` item" bullet');
  let last = first + 1;
  while (last < lines.length && !lines[last].startsWith('- ') && lines[last].trim() !== '') last += 1;
  return lines.slice(first, last).join(' ').replace(/\s+/g, ' ');
}

function assertAppendixRoutesShadowDup(appendixText) {
  const bullet = applyOnQBullet(appendixText);
  assert.match(bullet, /`\.shadow-dup` copy/, 'the apply-on-Q# bullet does not name a .shadow-dup copy');
  assert.match(bullet, /`shadow-dup-proposal\.js`/, 'the apply-on-Q# bullet does not name shadow-dup-proposal.js');
  assert.match(bullet, /step 7/, 'the apply-on-Q# bullet does not cite step 7');
}

// multispec-review-console.md: step 2 and the Numbering rules' Queue-writes sentence each cite
// review-console.md step 7's shadow-dup clause.
const MULTISPEC_CITE = /`wrap-up\/review-console\.md` step 7's shadow-dup clause/;

function multispecLine(consoleText, prefix, what) {
  const line = consoleText.split('\n').find((l) => l.startsWith(prefix));
  assert.ok(line, `multispec-review-console.md has no ${what}`);
  return line;
}

function assertMultispecCitesStep7(consoleText) {
  const step2 = multispecLine(consoleText, '2. For each `spec-{N}/`', 'step 2');
  assert.match(step2, MULTISPEC_CITE, "step 2 does not cite review-console.md step 7's shadow-dup clause");
  const numbering = multispecLine(consoleText, 'Rows across Auto-applied through Translated briefs', 'Numbering rules paragraph');
  assert.match(numbering, MULTISPEC_CITE, "the Numbering rules' Queue-writes sentence does not cite review-console.md step 7's shadow-dup clause");
}

function assertTemplateNamesShadowDup(templateText) {
  const start = templateText.indexOf('**Where the `Q#` rows come from.**');
  assert.notEqual(start, -1, 'console-template.md has no "Where the `Q#` rows come from" paragraph');
  const end = templateText.indexOf('\n\n', start);
  const para = templateText.slice(start, end === -1 ? undefined : end);
  assert.match(para, /`\.shadow-dup` cop(?:y|ies)/, 'the Q# source paragraph does not name .shadow-dup copies');
  assert.match(para, /shadow-dup-divergent/, 'the Q# source paragraph does not name shadow-dup-divergent');
}

// Prose-code twin: every `--flag` step 7 passes to shadow-dup-proposal.js appears in that CLI's USAGE.
function step7ComposerFlags(consoleText) {
  const m = step7(consoleText).match(/bin\/shadow-dup-proposal\.js"([^`]*)`/);
  assert.ok(m, 'step 7 has no shadow-dup-proposal.js command to read flags from');
  const flags = m[1].match(/--[a-z][a-z-]*/g) || [];
  assert.ok(flags.length > 0, 'step 7 passes no flags to shadow-dup-proposal.js');
  return flags;
}

function assertFlagsInUsage(consoleText, usage) {
  const missing = step7ComposerFlags(consoleText).filter((f) => !usage.includes(f));
  assert.deepEqual(missing, [], `step 7 passes flags absent from shadow-dup-proposal.js's USAGE: ${missing.join(' ')}`);
}

test('step 7 names shadow-dup-proposal.js with --run, --item and --out for a .shadow-dup Q# item', () => {
  assertStep7Composer(REVIEW_CONSOLE);
});

test("control: each fact of step 7's shadow-dup clause is individually load-bearing", () => {
  const line = step7(REVIEW_CONSOLE);
  assert.deepEqual(missingStep7Facts(line), []);
  for (const [label, pattern] of STEP7_FACTS) {
    const stripped = line.replace(pattern, '');
    assert.notEqual(stripped, line, `fact "${label}" matched nothing in the live step 7`);
    const mutated = doctor(REVIEW_CONSOLE, line, stripped);
    assert.throws(
      () => assertStep7Composer(mutated),
      (e) => e.message.startsWith('step 7 lost a shadow-dup fact') && Array.isArray(e.actual) && e.actual.length === 1 && e.actual[0] === label,
      `stripping "${label}" must report exactly itself`,
    );
  }
});

test('control: naming FAILED in step 7 fails assertStep7Composer (log-decision.js rejects that status)', () => {
  const mutated = doctor(REVIEW_CONSOLE, 'log one `SKIP` per', 'log one `FAILED` per');
  // Rewording the SKIP sentence loses its fact first, so this case pins the fact check; onlyFailed below pins FAILED alone.
  assert.throws(() => assertStep7Composer(mutated), { message: /^step 7 lost a shadow-dup fact/ });
  const onlyFailed = doctor(REVIEW_CONSOLE, ' and that `SKIP` line is its trace;', ' and that `SKIP` line is its trace (FAILED).');
  assert.throws(() => assertStep7Composer(onlyFailed), { message: /names FAILED/ });
});

test('control: the old "stays staged for the next console" wording fails assertStep7Composer (#3946 M2)', () => {
  const mutated = doctor(REVIEW_CONSOLE, ' and that `SKIP` line is its trace;', ' and that `SKIP` line is its trace; the item stays staged for the next console.');
  assert.throws(() => assertStep7Composer(mutated), { message: /still says a skipped copy stays staged for the next console/ });
});

// Extract-and-run: step 7's SKIP command, with its placeholders filled, is accepted by
// log-decision.js and appends one Degrade-trace-shaped SKIP line (#3946 M2).
const LOG_DECISION = require(path.join(ROOT, 'plugin', 'bin', 'log-decision.js'));

function step7SkipArgv(consoleText, fill) {
  const m = step7(consoleText).match(/`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/log-decision\.js" ([^`]*)`/);
  assert.ok(m, 'step 7 has no log-decision.js command to run');
  const tokens = m[1].match(/"[^"]*"|'[^']*'|\S+/g).map((t) => (/^["']/.test(t) ? t.slice(1, -1) : t));
  return tokens.map((t) => Object.entries(fill).reduce((s, [k, v]) => s.split(k).join(v), t));
}

test("step 7's SKIP command runs through log-decision.js and appends one Degrade-trace SKIP line", (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'step7-skip-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.git'));
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-10-24T000000-spec-7', 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  const argv = step7SkipArgv(REVIEW_CONSOLE, { '{item-run-dir}': runDir, '{code}': '2', '{name}': 'a-1.md.shadow-dup' });
  const out = [];
  const err = [];
  const code = LOG_DECISION.run(argv, {
    now: () => Date.parse('2026-10-24T09:14:02Z'), cwd: () => root, mainRoot: root, stdout: (s) => out.push(s), stderr: (s) => err.push(s),
  });
  assert.equal(code, 0, err.join(''));
  const decisions = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  const lines = decisions.split('\n').filter((l) => l.startsWith('- SKIP '));
  assert.equal(lines.length, 1, decisions);
  assert.match(lines[0], /^- SKIP \d{2}:\d{2}:\d{2} — Shadow-dup proposal \(skipped\): condition: shadow-dup-proposal\.js exited 2 for a-1\.md\.shadow-dup → fallback: copy stays in staged\/, not filed this run\. Reversibility: n\/a\.$/);
  assert.match(decisions, /^## \/wrap-up$/m);
});

test('control: a SKIP command with a flag log-decision.js lacks is refused by the same run', () => {
  const mutated = doctor(REVIEW_CONSOLE, '--status SKIP --section', '--status SKIP --bogus x --section');
  const argv = step7SkipArgv(mutated, { '{item-run-dir}': '/nowhere', '{code}': '2', '{name}': 'a-1.md.shadow-dup' });
  const err = [];
  assert.equal(LOG_DECISION.run(argv, { now: () => 0, cwd: () => '/', mainRoot: '/', stdout: () => {}, stderr: (s) => err.push(s) }), 2);
  assert.match(err.join(''), /unknown argument: --bogus/);
});

test("the appendix apply-on-Q# bullet routes a shadow-dup copy through step 7's composer", () => {
  assertAppendixRoutesShadowDup(APPENDIX);
});

test('control: stripping a clause from the apply-on-Q# bullet fails assertAppendixRoutesShadowDup', () => {
  const noCopy = doctor(APPENDIX, '`.shadow-dup` copy', 'copy');
  assert.throws(() => assertAppendixRoutesShadowDup(noCopy), { message: /does not name a \.shadow-dup copy/ });
  const noCli = doctor(APPENDIX, '`shadow-dup-proposal.js`', 'the composer');
  assert.throws(() => assertAppendixRoutesShadowDup(noCli), { message: /does not name shadow-dup-proposal\.js/ });
  const noStep = doctor(APPENDIX, '- `apply` on a `Q#` item — step 7 (record creation)', '- `apply` on a `Q#` item — the record step (record creation)');
  assert.throws(() => assertAppendixRoutesShadowDup(noStep), { message: /does not cite step 7/ });
  const lines = APPENDIX.split('\n');
  const first = lines.findIndex((l) => l.startsWith('- `apply` on a `Q#` item'));
  const gone = [...lines.slice(0, first), ...lines.slice(first + 1)].join('\n');
  assert.throws(() => assertAppendixRoutesShadowDup(gone), { message: /no "- `apply` on a `Q#` item" bullet/ });
});

test("multispec-review-console.md step 2 cites review-console.md step 7's shadow-dup clause", () => {
  assertMultispecCitesStep7(MULTISPEC_CONSOLE);
});

test('control: dropping the step 7 citation from step 2 or the Numbering rules fails assertMultispecCitesStep7', () => {
  const step2 = multispecLine(MULTISPEC_CONSOLE, '2. For each `spec-{N}/`', 'step 2');
  const noStep2 = doctor(MULTISPEC_CONSOLE, step2, step2.replace(MULTISPEC_CITE, 'something else'));
  assert.throws(() => assertMultispecCitesStep7(noStep2), { message: /^step 2 does not cite/ });
  const numbering = multispecLine(MULTISPEC_CONSOLE, 'Rows across Auto-applied through Translated briefs', 'Numbering rules paragraph');
  const noNumbering = doctor(MULTISPEC_CONSOLE, numbering, numbering.replace(MULTISPEC_CITE, 'something else'));
  assert.throws(() => assertMultispecCitesStep7(noNumbering), { message: /^the Numbering rules' Queue-writes sentence does not cite/ });
});

test("console-template.md's Q# source sentence names .shadow-dup copies", () => {
  assertTemplateNamesShadowDup(CONSOLE_TEMPLATE);
});

test('control: removing a clause from the Q# source paragraph fails assertTemplateNamesShadowDup', () => {
  const noCopy = doctor(CONSOLE_TEMPLATE, /`\.shadow-dup` cop(?:y|ies)/g, 'copies');
  assert.throws(() => assertTemplateNamesShadowDup(noCopy), { message: /does not name \.shadow-dup copies/ });
  const noKind = doctor(CONSOLE_TEMPLATE, /shadow-dup-divergent/g, 'something-else');
  assert.throws(() => assertTemplateNamesShadowDup(noKind), { message: /does not name shadow-dup-divergent/ });
});

test("prose-code twin: every flag step 7 passes appears in shadow-dup-proposal.js's USAGE", () => {
  assert.deepEqual(step7ComposerFlags(REVIEW_CONSOLE).sort(), ['--item', '--out', '--run']);
  assertFlagsInUsage(REVIEW_CONSOLE, CLI_USAGE);
});

test("control: a flag step 7 passes that USAGE lacks fails assertFlagsInUsage", () => {
  const mutated = doctor(REVIEW_CONSOLE, '--out "{proposal-path}"', '--out "{proposal-path}" --bogus x');
  assert.throws(() => assertFlagsInUsage(mutated, CLI_USAGE), { message: /absent from shadow-dup-proposal\.js's USAGE: --bogus/ });
  assert.throws(() => assertFlagsInUsage(REVIEW_CONSOLE, doctor(CLI_USAGE, '--item', '--itm')), { message: /USAGE: --item/ });
});

// --- shipped-skill sweep: curation-engine.md and console-on-pr.md (Task 6) ---------------
//
// Two files still described the pre-#3946 world, where a `.shadow-dup` copy waited on a human
// decision as a pending item. The ban and its positive twin are both pinned, each proved on
// doctored text by the helper the live test calls.

const CURATION = read('plugin', 'skills', 'wrap-up', 'curation-engine.md');
const ON_PR = read('plugin', 'skills', '_shared', 'console-on-pr.md');

const collapse = (s) => s.replace(/\s+/g, ' ');

// The shadow sweep's collision paragraph, whitespace-collapsed. Exactly one paragraph carries it.
function shadowSweepParagraph(text) {
  const paragraphs = text.split(/\r?\n\r?\n/).filter((p) => p.includes('A same-basename collision'));
  assert.equal(paragraphs.length, 1, `curation-engine.md has ${paragraphs.length} shadow-sweep collision paragraphs, expected 1`);
  return collapse(paragraphs[0]);
}

function assertShadowSweepRouted(text) {
  const para = shadowSweepParagraph(text);
  assert.ok(para.includes('log it as `STAGED {time} — Shadow sweep:'), 'the shadow sweep paragraph lost its STAGED log line');
  assert.ok(!para.includes('for a human decision'), 'the shadow sweep paragraph still routes a .shadow-dup copy "for a human decision"');
  assert.ok(!para.includes('renders it as a pending item'), 'the shadow sweep paragraph still says the console renders a .shadow-dup copy as a pending item');
  assert.ok(para.includes(`**${SECTIONS.DISMISSED}**`), `the shadow sweep paragraph does not name ${SECTIONS.DISMISSED}`);
  assert.ok(para.includes(`**${SECTIONS.QUEUE}**`), `the shadow sweep paragraph does not name ${SECTIONS.QUEUE}`);
  assert.ok(para.includes('`classifyStagedItem`'), 'the shadow sweep paragraph does not cite classifyStagedItem');
}

test('curation-engine.md no longer routes a shadow-dup copy to a human decision', () => {
  assertShadowSweepRouted(CURATION);
});

test('control: the old log-line and pending-item wording fails assertShadowSweepRouted', () => {
  const oldLog = doctor(CURATION, 'shadow copy kept as staged/{name}.shadow-dup. Reversibility', 'shadow copy kept as staged/{name}.shadow-dup for a human decision. Reversibility');
  assert.throws(() => assertShadowSweepRouted(oldLog), { message: /still routes a \.shadow-dup copy "for a human decision"/ });
  const oldPending = doctor(CURATION, '`classifyStagedItem`', '`classifyStagedItem`, so the console renders it as a pending item');
  assert.throws(() => assertShadowSweepRouted(oldPending), { message: /still says the console renders a \.shadow-dup copy as a pending item/ });
});

test('control: dropping a section name or the classifier citation fails assertShadowSweepRouted', () => {
  const drop = (needle, message) => {
    const mutated = CURATION.split(needle).join('something else');
    assert.notEqual(mutated, CURATION, `control did not change the text: ${needle}`);
    assert.throws(() => assertShadowSweepRouted(mutated), { message });
  };
  drop(`**${SECTIONS.DISMISSED}**`, /does not name Dismissed duplicates/);
  drop(`**${SECTIONS.QUEUE}**`, /does not name Queue writes/);
  drop('`classifyStagedItem`', /does not cite classifyStagedItem/);
  drop('log it as `STAGED {time} — Shadow sweep:', /lost its STAGED log line/);
});

// console-on-pr.md Item ID scheme: the paragraph opened by "**Auto-applied rows are never checkboxes**".
function onPrNeverCheckboxRaw(text) {
  const paragraphs = text.split(/\r?\n\r?\n/).filter((p) => p.startsWith('**Auto-applied rows are never checkboxes**'));
  assert.equal(paragraphs.length, 1, `console-on-pr.md has ${paragraphs.length} "Auto-applied rows are never checkboxes" paragraphs, expected 1`);
  return paragraphs[0];
}
const onPrNeverCheckboxPara = (text) => collapse(onPrNeverCheckboxRaw(text));

function assertDismissedNotCheckbox(text) {
  const para = onPrNeverCheckboxPara(text);
  const at = para.indexOf(`**${SECTIONS.DISMISSED}** rows`);
  assert.notEqual(at, -1, `the never-checkboxes paragraph does not name ${SECTIONS.DISMISSED} rows`);
  const tail = para.slice(at);
  assert.match(tail, /informational/, 'the Dismissed duplicates clause does not say the rows are informational');
  assert.match(tail, /no id, no tick/, 'the Dismissed duplicates clause does not say the rows have no id and no tick');
}

// Frozen pre-change paragraph (the same region the pin targets): Auto-applied only.
const PRE_CHANGE_NEVER_CHECKBOX = `**Auto-applied rows are never checkboxes** — they already happened (see \`console-template.md\`);
render them as the same plain table the chat console already uses, informational only, no id, no
tick.`;

test('console-on-pr.md keeps Dismissed duplicates rows out of the checkbox ids', () => {
  assertDismissedNotCheckbox(ON_PR);
});

test('control: the pre-change paragraph fails assertDismissedNotCheckbox', () => {
  const mutated = doctor(ON_PR, onPrNeverCheckboxRaw(ON_PR), PRE_CHANGE_NEVER_CHECKBOX);
  assert.throws(() => assertDismissedNotCheckbox(mutated), { message: /does not name Dismissed duplicates rows/ });
});

test('control: stripping informational or the no-id-no-tick clause from the Dismissed duplicates clause fails assertDismissedNotCheckbox', () => {
  const original = onPrNeverCheckboxRaw(ON_PR);
  const collapsed = collapse(original);
  const at = collapsed.indexOf(`**${SECTIONS.DISMISSED}** rows`);
  assert.notEqual(at, -1);
  const clause = collapsed.slice(at);
  const swap = (pattern, message) => {
    const edited = collapsed.replace(clause, clause.replace(pattern, 'x'));
    assert.notEqual(edited, collapsed, `control did not change the clause: ${pattern}`);
    const mutated = doctor(ON_PR, original, edited);
    assert.throws(() => assertDismissedNotCheckbox(mutated), { message });
  };
  swap(/informational/, /does not say the rows are informational/);
  swap(/no id, no tick/, /does not say the rows have no id and no tick/);
});

// --- journeys: the two #3946 behavior changes (Task 8) -----------------------------------
//
// Three docs/journeys files described the pre-#3946 world: stage-item.js warned and still wrote
// an unmapped id (now a refusal, exit 2, nothing written), and a `.shadow-dup` copy waited in
// Pending review (now dismissed when byte-identical, otherwise filed through Queue writes).

const J_3370 = read('docs', 'journeys', 'review-what-an-unattended-console-left-open-3370.md');
const J_1932 = read('docs', 'journeys', 'resolve-the-unattended-console-in-one-process-1932.md');
const J_MULTISPEC = read('docs', 'journeys', 'multi-spec-review-console.md');

function assertRefusalJourney(text) {
  assert.ok(text.includes('refused (unmapped-prefix)'), 'the 3370 journey does not describe the stage-item.js refusal (refused (unmapped-prefix))');
  assert.ok(!text.includes('the exit code is unchanged'), 'the 3370 journey still says the staging check leaves the exit code unchanged');
  assert.ok(!text.includes('The file is still written'), 'the 3370 journey still says the unmapped file is still written');
  assert.ok(!text.includes('a shadow-dup copy'), 'the 3370 journey still lists a shadow-dup copy among the pending items');
}

test('the 3370 journey describes the unmapped-prefix refusal and no longer lists a shadow-dup copy as pending', () => {
  assertRefusalJourney(J_3370);
});

test('control: the old warning wording or the old pending list fails assertRefusalJourney', () => {
  const noRefusal = doctor(J_3370, 'refused (unmapped-prefix)', 'warning (unmapped-prefix)');
  assert.throws(() => assertRefusalJourney(noRefusal), { message: /does not describe the stage-item\.js refusal/ });
  const oldExit = doctor(J_3370, 'refused (unmapped-prefix)', 'refused (unmapped-prefix); the exit code is unchanged');
  assert.throws(() => assertRefusalJourney(oldExit), { message: /still says the staging check leaves the exit code unchanged/ });
  const oldFile = doctor(J_3370, 'refused (unmapped-prefix)', 'refused (unmapped-prefix). The file is still written');
  assert.throws(() => assertRefusalJourney(oldFile), { message: /still says the unmapped file is still written/ });
  const oldPending = doctor(J_3370, 'a non-tangential reflect category,', 'a non-tangential reflect category, a shadow-dup copy,');
  assert.throws(() => assertRefusalJourney(oldPending), { message: /still lists a shadow-dup copy/ });
});

// The facts the 1932 journey's Should-understand / Red-flags text owes a `.shadow-dup` copy.
const J_1932_FACTS = [
  ['dismissed when byte-identical', 'byte-identical to its anchor resolves `dismissed` under Dismissed duplicates'],
  ['filed through Queue writes', 'resolves `apply` under Queue writes'],
  ['quoted verbatim', 'quoting the copy verbatim'],
  ['whitespace or CRLF is divergent', 'whitespace- or CRLF-only difference is divergent'],
  ['a divergent copy is never dismissed', 'a divergent copy is never dismissed'],
];

function assertShadowDupJourney(text) {
  assert.ok(!text.includes('a `.shadow-dup` copy lands there too'), 'the 1932 journey still puts a .shadow-dup copy in Pending review');
  const missing = J_1932_FACTS.filter(([, literal]) => !text.includes(literal)).map(([label]) => label);
  assert.deepEqual(missing, [], 'the 1932 journey lost a shadow-dup outcome fact');
}

test('the 1932 journey routes a .shadow-dup copy to Dismissed duplicates or Queue writes', () => {
  assertShadowDupJourney(J_1932);
});

test('control: the old Pending review sentence fails assertShadowDupJourney', () => {
  const mutated = doctor(J_1932, 'resolves `apply` under Queue writes', 'resolves `apply` under Queue writes, and a `.shadow-dup` copy lands there too');
  assert.throws(() => assertShadowDupJourney(mutated), { message: /still puts a \.shadow-dup copy in Pending review/ });
});

test('control: each outcome fact of the 1932 journey is individually load-bearing', () => {
  for (const [label, literal] of J_1932_FACTS) {
    const mutated = J_1932.split(literal).join('something else');
    assert.notEqual(mutated, J_1932, `fact "${label}" matched nothing in the live journey`);
    assert.throws(
      () => assertShadowDupJourney(mutated),
      (e) => e.message.startsWith('the 1932 journey lost a shadow-dup outcome fact') && e.actual.includes(label),
      `dropping "${label}" must report itself`,
    );
  }
});

function assertJourneyBatchOrder(text, name) {
  assert.ok(
    text.includes(`${SECTIONS.PENDING}, ${name}, ${SECTIONS.LOW}`),
    `the multi-spec journey's reading order does not put ${name} between ${SECTIONS.PENDING} and ${SECTIONS.LOW}`,
  );
}

test('the multi-spec journey reads Dismissed duplicates after Pending review', () => {
  assertJourneyBatchOrder(J_MULTISPEC, NAME);
});

test('control: dropping the name from the multi-spec journey fails assertJourneyBatchOrder', () => {
  const mutated = doctor(J_MULTISPEC, `${SECTIONS.PENDING}, ${NAME}, `, `${SECTIONS.PENDING}, `);
  assert.throws(() => assertJourneyBatchOrder(mutated, NAME), { message: /does not put Dismissed duplicates between/ });
});

// --- final-review fix wave (#3946 I1, I2, M4, M5) ------------------------------------------

// I1(a): the multi-spec executor's own "On approval" step 2 composes a .shadow-dup item first,
// against the run dir it came from, using the placeholder step 7 defines.
function multispecApprovalStep2(consoleText) {
  const start = consoleText.indexOf('## On approval (option 1)');
  assert.notEqual(start, -1, 'multispec-review-console.md has no "## On approval (option 1)" section');
  const line = consoleText.slice(start).split('\n').find((l) => l.startsWith('2. For each `Q#` queue write'));
  assert.ok(line, 'multispec-review-console.md\'s On approval has no "2. For each `Q#` queue write" step');
  return line;
}

function assertMultispecApprovalComposes(consoleText, reviewConsoleText) {
  const line = multispecApprovalStep2(consoleText);
  assert.match(line, /A `\.shadow-dup` item is composed first per `wrap-up\/review-console\.md` step 7/, 'On approval step 2 does not compose a .shadow-dup item per review-console.md step 7');
  assert.match(line, /`\{item-run-dir\}` being the directory it came from \(`\{parent\}\/spec-\{N\}` or the parent\)/, 'On approval step 2 does not set {item-run-dir} to the directory the item came from');
  assert.ok(step7(reviewConsoleText).includes('`{item-run-dir}`: the run directory'), 'review-console.md step 7 does not define the {item-run-dir} placeholder step 2 sets');
}

test('multispec On approval step 2 composes a .shadow-dup item per step 7 against its own run dir (#3946 I1)', () => {
  assertMultispecApprovalComposes(MULTISPEC_CONSOLE, REVIEW_CONSOLE);
});

test('control: dropping either clause, or step 7\'s placeholder definition, fails assertMultispecApprovalComposes', () => {
  const noCompose = doctor(MULTISPEC_CONSOLE, 'A `.shadow-dup` item is composed first per', 'A `.shadow-dup` item is filed per');
  assert.throws(() => assertMultispecApprovalComposes(noCompose, REVIEW_CONSOLE), { message: /does not compose a \.shadow-dup item/ });
  const noDir = doctor(MULTISPEC_CONSOLE, '(`{parent}/spec-{N}` or the parent)', '(the parent)');
  assert.throws(() => assertMultispecApprovalComposes(noDir, REVIEW_CONSOLE), { message: /does not set \{item-run-dir\}/ });
  const noDef = doctor(REVIEW_CONSOLE, '`{item-run-dir}`: the run directory', '`{dir}`: the run directory');
  assert.throws(() => assertMultispecApprovalComposes(MULTISPEC_CONSOLE, noDef), { message: /does not define the \{item-run-dir\} placeholder/ });
});

// I2: a human-rendered console decides Dismissed duplicates by `cmp -s` against the anchor.
function sectionBlock(templateText, name) {
  const start = templateText.indexOf(`\n#### ${name} (`);
  assert.notEqual(start, -1, `no "#### ${name} (" heading`);
  const end = templateText.indexOf('\n#### ', start + 1);
  return templateText.slice(start, end === -1 ? undefined : end);
}

const CMP_RULE = /`(cmp -s "\{run-dir\}\/staged\/\{copy\}" "\{run-dir\}\/staged\/\{anchor\}")` exits 0/;

function assertDismissedCmpRule(templateText) {
  const block = sectionBlock(templateText, NAME);
  assert.match(block, CMP_RULE, 'the Dismissed duplicates section does not gate a row on `cmp -s` against the anchor exiting 0');
  assert.match(block, /any other copy, a missing or unreadable anchor included, is a `Q#` row/, 'the Dismissed duplicates section does not send every other copy to a Q# row');
}

function assertMultispecCitesCmpRule(templateText) {
  const block = sectionBlock(templateText, NAME);
  assert.match(block, /`wrap-up\/console-template\.md`'s Dismissed duplicates `cmp -s` rule/, "the multispec Dismissed duplicates section does not cite console-template.md's cmp -s rule");
}

test('console-template.md decides a Dismissed duplicates row by cmp -s exiting 0 (#3946 I2)', () => {
  assertDismissedCmpRule(CONSOLE_TEMPLATE);
});

test('control: dropping the cmp gate or the Q# fallback fails assertDismissedCmpRule', () => {
  const noCmp = doctor(CONSOLE_TEMPLATE, '`cmp -s "{run-dir}/staged/{copy}" "{run-dir}/staged/{anchor}"` exits 0', 'its content matches');
  assert.throws(() => assertDismissedCmpRule(noCmp), { message: /does not gate a row on `cmp -s`/ });
  const noFallback = doctor(CONSOLE_TEMPLATE, 'any other copy, a missing or unreadable anchor included, is a `Q#` row', 'other copies wait');
  assert.throws(() => assertDismissedCmpRule(noFallback), { message: /does not send every other copy to a Q# row/ });
});

test('multispec-console-template.md cites the cmp -s rule (#3946 I2)', () => {
  assertMultispecCitesCmpRule(MULTISPEC_TEMPLATE);
});

test('control: dropping the citation fails assertMultispecCitesCmpRule', () => {
  const mutated = doctor(MULTISPEC_TEMPLATE, "`wrap-up/console-template.md`'s Dismissed duplicates `cmp -s` rule", 'the usual rule');
  assert.throws(() => assertMultispecCitesCmpRule(mutated), { message: /does not cite console-template\.md's cmp -s rule/ });
});

// The rule's own command, run on fixtures, agrees with classifyStagedItem: exit 0 exactly when the
// resolver says shadow-dup-duplicate. Skipped only where no `cmp` binary exists.
const { spawnSync } = require('node:child_process');
const HAS_CMP = !spawnSync('cmp', [__filename, __filename]).error;

test('the cmp -s rule agrees with classifyStagedItem on identical, whitespace/CRLF-divergent and missing anchors', { skip: !HAS_CMP && 'no cmp binary on PATH' }, (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const { classifyStagedItem } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'resolve.js'));
  const command = CMP_RULE.exec(sectionBlock(CONSOLE_TEMPLATE, NAME))[1];
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-rule-'));
  t.after(() => fs.rmSync(runDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(runDir, 'staged'));
  const cases = [['same\n', 'same\n'], ['a\r\n', 'a\n'], ['a ', 'a'], ['x', null]];
  cases.forEach(([copyText, anchorText], i) => {
    const anchor = `item-${i}.md`;
    const copy = `${anchor}.shadow-dup`;
    fs.writeFileSync(path.join(runDir, 'staged', copy), copyText);
    if (anchorText !== null) fs.writeFileSync(path.join(runDir, 'staged', anchor), anchorText);
    const args = command.match(/"[^"]*"|\S+/g).slice(1).map((t) => t.replace(/^"|"$/g, '')
      .split('{run-dir}').join(runDir).split('{copy}').join(copy).split('{anchor}').join(anchor));
    const exit = spawnSync('cmp', args).status;
    const { outcome } = classifyStagedItem(copy, copyText, anchorText === null ? undefined : anchorText);
    assert.equal(exit === 0, outcome === 'shadow-dup-duplicate', JSON.stringify({ copyText, anchorText, exit, outcome }));
  });
});

// M4: Approve all leaves Dismissed duplicates rows as they are, and Override has no verb for one.
function assertApproveAllException(templateText) {
  const line = templateText.split('\n').find((l) => l.startsWith('The pipeline auto-resolved'));
  assert.ok(line, 'console-template.md has no "The pipeline auto-resolved" opening paragraph');
  assert.ok(line.includes(`(batch sections: apply, except ${NAME} rows, which stay as they are;`), `the opening's Approve-all defaults do not except ${NAME} from "batch sections: apply"`);
}

function assertNoOverrideVerb(interactiveText) {
  const para = interactiveText.split('\n').find((l) => l.startsWith(`**${NAME} rows (#3946):**`));
  assert.ok(para, `review-console-interactive.md has no "**${NAME} rows (#3946):**" paragraph`);
  assert.match(para, /they take no Override verb/, `the ${NAME} paragraph does not say the rows take no Override verb`);
  assert.match(para, /`skip`\/`modify`\/`revert` naming one is refused/, `the ${NAME} paragraph does not refuse skip/modify/revert`);
}

test('console-template.md\'s Approve-all defaults except Dismissed duplicates (#3946 M4)', () => {
  assertApproveAllException(CONSOLE_TEMPLATE);
});

test('control: the pre-change "batch sections: apply;" wording fails assertApproveAllException', () => {
  const mutated = doctor(CONSOLE_TEMPLATE, `batch sections: apply, except ${NAME} rows, which stay as they are;`, 'batch sections: apply;');
  assert.throws(() => assertApproveAllException(mutated), { message: /do not except Dismissed duplicates/ });
});

test('review-console-interactive.md gives Dismissed duplicates rows no Override verb (#3946 M4)', () => {
  assertNoOverrideVerb(INTERACTIVE);
});

test('control: dropping the paragraph or either clause fails assertNoOverrideVerb', () => {
  const gone = doctor(INTERACTIVE, `**${NAME} rows (#3946):**`, `**${NAME} (#3946):**`);
  assert.throws(() => assertNoOverrideVerb(gone), { message: /has no "\*\*Dismissed duplicates rows/ });
  const noVerb = doctor(INTERACTIVE, 'they take no Override verb', 'they take every Override verb');
  assert.throws(() => assertNoOverrideVerb(noVerb), { message: /does not say the rows take no Override verb/ });
  const noRefusal = doctor(INTERACTIVE, '`skip`/`modify`/`revert` naming one is refused', '`skip` naming one is applied');
  assert.throws(() => assertNoOverrideVerb(noRefusal), { message: /does not refuse skip\/modify\/revert/ });
});

// M5: the 1932 journey scopes the unmapped-prefix fallback to hand-placed or legacy files.
function assertUnmappedFallbackScoped(text) {
  assert.ok(!text.includes('so a new producer cannot slip past the console'), 'the 1932 journey still says the Pending-review fallback is what stops a new producer');
  assert.ok(text.includes('this now covers only a hand-placed or legacy file'), 'the 1932 journey does not scope the unmapped-prefix fallback to hand-placed or legacy files');
}

test('the 1932 journey scopes the unmapped-prefix fallback to hand-placed or legacy files (#3946 M5)', () => {
  assertUnmappedFallbackScoped(J_1932);
});

test('control: the pre-change clause fails assertUnmappedFallbackScoped', () => {
  const old = doctor(J_1932, 'this now covers only a hand-placed or legacy file', 'so a new producer cannot slip past the console');
  assert.throws(() => assertUnmappedFallbackScoped(old), { message: /still says the Pending-review fallback/ });
  const noScope = doctor(J_1932, 'this now covers only a hand-placed or legacy file', 'this covers every file');
  assert.throws(() => assertUnmappedFallbackScoped(noScope), { message: /does not scope the unmapped-prefix fallback/ });
});
