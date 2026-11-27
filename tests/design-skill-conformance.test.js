'use strict';
// tests/design-skill-conformance.test.js — #6352 Task 6: pins the dispatch prose of
// /claude-tweaks:design (plugin/skills/design/*.md): self-contained reader briefs, the step-down
// order, the round cap, the worktree and write boundaries, and every pinned CLI call. The prose is
// new in this change, so each assertion proves go-red on a mutated in-memory copy of the live text,
// matched to that assertion's own message (skill-prose-conformance-tests/SKILL.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { sectionOf, lineStartingWith, missingFactsOf, assertEachPatternGoesRed } = require('./helpers/conformance-asserts');
const { readBlocks } = require('../plugin/bin/lib/design-session/brief');

const ROOT = path.join(__dirname, '..');
const DESIGN_DIR = path.join(ROOT, 'plugin', 'skills', 'design');
const BIN_DIR = path.join(ROOT, 'plugin', 'bin');
const FILES = ['SKILL.md', 'step-1-evidence.md', 'step-2-frame.md', 'step-3-storyboard.md', 'step-4-perspectives.md', 'step-5-alternatives.md', 'step-6-pre-mortem.md', 'step-7-builder-check.md', 'reader-briefs.md'];
const read = (name) => readText(path.join(DESIGN_DIR, name));
const TEXT = Object.fromEntries(FILES.map((f) => [f, read(f)]));
const SKILL = TEXT['SKILL.md'];
const STEP1 = TEXT['step-1-evidence.md'];
const STEP4 = TEXT['step-4-perspectives.md'];
const STEP6 = TEXT['step-6-pre-mortem.md'];
const STEP7 = TEXT['step-7-builder-check.md'];
const BRIEFS = TEXT['reader-briefs.md'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DS = 'node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js"';
const RP = 'node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js"';

// A mutation that matched nothing cannot pass as a control.
function mutate(text, from, to) {
  const out = text.replace(from, to);
  assert.notEqual(out, text, `mutation anchor not found: ${String(from).slice(0, 60)}`);
  return out;
}

// Presence of one literal, with its own message.
function assertHas(text, literal, message) {
  assert.ok(text.includes(literal), message);
}

// Both markers present and `first` before `second`, each with its own message.
function requireOrder(text, first, second, label) {
  const a = text.indexOf(first);
  const b = text.indexOf(second);
  assert.notEqual(a, -1, `${label}: first marker missing`);
  assert.notEqual(b, -1, `${label}: second marker missing`);
  assert.ok(a < b, `${label}: order violated`);
}

// The live text with `line` (a whole line) moved to the very top.
function lineMovedToTop(text, line) {
  assert.ok(text.includes(line), 'line to move not found');
  return `${line}\n${text.replace(`${line}\n`, '')}`;
}

// Fences first, then inline spans over the fence-stripped remainder.
function codeRegions(text) {
  const fences = text.match(/```[\s\S]*?```/g) ?? [];
  const stripped = text.replace(/```[\s\S]*?```/g, '');
  const spans = stripped.match(/`[^`\n]+`/g) ?? [];
  return [...fences, ...spans];
}

// Throws when a code region of any file in `texts` ({name: text}) carries a banned literal.
function assertNoBannedInCode(texts, banned, label) {
  let regions = 0;
  const offenders = [];
  for (const [name, text] of Object.entries(texts)) {
    const found = codeRegions(text);
    regions += found.length;
    for (const region of found) for (const b of banned) if (region.includes(b)) offenders.push(`${name}: ${b}`);
  }
  assert.ok(regions > 0, `${label}: code-region extraction is empty — the sweep checked nothing`);
  assert.ok(offenders.length === 0, `${label}: banned literal in a code region`);
}

const withPlantedFence = (text, literal) => `${text}\n\n\`\`\`bash\n${literal}\n\`\`\`\n`;
const withPlantedSpan = (text, literal) => `${text}\n\nRun \`${literal}\` now.\n`;

// ---------------------------------------------------------------------------------------------
// AC2.1 reader blocks

const BLOCK_NAMES = ['perspective-common', 'user', 'smallest', 'ownership', 'token-cost', 'introduction', 'perspective-output', 'pre-mortem', 'builder'];
const FORBIDDEN_REFS = [
  [/SKILL\.md/, 'SKILL.md'],
  [/_shared\//, '_shared/'],
  [/\bStep \{?\w+\}?/, 'Step {N}'],
  [/\babove\b/i, 'above'],
  [/\bbelow\b/i, 'below'],
  [/reader-briefs\.md/, 'reader-briefs.md'],
];

function assertBlocksSelfContained(briefsText) {
  const blocks = readBlocks(briefsText);
  assert.ok([...blocks.keys()].join() === BLOCK_NAMES.join(), 'block roster changed');
  for (const [name, body] of blocks) {
    assert.ok(body.length > 0, `block ${name} is empty`);
    assert.ok(body.length < briefsText.length, `block ${name} is not a strict subset of the file`);
    for (const [re, label] of FORBIDDEN_REFS) assert.ok(!re.test(body), `forbidden reference "${label}" in block ${name}`);
    const fenceLines = body.split('\n').filter((l) => /^\s*```/.test(l)).length;
    assert.ok(fenceLines % 2 === 0, `block ${name} has unbalanced fences`);
    const lead = briefsText.slice(0, briefsText.indexOf('<!-- brief:'));
    assert.ok(lead.trim().length > 0, 'the meta lead above the first block is missing');
    assert.ok(!body.includes('Read by `design-session.js brief`'), `the meta lead is sent inside block ${name}`);
  }
}

const OUTPUT_FACTS = [
  [/^NOTE: serious \| minor$/m, 'NOTE: serious | minor'],
  [/^serious: would make the design wrong, unbuildable or not worth it if shipped as is\.$/m, 'serious definition'],
  [/^minor: improves it, safe to ship without\.$/m, 'minor definition'],
];
const missingOutputFacts = missingFactsOf(OUTPUT_FACTS);
const STATUS_LINE = 'STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED';
const lastLineOf = (s) => s.split('\n').filter((l) => l.trim() !== '').pop();

test('AC2.1: every reader block is self-contained', () => {
  assertBlocksSelfContained(BRIEFS);

  const out = readBlocks(BRIEFS).get('perspective-output');
  assert.deepEqual(missingOutputFacts(out), [], 'perspective-output lost a fact');
  assert.equal(lastLineOf(out), STATUS_LINE, 'perspective-output status line is not last');
});

test('AC2.1: reader-block controls go red for their own message', () => {
  // forbidden references: one mutation per token, matched to that token's message
  const inject = { 'SKILL.md': 'see SKILL.md', '_shared/': 'see _shared/x.md', 'Step {N}': 'as in Step 4', above: 'as said above', below: 'defined below', 'reader-briefs.md': 'in reader-briefs.md' };
  for (const [label, sentence] of Object.entries(inject)) {
    const mutated = mutate(BRIEFS, 'Stay inside it:', `${sentence}. Stay inside it:`);
    assert.throws(() => assertBlocksSelfContained(mutated), { message: `forbidden reference "${label}" in block perspective-common` }, label);
  }
  // fence balance
  const unbalanced = mutate(BRIEFS, 'Perspective: the person using it.', '```\nPerspective: the person using it.');
  assert.throws(() => assertBlocksSelfContained(unbalanced), { message: 'block user has unbalanced fences' });
  // non-empty
  const emptied = mutate(BRIEFS, /(<!-- brief:smallest:start -->\n)[\s\S]*?(<!-- brief:smallest:end -->)/, '$1$2');
  assert.throws(() => assertBlocksSelfContained(emptied), { message: 'block smallest is empty' });
  // roster
  const dropped = mutate(BRIEFS, /<!-- brief:builder:start -->[\s\S]*?<!-- brief:builder:end -->\n?/, '');
  assert.throws(() => assertBlocksSelfContained(dropped), { message: 'block roster changed' });
  // meta lead stays out of every block
  const leaked = mutate(BRIEFS, 'Stay inside it:', 'Read by `design-session.js brief`. Stay inside it:');
  assert.throws(() => assertBlocksSelfContained(leaked), { message: 'the meta lead is sent inside block perspective-common' });
  // strict subset: the markers alone make every block shorter than its file
  const only = '<!-- brief:perspective-common:start -->\nx\n<!-- brief:perspective-common:end -->';
  assert.ok(readBlocks(only).get('perspective-common').length < only.length, 'markers make every block a strict subset');

  // perspective-output facts, each its own message via the fact-list proof
  const out = readBlocks(BRIEFS).get('perspective-output');
  assertEachPatternGoesRed(out, OUTPUT_FACTS, missingOutputFacts);
  // status last line: move it up
  const reordered = mutate(out, STATUS_LINE, `${STATUS_LINE}\nextra trailing line`);
  assert.notEqual(lastLineOf(reordered), STATUS_LINE, 'status-line control did not move the last line');
});

// ---------------------------------------------------------------------------------------------
// AC2.1 readers get the brief CLI's output and nothing else

const BRIEF_CALL_FACTS = {
  'step-4-perspectives.md': [
    [new RegExp(escapeRe(`${DS} brief --folder "{folder}" --reader {perspective} --round {N}`)), 'step-4 brief call'],
    [/Each reader's prompt is exactly its brief's stdout followed by the resolver's `effortLine` when it is non-empty/, 'step-4 prompt is the brief stdout'],
    [/the brief is the reader's whole prompt; nothing from the conversation, the evidence or the decisions is added/, 'step-4 brief is the whole prompt'],
  ],
  'step-6-pre-mortem.md': [
    [new RegExp(escapeRe(`${DS} brief --folder "{folder}" --reader pre-mortem`)), 'step-6 brief call'],
    [/Its prompt is exactly the brief's stdout followed by the resolver's `effortLine` when it is non-empty/, 'step-6 prompt is the brief stdout'],
    [/the brief is the reader's whole prompt; nothing from the conversation is added/, 'step-6 brief is the whole prompt'],
  ],
  'step-7-builder-check.md': [
    [new RegExp(escapeRe(`${DS} brief --folder "{folder}" --reader builder`)), 'step-7 brief call'],
    [/Its prompt is exactly the brief's stdout followed by the resolver's `effortLine` when it is non-empty/, 'step-7 prompt is the brief stdout'],
    [/the brief is the reader's whole prompt; nothing from the conversation is added/, 'step-7 brief is the whole prompt'],
  ],
};

test("AC2.1: readers get the brief CLI's output and nothing from the conversation", () => {
  for (const [file, facts] of Object.entries(BRIEF_CALL_FACTS)) {
    const text = TEXT[file];
    assert.deepEqual(missingFactsOf(facts)(text), [], `${file} lost a brief fact`);
    assertEachPatternGoesRed(text, facts, missingFactsOf(facts));
  }
  // SKILL.md's Model section states the same rule for every reader
  const model = sectionOf(SKILL, '## Model');
  const facts = [[/the brief is the reader's whole prompt, and nothing from the conversation is added, summarized or reworded/, 'Model: brief is the whole prompt']];
  assert.deepEqual(missingFactsOf(facts)(model), []);
  assertEachPatternGoesRed(model, facts, missingFactsOf(facts));
});

// ---------------------------------------------------------------------------------------------
// AC5.1 step-down stops before any reader starts

const EXCEPTION_CALL = `${RP} frontier --exception design-reader --session-dir "{design folder}"`;
const DISPATCH_LINE_PREFIX = '4. Only when every call exited 0, dispatch the whole group in one message';

test('AC5.1: a step-down stops before any reader of the round starts', () => {
  const model = sectionOf(SKILL, '## Model');
  const dispatch = lineStartingWith(model, DISPATCH_LINE_PREFIX);
  assert.notEqual(dispatch, '', 'dispatch sentence missing');
  const check = (text) => requireOrder(text, EXCEPTION_CALL, DISPATCH_LINE_PREFIX, 'exception call vs dispatch');
  check(model);
  const permuted = lineMovedToTop(model, dispatch);
  assert.notEqual(permuted, model);
  assert.throws(() => check(permuted), { message: 'exception call vs dispatch: order violated' });
  assert.throws(() => check(mutate(model, EXCEPTION_CALL, 'x')), { message: 'exception call vs dispatch: first marker missing' });

  const facts = [
    [/Resolve every reader of a dispatch group first, one call each, before any reader of that group is started\./, 'resolve every reader first'],
    [/Any call exits 3 → stop before any reader of that round is started\./, 'exit 3 stops before any reader'],
    [/Ask with one `AskUserQuestion`: `Stop and resume later \(Recommended\)`/, 'exit 3 asks, recommending stop'],
    [/Never lower the tier, and never dispatch a reader on another profile\./, 'never lower the tier'],
    [/Only when every call exited 0, dispatch the whole group in one message/, 'dispatch only when every call exited 0'],
  ];
  assert.deepEqual(missingFactsOf(facts)(model), []);
  assertEachPatternGoesRed(model, facts, missingFactsOf(facts));
});

// ---------------------------------------------------------------------------------------------
// AC4.2 round cap, malformed reply, resumed round

test('AC4.2: after the fourth round the skill lists open serious notes and asks', () => {
  const section = sectionOf(STEP4, '## 6. Follow `status`');
  const bullet = lineStartingWith(section, '- `cap-reached` →');
  assert.notEqual(bullet, '', '`cap-reached` bullet missing');
  const facts = [
    [/round 4 closed with serious notes, and a fifth round is never started\./, 'no fifth round'],
    [/List every id in `openSerious` with its note and outcome/, 'lists open serious notes'],
    [/ask with one `AskUserQuestion`: continue to step 5, or stop the session here\./, 'asks continue or stop'],
    [/On continue: set `## Perspectives` to `Status: done`/, 'continue marks Perspectives done'],
    [/ and append the choice, naming the open serious notes, to `## Decisions`/, 'continue logs the choice to Decisions'],
    [/\(`- \{date\} — continued past round 4 with open serious notes \{ids\} — by: maintainer`\)/, 'Decisions line shape'],
  ];
  assert.deepEqual(missingFactsOf(facts)(bullet), []);
  assertEachPatternGoesRed(bullet, facts, missingFactsOf(facts));
  // the pin reads only its bullet: moving the clause to another bullet turns it red
  const moved = mutate(section, '- `cap-reached` →', '- `cap-reached-x` →');
  assert.notEqual(lineStartingWith(moved, '- `cap-reached` →'), bullet);
  assert.equal(lineStartingWith(moved, '- `cap-reached` →'), '', 'move-out control still finds the bullet');
});

test('a malformed reply is re-prompted once, then recorded as a minor note', () => {
  const section = sectionOf(STEP4, '## 3. Read the replies');
  const bullet = lineStartingWith(section, '- **Malformed**');
  assert.notEqual(bullet, '', 'Malformed bullet missing');
  const facts = [
    [/re-prompt that reader once, with `SendMessage` to the same agent/, 're-prompt once via SendMessage'],
    [/Never dispatch a new reader for it/, 'no new reader'],
    [/Still malformed after that → record one `minor` note for that perspective/, 'then one minor note'],
    [/It needs an outcome like any other note\./, 'the note needs an outcome'],
  ];
  assert.deepEqual(missingFactsOf(facts)(bullet), []);
  assertEachPatternGoesRed(bullet, facts, missingFactsOf(facts));
});

test('a resumed round resolves only unrecorded perspectives', () => {
  const model = sectionOf(SKILL, '## Model');
  const facts = [[/a resumed round resolves only the perspectives `check-notes` lists in `missingPerspectives`/, 'Model: resumed round resolves missingPerspectives only']];
  assert.deepEqual(missingFactsOf(facts)(model), []);
  assertEachPatternGoesRed(model, facts, missingFactsOf(facts));
  const finish = lineStartingWith(STEP4, '- `finish-round` —');
  const stepFacts = [[/dispatch only the perspectives it lists in `missingPerspectives`/, 'step-4 finish-round dispatches missingPerspectives only']];
  assert.deepEqual(missingFactsOf(stepFacts)(finish), []);
  assertEachPatternGoesRed(finish, stepFacts, missingFactsOf(stepFacts));
});

// ---------------------------------------------------------------------------------------------
// the skill never creates a worktree; no write outside the folder

const DESIGN_MD = Object.fromEntries(FILES.filter((f) => f !== 'reader-briefs.md' || true).map((f) => [f, TEXT[f]]));

test('the skill never creates a worktree', () => {
  const banned = ['EnterWorktree', 'git worktree add', 'git branch'];
  assertNoBannedInCode(DESIGN_MD, banned, 'no worktree creation');
  for (const b of banned) {
    assert.throws(() => assertNoBannedInCode({ ...DESIGN_MD, 'SKILL.md': withPlantedFence(SKILL, b) }, banned, 'no worktree creation'), { message: 'no worktree creation: banned literal in a code region' }, `fence ${b}`);
    assert.throws(() => assertNoBannedInCode({ ...DESIGN_MD, 'SKILL.md': withPlantedSpan(SKILL, b) }, banned, 'no worktree creation'), { message: 'no worktree creation: banned literal in a code region' }, `span ${b}`);
  }
  // the extractor: an empty corpus is refused
  assert.throws(() => assertNoBannedInCode({ 'x.md': 'plain prose, no code' }, banned, 'no worktree creation'), { message: 'no worktree creation: code-region extraction is empty — the sweep checked nothing' });

  const section = sectionOf(SKILL, '## Session folder and resume');
  const facts = [
    [/The skill writes nothing outside it, and never creates a worktree or a branch\./, 'never creates a worktree or a branch'],
    [/\*\*Worktree gate, before the first write\.\*\*/, 'worktree gate before the first write'],
    [/`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/resolve-policy\.js" --values worktree-always`/, 'reads worktree-always'],
    [/When it is `true` and the checkout is the main checkout, not a linked worktree/, 'true on the main checkout'],
    [/— stop\. Tell the maintainer to start the session inside a worktree/, 'stop and tell the maintainer'],
    [/the `worktree-always` gate would refuse the write\./, 'gate would refuse the write'],
  ];
  assert.deepEqual(missingFactsOf(facts)(section), []);
  assertEachPatternGoesRed(section, facts, missingFactsOf(facts));
});

test('AC8.1: no write outside the folder, no issue, no commit', () => {
  const banned = ['gh issue create', 'git commit', '/claude-tweaks:capture'];
  assertNoBannedInCode(DESIGN_MD, banned, 'no outside write');
  for (const b of banned) {
    assert.throws(() => assertNoBannedInCode({ ...DESIGN_MD, 'step-7-builder-check.md': withPlantedFence(STEP7, b) }, banned, 'no outside write'), { message: 'no outside write: banned literal in a code region' }, `fence ${b}`);
    assert.throws(() => assertNoBannedInCode({ ...DESIGN_MD, 'step-7-builder-check.md': withPlantedSpan(STEP7, b) }, banned, 'no outside write'), { message: 'no outside write: banned literal in a code region' }, `span ${b}`);
  }
  // prose may name them: the same literal outside a code region is not an offender
  assertNoBannedInCode({ ...DESIGN_MD, 'step-7-builder-check.md': `${STEP7}\n\nNever run gh issue create here.\n` }, banned, 'no outside write');
  const row = lineStartingWith(SKILL, '| Writing outside the folder, creating a worktree or a branch, creating an issue, committing, or starting to build |');
  assert.notEqual(row, '', 'anti-pattern row missing');
  assert.throws(() => assertHas(mutate(SKILL, row, ''), row, 'anti-pattern row for outside writes missing'), { message: 'anti-pattern row for outside writes missing' });
});

// ---------------------------------------------------------------------------------------------
// AC3.2 / AC1.1

const CHECK_NOTES_CALL = `${DS} check-notes --folder "{folder}" --round {N}`;

test('AC3.2: the skill refuses to go on while a note has no outcome', () => {
  // the section's own fence holds `## {N}.{i}` lines, so slice to the next numbered heading, not sectionOf
  const start = STEP4.indexOf('## 4. Transcribe, decide, check\n');
  const end = STEP4.indexOf('\n## 5. Close the round\n');
  assert.ok(start !== -1 && end > start, 'section 4 bounds not found');
  const section = STEP4.slice(start, end);
  const facts = [
    [new RegExp(escapeRe(CHECK_NOTES_CALL)), 'check-notes call with --round'],
    [/Fix and run it again; never go on while it exits 1\./, 'never go on while it exits 1'],
    [/`pending` \(notes with no outcome — take them from the maintainer\)/, 'pending notes are taken from the maintainer'],
  ];
  assert.deepEqual(missingFactsOf(facts)(section), []);
  assertEachPatternGoesRed(section, facts, missingFactsOf(facts));
  const rowFacts = [[/^\| Going on while a note has no outcome \| An undecided note is a design question left for the builder to guess \|$/m, 'anti-pattern row']];
  const antiPatterns = sectionOf(SKILL, '## Anti-Patterns');
  assert.deepEqual(missingFactsOf(rowFacts)(antiPatterns), []);
  assertEachPatternGoesRed(antiPatterns, rowFacts, missingFactsOf(rowFacts));
});

const CHECK_EVIDENCE_CALL = `${DS} check-evidence --folder "{folder}"`;
const SHOW_LINE_PREFIX = 'Once `unsourced` is empty and no fence is open, show `evidence.md` to the maintainer, in full';

test('AC1.1: evidence is shown before anything is proposed', () => {
  const section = sectionOf(STEP1, '## 3. Write, check, show');
  const show = lineStartingWith(section, SHOW_LINE_PREFIX);
  assert.notEqual(show, '', 'show sentence missing');
  const check = (text) => requireOrder(text, CHECK_EVIDENCE_CALL, SHOW_LINE_PREFIX, 'check-evidence vs show');
  check(section);
  const permuted = lineMovedToTop(section, show);
  assert.notEqual(permuted, section);
  assert.throws(() => check(permuted), { message: 'check-evidence vs show: order violated' });
  assert.throws(() => check(mutate(section, CHECK_EVIDENCE_CALL, 'x')), { message: 'check-evidence vs show: first marker missing' });

  const facts = [
    [/Only after it has been shown, set `Status: done` and run `check-evidence` again; it must exit 0\./, 'done only after shown, then check again'],
    [/require `unsourced: \[\]` and `unclosedFence: false`/, 'check requires unsourced empty and no open fence'],
  ];
  assert.deepEqual(missingFactsOf(facts)(section), []);
  assertEachPatternGoesRed(section, facts, missingFactsOf(facts));
  const lead = [[/Nothing is proposed — no approach, no fix, no opinion on the topic — until `evidence\.md` has passed its check and been shown to the maintainer\./, 'nothing proposed before evidence is shown']];
  assert.deepEqual(missingFactsOf(lead)(STEP1), []);
  assertEachPatternGoesRed(STEP1, lead, missingFactsOf(lead));
});

// ---------------------------------------------------------------------------------------------
// every pinned --flag is one the CLI accepts

function cliUsage(script) {
  if (script === 'design-session.js') return execFileSync(process.execPath, [path.join(BIN_DIR, script), '--help'], { encoding: 'utf8', windowsHide: true });
  // resolve-profile.js and resolve-policy.js have no --help: their header comment carries the usage
  const lines = readText(path.join(BIN_DIR, script)).split('\n');
  const header = [];
  for (const l of lines) {
    if (l.startsWith('#!') ) continue;
    if (l.startsWith('//')) header.push(l);
    else break;
  }
  return header.join('\n');
}

const flagIn = (usage, flag) => new RegExp(`(?<![\\w-])${escapeRe(flag)}(?![\\w-])`).test(usage);

function checkFlagsAccepted(line, script) {
  const flags = line.match(/--[a-z][a-z-]*/g) ?? [];
  assert.ok(flags.length > 0, `no flags found in the pinned line for ${script}`);
  const usage = cliUsage(script);
  for (const f of flags) assert.ok(flagIn(usage, f), `flag not accepted by ${script}: ${f}`);
  return flags;
}

const PINNED_CALLS = [
  ['design-session.js', `${DS} folder --topic "{argument}" --root "{repo root}" --create`, SKILL],
  ['design-session.js', `${DS} status --folder "{folder}"`, SKILL],
  ['design-session.js', CHECK_EVIDENCE_CALL, STEP1],
  ['design-session.js', CHECK_NOTES_CALL, STEP4],
  ['design-session.js', `${DS} brief --folder "{folder}" --reader {perspective} --round {N}`, STEP4],
  ['design-session.js', `${DS} brief --folder "{folder}" --reader pre-mortem`, STEP6],
  ['design-session.js', `${DS} brief --folder "{folder}" --reader builder`, STEP7],
  ['resolve-profile.js', EXCEPTION_CALL, SKILL],
  ['resolve-policy.js', 'node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values worktree-always', SKILL],
];

test('every --flag in a pinned call line is one the CLI accepts', () => {
  for (const [script, line, text] of PINNED_CALLS) {
    assertHas(text, line, `pinned call missing from the prose: ${line}`);
    checkFlagsAccepted(line, script);
  }
  // go-red: rename one flag per CLI
  assert.throws(() => checkFlagsAccepted(CHECK_NOTES_CALL.replace('--round', '--rnd'), 'design-session.js'), { message: 'flag not accepted by design-session.js: --rnd' });
  assert.throws(() => checkFlagsAccepted(EXCEPTION_CALL.replace('--session-dir', '--sess-dir'), 'resolve-profile.js'), { message: 'flag not accepted by resolve-profile.js: --sess-dir' });
  assert.throws(() => checkFlagsAccepted('node resolve-policy.js --value x', 'resolve-policy.js'), { message: 'flag not accepted by resolve-policy.js: --value' });
  // and the prose side: a pinned line absent from its file goes red with its own message
  const [, line, text] = PINNED_CALLS[3];
  assert.throws(() => assertHas(mutate(text, line, line.replace('--round', '--rnd')), line, `pinned call missing from the prose: ${line}`), { message: `pinned call missing from the prose: ${line}` });
});

// ---------------------------------------------------------------------------------------------
// skill references in step bodies are fully qualified

const BARE_SKILL_REF = /(?<=^|[\s`(])\/(?:specify|design-wrapper|design|build|flow|review|test|capture|help|accept|dispatch|backlog|wrap-up|tidy|simplify|research)\b(?![:\w-])/;

function bareRefsIn(texts) {
  const hits = [];
  for (const [name, text] of Object.entries(texts)) {
    text.split('\n').forEach((line, i) => {
      if (BARE_SKILL_REF.test(line)) hits.push(`${name}:${i + 1}`);
    });
  }
  return hits;
}

test('skill references in step bodies are fully qualified', () => {
  const stepBodies = Object.fromEntries(Object.entries(TEXT).filter(([n]) => n.startsWith('step-') || n === 'SKILL.md'));
  assert.equal(Object.keys(stepBodies).length, 8, 'step-body file set changed');
  assert.deepEqual(bareRefsIn(stepBodies), []);
  // the qualified form is present (the sweep reads real references)
  assert.ok(/`\/claude-tweaks:design \{argument\}`/.test(SKILL), 'qualified self-reference missing');
  // go-red: the sweep catches a bare reference, in a span and as prose, and ignores the qualified form
  assert.deepEqual(bareRefsIn({ 'x.md': 'run `/specify` now' }), ['x.md:1']);
  assert.deepEqual(bareRefsIn({ 'x.md': 'then /design-wrapper' }), ['x.md:1']);
  assert.deepEqual(bareRefsIn({ 'x.md': 'run `/claude-tweaks:specify` now' }), []);
  const mutated = { ...stepBodies, 'step-5-alternatives.md': `${stepBodies['step-5-alternatives.md']}\nNext: \`/specify\`\n` };
  assert.equal(bareRefsIn(mutated).length, 1);
});
